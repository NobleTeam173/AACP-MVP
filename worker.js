// Cloudflare Worker — AACP backend
// Uses Web Crypto API (no Node.js builtins) for JWT verification.

const ACCESS_TOKEN_SECRET = 'aacp-access-secret';

// ── JWT helpers (Web Crypto, HS256) ────────────────────────────────────────

async function importHmacKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

function base64UrlDecode(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const key = await importHmacKey(secret);
  const enc = new TextEncoder();
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlDecode(signature),
    enc.encode(`${header}.${body}`),
  );
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

// ── Auth middleware ─────────────────────────────────────────────────────────

async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const secret = env.AACP_ACCESS_TOKEN_SECRET ?? ACCESS_TOKEN_SECRET;
  return verifyJwt(token, secret);
}

function hasRole(user, ...roles) {
  return user && roles.includes(user.role);
}

// ── Route handlers ──────────────────────────────────────────────────────────

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

// ── Main fetch handler ──────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      });
    }

    if (pathname === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (pathname === '/ping') {
      return new Response('pong');
    }

    // Dashboard routes — require a valid JWT
    if (pathname.startsWith('/dashboard/')) {
      const user = await authenticate(request, env);
      if (!user) return json({ error: 'Unauthorized' }, 401);

      if (pathname === '/dashboard/youth') return handleDashboardYouth(request, user);
      if (pathname === '/dashboard/employer') return handleDashboardEmployer(request, user);
      if (pathname === '/dashboard/coach') return handleDashboardCoach(request, user);
      return json({ error: 'Not found' }, 404);
    }

    // Stub placeholders for other API routes (auth, ai, etc.)
    if (
      pathname.startsWith('/auth') ||
      pathname.startsWith('/ai') ||
      pathname.startsWith('/telemetry') ||
      pathname.startsWith('/privacy') ||
      pathname.startsWith('/audit')
    ) {
      return json({ message: 'Coming soon', path: pathname });
    }

    return json({ error: 'Not found' }, 404);
  },
};
