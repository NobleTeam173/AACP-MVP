// Cloudflare Worker — AACP backend
// Uses Web Crypto API (no Node.js builtins) for password hashing, JWT, and TOTP.
//
// This file was reconciled against the live `aacp-backend` Worker deployment,
// which had real auth/MFA/audit/competency handlers that were never committed
// to this repo. That implementation is restored here (Sections: Crypto/JWT
// helpers, Auth handlers, Competency handlers, Audit handler) and combined
// with the ACIA module built in this repo (Sections: ACIA handlers,
// ACIA → Cohort transition rule engine).

const ACCESS_EXPIRES_SEC = 15 * 60;
const REFRESH_EXPIRES_SEC = 7 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 10000;
const MFA_ENFORCED_ROLES = new Set(['admin', 'coach']);

// ── Crypto helpers (Web Crypto, no Node.js builtins) ────────────────────────

function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function randomHex(byteLen) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLen)));
}

function base64UrlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256,
  );
  return `${PBKDF2_ITERATIONS}:${bytesToHex(salt)}:${bytesToHex(bits)}`;
}

async function verifyPassword(password, stored) {
  const [iters, saltHex, hashHex] = stored.split(':');
  const enc = new TextEncoder();
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Number(iters) },
    keyMaterial,
    256,
  );
  return bytesToHex(bits) === hashHex;
}

async function importHmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function createJwt(payload, secret, expiresInSec) {
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec })));
  const key = await importHmacKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64UrlEncode(sig)}`;
}

async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const key = await importHmacKey(secret, 'verify');
  const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(signature), new TextEncoder().encode(`${header}.${body}`));
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

async function generateHotp(secretHex, counter) {
  const key = hexToBytes(secretHex);
  const counterBytes = new Uint8Array(8);
  const hi = Math.floor(counter / 4294967296);
  const lo = counter >>> 0;
  new DataView(counterBytes.buffer).setUint32(0, hi, false);
  new DataView(counterBytes.buffer).setUint32(4, lo, false);
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes));
  const offset = sig[sig.length - 1] & 15;
  const code = ((sig[offset] & 127) << 24 | sig[offset + 1] << 16 | sig[offset + 2] << 8 | sig[offset + 3]) % 1000000;
  return code.toString().padStart(6, '0');
}

async function verifyTotp(secretHex, token) {
  if (!token || token.length !== 6) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    if (await generateHotp(secretHex, step + delta) === token) return true;
  }
  return false;
}

// ── Response / auth-guard helpers ───────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const secret = env.AACP_ACCESS_TOKEN_SECRET ?? 'aacp-access-secret';
  return verifyJwt(token, secret);
}

function requireAuth(user) {
  if (!user) return err('Unauthorized', 401);
  return null;
}

function requireRole(user, ...roles) {
  const authErr = requireAuth(user);
  if (authErr) return authErr;
  if (!roles.includes(user.role)) return err('Forbidden', 403);
  return null;
}

// hasRole is the boolean-check counterpart to requireRole, used by the ACIA
// handlers below (they return their own 403 JSON body rather than a shared guard).
function hasRole(user, ...roles) {
  return user && roles.includes(user.role);
}

function audit(action, userId, entityType, details = {}) {
  auditLog.push({ id: randomHex(8), action, userId, entityType, details, timestamp: new Date().toISOString() });
}

// ── In-memory stores (MVP only — no persistence layer yet) ──────────────────

const users = new Map();
const usersByEmail = new Map();
const refreshTokens = new Map();
const auditLog = [];
const competencyScores = new Map();

// ── Auth handlers ────────────────────────────────────────────────────────────

async function handleRegister(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password || !body?.name || !body?.role) {
    return err('email, password, name, and role are required');
  }
  const email = body.email.trim().toLowerCase();
  if (usersByEmail.has(email)) return err('Email already registered');
  const role = body.role.trim().toLowerCase();
  if (!['youth', 'coach', 'employer', 'admin'].includes(role)) return err('Invalid role');
  const id = randomHex(16);
  const passwordHash = await hashPassword(body.password);
  const now = new Date().toISOString();
  const user = {
    id,
    email,
    passwordHash,
    name: body.name.trim(),
    role,
    organization: body.organization?.trim(),
    cohortId: body.cohortId,
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: now,
    updatedAt: now,
  };
  users.set(id, user);
  usersByEmail.set(email, id);
  audit('register', id, 'user');
  return json({ userId: id, role, message: 'User registered successfully' }, 201);
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) return err('email and password are required');
  const email = body.email.trim().toLowerCase();
  const uid = usersByEmail.get(email);
  const user = uid ? users.get(uid) : null;
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    return err('Invalid credentials', 401);
  }
  const testMode = (env.AACP_AUTH_TEST_MODE ?? 'false') === 'true';
  const mfaEnforced = MFA_ENFORCED_ROLES.has(user.role);
  if (mfaEnforced && !user.mfaEnabled && !testMode) {
    return json({ userId: user.id, role: user.role, mfaRequired: true, mfaSetupRequired: true, message: 'MFA setup required' });
  }
  if (user.mfaEnabled && !testMode) {
    if (!body.otp) return json({ userId: user.id, role: user.role, mfaRequired: true, message: 'MFA token required' });
    if (!(await verifyTotp(user.mfaSecret, body.otp))) return err('Invalid MFA token', 401);
  }
  const accessSecret = env.AACP_ACCESS_TOKEN_SECRET ?? 'aacp-access-secret';
  const refreshSecret = env.AACP_REFRESH_TOKEN_SECRET ?? 'aacp-refresh-secret';
  const basePayload = { sub: user.id, email: user.email, role: user.role, cohortId: user.cohortId };
  const accessToken = await createJwt({ ...basePayload, tokenType: 'access' }, accessSecret, ACCESS_EXPIRES_SEC);
  const refreshToken = await createJwt({ ...basePayload, tokenType: 'refresh' }, refreshSecret, REFRESH_EXPIRES_SEC);
  refreshTokens.set(refreshToken, {
    token: refreshToken,
    userId: user.id,
    expiresAt: Math.floor(Date.now() / 1000) + REFRESH_EXPIRES_SEC,
    revoked: false,
    createdAt: new Date().toISOString(),
  });
  audit('login', user.id, 'session');
  return json({ userId: user.id, role: user.role, accessToken, refreshToken, tokenType: 'Bearer', message: 'Login successful' });
}

async function handleRefresh(request, env) {
  const body = await request.json().catch(() => null);
  const token = body?.refreshToken;
  if (!token) return err('refreshToken required');
  const stored = refreshTokens.get(token);
  if (!stored || stored.revoked || stored.expiresAt <= Math.floor(Date.now() / 1000)) {
    return err('Invalid or expired refresh token', 401);
  }
  const refreshSecret = env.AACP_REFRESH_TOKEN_SECRET ?? 'aacp-refresh-secret';
  const payload = await verifyJwt(token, refreshSecret);
  if (!payload || payload.tokenType !== 'refresh') return err('Invalid refresh token', 401);
  const user = users.get(payload.sub);
  if (!user) return err('User not found', 401);
  const accessSecret = env.AACP_ACCESS_TOKEN_SECRET ?? 'aacp-access-secret';
  const accessToken = await createJwt(
    { sub: user.id, email: user.email, role: user.role, cohortId: user.cohortId, tokenType: 'access' },
    accessSecret,
    ACCESS_EXPIRES_SEC,
  );
  return json({ userId: user.id, role: user.role, accessToken, refreshToken: token, tokenType: 'Bearer' });
}

async function handleLogout(request) {
  const body = await request.json().catch(() => null);
  const token = body?.refreshToken;
  if (token) {
    const rec = refreshTokens.get(token);
    if (rec) {
      rec.revoked = true;
      refreshTokens.set(token, rec);
    }
  }
  return json({ message: 'Logged out' });
}

async function handleMfaSetup(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) return err('email and password required');
  const email = body.email.trim().toLowerCase();
  const uid = usersByEmail.get(email);
  const user = uid ? users.get(uid) : null;
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) return err('Invalid credentials', 401);
  const secret = randomHex(20);
  user.mfaSecret = secret;
  user.mfaEnabled = false;
  users.set(user.id, user);
  return json({ secret, message: 'MFA secret generated. Confirm with a TOTP token.' });
}

async function handleMfaConfirm(request) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password || !body?.token) return err('email, password, and token required');
  const email = body.email.trim().toLowerCase();
  const uid = usersByEmail.get(email);
  const user = uid ? users.get(uid) : null;
  if (!user || !(await verifyPassword(body.password, user.passwordHash)) || !user.mfaSecret) {
    return err('Invalid credentials or MFA not initiated', 401);
  }
  if (!(await verifyTotp(user.mfaSecret, body.token))) return err('Invalid TOTP token');
  user.mfaEnabled = true;
  users.set(user.id, user);
  return json({ success: true, message: 'MFA enabled' });
}

async function handleMfaDisable(request) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) return err('email and password required');
  const email = body.email.trim().toLowerCase();
  const uid = usersByEmail.get(email);
  const user = uid ? users.get(uid) : null;
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) return err('Invalid credentials', 401);
  user.mfaEnabled = false;
  user.mfaSecret = null;
  users.set(user.id, user);
  return json({ success: true, message: 'MFA disabled' });
}

// ── Dashboard handlers ───────────────────────────────────────────────────────

async function handleDashboardYouth(request, user) {
  if (!hasRole(user, 'youth', 'admin')) {
    return json({ error: 'Forbidden' }, 403);
  }
  const url = new URL(request.url);
  const userId = user?.sub ?? url.searchParams.get('userId') ?? undefined;
  const cohortId = user?.cohortId ?? url.searchParams.get('cohortId') ?? undefined;

  return json({
    progress: {
      readinessScore: 68,
      competencyCompleted: 7,
      competencyInProgress: 4,
      competencyPendingReview: 2,
      targetRole: 'Aviation Maintenance Technician',
    },
    badges: [
      {
        badgeId: 'badge-vr-safe-operations',
        title: 'Safe VR Operations',
        description: 'Completed the safe operations virtual simulation review.',
        earnedAt: new Date().toISOString(),
      },
    ],
    nextSteps: [
      {
        stepId: 'step-001',
        title: 'Submit evidence for navigation competency',
        description: 'Provide evidence for navigation task completion and instrument practice.',
        type: 'evidence',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    metadata: {
      userId,
      cohortId,
      generatedAt: new Date().toISOString(),
    },
  });
}

async function handleDashboardEmployer(request, user) {
  if (!hasRole(user, 'employer', 'admin')) {
    return json({ error: 'Forbidden' }, 403);
  }
  const url = new URL(request.url);
  const timeframe = url.searchParams.get('timeframe') ?? '30d';
  const cohortId = url.searchParams.get('cohortId') ?? undefined;

  return json({
    summary: {
      cohortId,
      participantCount: 50,
      averageReadiness: 72,
      readinessBands: { high: 28, medium: 46, low: 26 },
    },
    readinessTrends: [
      { period: '0d', averageReadiness: 72 },
      { period: '7d', averageReadiness: 70 },
      { period: '14d', averageReadiness: 68 },
    ],
    gapMapByRoleFamily: [
      {
        roleFamilyId: 'rf-aviation-ops',
        roleFamilyName: 'Aviation Operations',
        gapScore: 18,
        averageReadiness: 74,
        topCompetencyGaps: [
          { competencyId: 'comp-001', title: 'Flight Procedure Accuracy', gapCount: 8 },
        ],
      },
    ],
    topMatches: [
      {
        userId: 'user-123',
        roleId: 'role-jet-tech',
        roleName: 'Jet Technician Apprentice',
        matchScore: 82,
        readinessScore: 71,
        keyGaps: ['navigation', 'regulatory documentation'],
        status: 'recommended',
      },
    ],
    regulatoryFlags: [
      {
        flagType: 'training_gap',
        count: 3,
        description: 'Some participants require additional CARs-aligned training before role placement.',
      },
    ],
    recentActivity: [
      {
        type: 'assessment',
        title: 'Competency assessment submitted',
        date: new Date().toISOString(),
        status: 'pending',
        details: 'Evidence review queue updated for cohort.',
      },
    ],
    metadata: {
      generatedAt: new Date().toISOString(),
      timeframe,
    },
  });
}

async function handleDashboardCoach(request, user) {
  if (!hasRole(user, 'coach', 'admin')) {
    return json({ error: 'Forbidden' }, 403);
  }
  const url = new URL(request.url);
  const cohortId = url.searchParams.get('cohortId') ?? 'cohort-default';

  return json({
    reviewQueue: [
      {
        assessmentId: 'assessment-001',
        userId: 'user-001',
        userName: 'Ava Pilot',
        competencyTitle: 'Emergency Procedures',
        status: 'pending',
        submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    cohortReadiness: [
      {
        roleFamilyId: 'rf-flight-support',
        roleFamilyName: 'Flight Support',
        averageReadiness: 69,
        participantCount: 22,
      },
    ],
    participantOverview: [
      {
        userId: 'user-001',
        userName: 'Ava Pilot',
        currentScore: 71,
        openItems: 3,
        lastActivity: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    regulatoryReviewItems: [
      {
        itemId: 'item-001',
        itemType: 'assessment',
        reason: 'CARs-aligned evidence required for final review',
        submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    actionItems: [
      {
        actionId: 'action-001',
        title: 'Review evidence submission for navigation task',
        description: 'Review the latest navigation assessment evidence and certify readiness for the pilot cohort.',
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    metadata: {
      cohortId,
      generatedAt: new Date().toISOString(),
    },
  });
}

// ── Competency handlers ──────────────────────────────────────────────────────

async function handleCompetencyGet(request, user) {
  const guard = requireAuth(user);
  if (guard) return guard;
  const record = competencyScores.get(user.sub) ?? null;
  return json({ assessment: record });
}

async function handleCompetencySave(request, user) {
  const guard = requireAuth(user);
  if (guard) return guard;
  const body = await request.json().catch(() => null);
  if (!body?.pathway || !body?.ratings) return err('pathway and ratings required');
  const record = { pathway: body.pathway, ratings: body.ratings, completedAt: body.completedAt ?? new Date().toISOString() };
  competencyScores.set(user.sub, record);
  audit('competency_saved', user.sub, 'competency');
  return json({ success: true });
}

// ── Audit handler ────────────────────────────────────────────────────────────

function handleAuditLogs(request, user) {
  const guard = requireRole(user, 'admin');
  if (guard) return guard;
  const url = new URL(request.url);
  let logs = [...auditLog];
  const userId = url.searchParams.get('userId');
  const action = url.searchParams.get('action');
  const entityType = url.searchParams.get('entityType');
  if (userId) logs = logs.filter((l) => l.userId === userId);
  if (action) logs = logs.filter((l) => l.action === action);
  if (entityType) logs = logs.filter((l) => l.entityType === entityType);
  return json({ logs, total: logs.length });
}

// ── ACIA handlers (career intelligence front door — stubs, no persistence) ─

async function handleAciaSessionStart(request, user) {
  if (!hasRole(user, 'youth', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    sessionId: 'acia-session-stub-001',
    userId: user.sub,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    pathwayScope: ['Pilot', 'AME', 'AMT', 'ATC', 'Aerospace_STEM'],
    firstScenario: {
      scenarioId: 'acia-scenario-stub-001',
      pathwayTags: ['Pilot', 'ATC'],
      dimensionTags: ['communication', 'decision_speed'],
      type: 'situational_judgment',
      title: 'Runway Communication Scenario',
      prompt: 'Stub scenario prompt describing a situational judgment task.',
      options: [
        { optionId: 'opt-a', label: 'Stub option A' },
        { optionId: 'opt-b', label: 'Stub option B' },
      ],
    },
  });
}

async function handleAciaSessionNext(request, user, sessionId) {
  if (!hasRole(user, 'youth', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    sessionId,
    scenario: {
      scenarioId: 'acia-scenario-stub-002',
      pathwayTags: ['AMT', 'AME'],
      dimensionTags: ['precision', 'systems_thinking'],
      type: 'simulation_task',
      title: 'Component Inspection Scenario',
      prompt: 'Stub scenario prompt describing a simulation task.',
      options: [
        { optionId: 'opt-a', label: 'Stub option A' },
        { optionId: 'opt-b', label: 'Stub option B' },
      ],
    },
  });
}

async function handleAciaObservations(request, user) {
  if (!hasRole(user, 'youth', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    observationId: 'acia-observation-stub-001',
    received: true,
    capturedAt: new Date().toISOString(),
  });
}

async function handleAciaSessionComplete(request, user, sessionId) {
  if (!hasRole(user, 'youth', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    sessionId,
    status: 'complete',
    completedAt: new Date().toISOString(),
    indexId: 'acia-index-stub-001',
    cohortEligibilityId: 'cohort-eligibility-stub-001',
    cohortEligibilityStatus: 'pending',
  });
}

async function handleAciaIndex(request, user, userId) {
  if (!hasRole(user, 'youth', 'coach', 'employer', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    userId,
    sessionId: 'acia-session-stub-001',
    generatedAt: new Date().toISOString(),
    profile: [
      { pathway: 'Pilot', dimension: 'decision_speed', band: 'Aligned' },
      { pathway: 'Pilot', dimension: 'risk_tolerance', band: 'Developing' },
      { pathway: 'ATC', dimension: 'communication', band: 'Strong' },
      { pathway: 'AMT', dimension: 'precision', band: 'Emerging' },
    ],
    cohortAccessStatus: 'acia_only',
  });
}

// ── ACIA → Cohort transition rule engine ────────────────────────────────────
// Explicit, rule-based decision step. No ML, no hidden weighting — thresholds
// and branches only, so every outcome is explainable and auditable.

const ACIA_READINESS_BAND_THRESHOLD = 2; // 'Aligned'/'Strong' bands required to signal readiness
const ACIA_TRANSITION_RULE_VERSION = 'v1';

function evaluateAciaTransition(inputs) {
  const {
    aciaCompletionStatus, // 'not_started' | 'in_progress' | 'complete'
    readinessBandCount, // count of ACIAIndex bands at 'Aligned' or 'Strong'
    participantIntent, // 'ready_to_continue' | 'not_yet' | 'undecided'
    staffApprovalStatus, // 'not_required' | 'pending' | 'approved' | 'declined'
  } = inputs;

  if (aciaCompletionStatus !== 'complete') {
    return {
      outcome: 'remain_in_acia',
      recommendedNextAction: 'Complete your ACIA scenarios to unlock your full career alignment profile.',
    };
  }

  if (participantIntent === 'not_yet') {
    return {
      outcome: 'remain_in_acia',
      recommendedNextAction: 'Continue exploring your career alignment profile at your own pace.',
    };
  }

  const meetsReadinessThreshold = readinessBandCount >= ACIA_READINESS_BAND_THRESHOLD;

  if (participantIntent === 'undecided') {
    return meetsReadinessThreshold
      ? { outcome: 'flag_for_review', reviewReason: 'Readiness signal is strong but participant intent is undecided.' }
      : {
          outcome: 'remain_in_acia',
          recommendedNextAction: 'Revisit your Career Alignment Profile and let us know when you feel ready for the next step.',
        };
  }

  // participantIntent === 'ready_to_continue'
  if (!meetsReadinessThreshold) {
    return { outcome: 'flag_for_review', reviewReason: 'Participant intends to continue but readiness indicators are below threshold.' };
  }

  if (staffApprovalStatus === 'declined') {
    return { outcome: 'remain_in_acia', recommendedNextAction: 'Continue building your profile; a coach will follow up with guidance.' };
  }

  if (staffApprovalStatus === 'approved') {
    return { outcome: 'invite_to_cohort' };
  }

  return { outcome: 'flag_for_review', reviewReason: 'Readiness signal and participant intent confirmed; awaiting staff approval.' };
}

async function handleAciaTransitionIntent(request, user, userId) {
  if (!hasRole(user, 'youth', 'admin')) return json({ error: 'Forbidden' }, 403);
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return json({
    userId,
    cohortIntent: body.cohortIntent ?? 'undecided',
    recordedAt: new Date().toISOString(),
  });
}

async function handleAciaTransitionEvaluate(request, user, userId) {
  if (!hasRole(user, 'youth', 'coach', 'admin')) return json({ error: 'Forbidden' }, 403);
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const inputs = {
    aciaCompletionStatus: body.aciaCompletionStatus ?? 'complete',
    readinessBandCount: body.readinessBandCount ?? 0,
    participantIntent: body.participantIntent ?? 'undecided',
    staffApprovalStatus: body.staffApprovalStatus ?? 'not_required',
  };
  const result = evaluateAciaTransition(inputs);
  return json({
    transitionDecisionId: 'acia-transition-stub-001',
    userId,
    ruleVersion: ACIA_TRANSITION_RULE_VERSION,
    inputs,
    decidedAt: new Date().toISOString(),
    ...result,
  });
}

async function handleAciaTransitionStatus(request, user, userId) {
  if (!hasRole(user, 'youth', 'coach', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    userId,
    transitionDecisionId: 'acia-transition-stub-001',
    ruleVersion: ACIA_TRANSITION_RULE_VERSION,
    outcome: 'flag_for_review',
    reviewReason: 'Readiness signal and participant intent confirmed; awaiting staff approval.',
    decidedAt: new Date().toISOString(),
  });
}

async function handleEarlyCareerApplication(request, user) {
  if (!hasRole(user, 'youth', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    cohortEligibilityId: 'cohort-eligibility-stub-002',
    source: 'early_career_approval',
    status: 'pending',
    submittedAt: new Date().toISOString(),
  });
}

async function handleCohortEligibilityList(request, user) {
  if (!hasRole(user, 'coach', 'admin')) return json({ error: 'Forbidden' }, 403);
  const url = new URL(request.url);
  const cohortId = url.searchParams.get('cohortId') ?? undefined;
  return json({
    cohortId,
    records: [
      {
        cohortEligibilityId: 'cohort-eligibility-stub-001',
        userId: 'user-001',
        source: 'acia_readiness_signal',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        cohortEligibilityId: 'cohort-eligibility-stub-002',
        userId: 'user-045',
        source: 'early_career_approval',
        status: 'pending',
        applicationNote: 'Stub application note.',
        createdAt: new Date().toISOString(),
      },
      {
        cohortEligibilityId: 'cohort-eligibility-stub-003',
        userId: 'user-012',
        source: 'acia_readiness_signal',
        status: 'flagged_for_review',
        transitionDecisionId: 'acia-transition-stub-001',
        reviewReason: 'Readiness signal and participant intent confirmed; awaiting staff approval.',
        createdAt: new Date().toISOString(),
      },
    ],
  });
}

async function handleCohortEligibilityDecision(request, user, eligibilityId) {
  if (!hasRole(user, 'coach', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    cohortEligibilityId: eligibilityId,
    status: 'invited',
    reviewedBy: user.sub,
    reviewedAt: new Date().toISOString(),
  });
}

async function handleCohortInviteStatus(request, user, userId) {
  if (!hasRole(user, 'youth', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    userId,
    cohortAccessStatus: 'acia_only',
  });
}

async function handleAciaRetentionSignals(request, user) {
  if (!hasRole(user, 'coach', 'employer', 'admin')) return json({ error: 'Forbidden' }, 403);
  const url = new URL(request.url);
  const cohortId = url.searchParams.get('cohortId') ?? undefined;
  return json({
    cohortId,
    signals: [
      {
        retentionSignalId: 'acia-retention-stub-001',
        userId: 'user-001',
        matchId: 'match-001',
        driftFlag: 'none',
        generatedAt: new Date().toISOString(),
      },
    ],
  });
}

async function handleAciaRetentionSignalGenerate(request, user) {
  if (!hasRole(user, 'coach', 'admin')) return json({ error: 'Forbidden' }, 403);
  return json({
    retentionSignalId: 'acia-retention-stub-002',
    status: 'generated',
    generatedAt: new Date().toISOString(),
  });
}

// ── Main fetch handler ──────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (pathname === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (pathname === '/ping') {
      return new Response('pong');
    }

    if (pathname === '/app' || pathname === '/app/') {
      return Response.redirect(new URL('/app.html', request.url).toString(), 301);
    }

    // Auth routes — no pre-existing token required
    if (pathname === '/auth/register' && request.method === 'POST') return handleRegister(request, env);
    if (pathname === '/auth/login' && request.method === 'POST') return handleLogin(request, env);
    if (pathname === '/auth/logout' && request.method === 'POST') return handleLogout(request);
    if (pathname === '/auth/refresh' && request.method === 'POST') return handleRefresh(request, env);
    if (pathname === '/auth/mfa/setup' && request.method === 'POST') return handleMfaSetup(request, env);
    if (pathname === '/auth/mfa/confirm' && request.method === 'POST') return handleMfaConfirm(request);
    if (pathname === '/auth/mfa/disable' && request.method === 'POST') return handleMfaDisable(request);

    // Dashboard routes — require a valid JWT
    if (pathname.startsWith('/dashboard/')) {
      const user = await authenticate(request, env);
      if (!user) return json({ error: 'Unauthorized' }, 401);

      if (pathname === '/dashboard/youth') return handleDashboardYouth(request, user);
      if (pathname === '/dashboard/employer') return handleDashboardEmployer(request, user);
      if (pathname === '/dashboard/coach') return handleDashboardCoach(request, user);
      if (pathname === '/dashboard/competency' && request.method === 'GET') return handleCompetencyGet(request, user);
      if (pathname === '/dashboard/competency' && request.method === 'POST') return handleCompetencySave(request, user);
      return json({ error: 'Not found' }, 404);
    }

    // ACIA routes — career-intelligence front door (stub handlers, no persistence yet)
    if (
      pathname.startsWith('/acia/') ||
      pathname.startsWith('/cohort-eligibility') ||
      pathname.startsWith('/cohort/invite-status') ||
      pathname.startsWith('/early-career/')
    ) {
      const user = await authenticate(request, env);
      if (!user) return json({ error: 'Unauthorized' }, 401);

      if (pathname === '/acia/session/start' && request.method === 'POST') {
        return handleAciaSessionStart(request, user);
      }
      const sessionNextMatch = pathname.match(/^\/acia\/session\/([^/]+)\/next$/);
      if (sessionNextMatch && request.method === 'GET') {
        return handleAciaSessionNext(request, user, sessionNextMatch[1]);
      }
      const sessionCompleteMatch = pathname.match(/^\/acia\/session\/([^/]+)\/complete$/);
      if (sessionCompleteMatch && request.method === 'POST') {
        return handleAciaSessionComplete(request, user, sessionCompleteMatch[1]);
      }
      if (pathname === '/acia/observations' && request.method === 'POST') {
        return handleAciaObservations(request, user);
      }
      const indexMatch = pathname.match(/^\/acia\/index\/([^/]+)$/);
      if (indexMatch && request.method === 'GET') {
        return handleAciaIndex(request, user, indexMatch[1]);
      }
      const transitionIntentMatch = pathname.match(/^\/acia\/transition\/([^/]+)\/intent$/);
      if (transitionIntentMatch && request.method === 'POST') {
        return handleAciaTransitionIntent(request, user, transitionIntentMatch[1]);
      }
      const transitionEvaluateMatch = pathname.match(/^\/acia\/transition\/([^/]+)\/evaluate$/);
      if (transitionEvaluateMatch && request.method === 'POST') {
        return handleAciaTransitionEvaluate(request, user, transitionEvaluateMatch[1]);
      }
      const transitionStatusMatch = pathname.match(/^\/acia\/transition\/([^/]+)$/);
      if (transitionStatusMatch && request.method === 'GET') {
        return handleAciaTransitionStatus(request, user, transitionStatusMatch[1]);
      }
      if (pathname === '/early-career/application' && request.method === 'POST') {
        return handleEarlyCareerApplication(request, user);
      }
      if (pathname === '/cohort-eligibility' && request.method === 'GET') {
        return handleCohortEligibilityList(request, user);
      }
      const eligibilityDecisionMatch = pathname.match(/^\/cohort-eligibility\/([^/]+)\/decision$/);
      if (eligibilityDecisionMatch && request.method === 'POST') {
        return handleCohortEligibilityDecision(request, user, eligibilityDecisionMatch[1]);
      }
      const inviteStatusMatch = pathname.match(/^\/cohort\/invite-status\/([^/]+)$/);
      if (inviteStatusMatch && request.method === 'GET') {
        return handleCohortInviteStatus(request, user, inviteStatusMatch[1]);
      }
      if (pathname === '/acia/retention-signals' && request.method === 'GET') {
        return handleAciaRetentionSignals(request, user);
      }
      if (pathname === '/acia/retention-signals/generate' && request.method === 'POST') {
        return handleAciaRetentionSignalGenerate(request, user);
      }
      return json({ error: 'Not found' }, 404);
    }

    // Audit routes — admin only
    if (pathname.startsWith('/audit')) {
      const user = await authenticate(request, env);
      if (pathname === '/audit/logs' && request.method === 'GET') return handleAuditLogs(request, user);
      return json({ error: 'Not found' }, 404);
    }

    // Stub placeholders for other API routes (ai, telemetry, privacy)
    if (
      pathname.startsWith('/ai') ||
      pathname.startsWith('/telemetry') ||
      pathname.startsWith('/privacy')
    ) {
      const user = await authenticate(request, env);
      const guard = requireAuth(user);
      if (guard) return guard;
      return json({ message: 'Coming soon', path: pathname });
    }

    return json({ error: 'Not found' }, 404);
  },
};
