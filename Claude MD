# AACP Project Context

You are working on AACP (Aviation & Aerospace Competence Program), a minimum viable product workforce intelligence and competency validation platform for a 50-participant pilot cohort in aviation and aerospace.

## Goals

Build an MVP that supports:

- Youth career exploration and competency development
- AI-powered career coach, competency evaluator, workforce analyst, and matching engine
- Executive dashboard for aviation employers and airport leadership
- Workforce intelligence layer: talent readiness, pipeline analytics, gap mapping
- Competency validation aligned with aviation and aerospace standards
- Data handling and privacy controls aligned to Canadian requirements

## Constraints

- MVP size: 50 participants in a pilot cohort
- Industry: aviation and aerospace in Canada
- Must align with:
  - Canadian Aviation Regulations (CARs) where applicable
  - Transport Canada training, licensing, and competency guidance
  - PIPEDA-aligned data handling and privacy requirements for applicable organizations
- Mobile-first, responsive, accessible (WCAG 2.1)
- Keep complexity low; avoid over-engineering for the pilot
- Do not implement full AR/VR, blockchain credentials, or deep HRIS integrations in MVP

## Technology Stack

- Frontend: React or Vue with TypeScript, responsive, mobile-first
- Backend: Node.js or Python with REST or GraphQL API
- Auth: OAuth2 or JWT
- Database: PostgreSQL for core data, object storage for files
- Analytics warehouse: optional (BigQuery or Snowflake) for cohort and workforce reporting
- AI: LLM-based service with agent modules for:
  - Career Coach
  - Competency Evaluator (VR telemetry-powered, emits CompetencyIndex)
  - Workforce Analyst
  - Matching Engine

## VR telemetry integration
- Capture simulator and immersive training session telemetry via Unity or WebXR APIs.
- Use event, timing, motion, and task-completion telemetry to support automated CompetencyIndex evaluation.
- Keep VR telemetry processing separate from manual review workflows; the normal path is automated.

## Auth and RBAC
- Implement auth endpoints for:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/logout`
  - `POST /auth/refresh`
- Use JWT-based authentication with refresh tokens for the MVP and support multi-factor authentication for coach and admin roles.
- Optionally support OAuth2 Authorization Code flow with PKCE in later phases.
- Enforce RBAC for four roles:
  - `youth`: view own data, submit evidence, view own dashboards and readiness/index data
  - `coach`: view cohort data, review evidence, assign tasks, add coaching guidance
  - `employer`: view anonymized readiness/index analytics, export reports, review match recommendations
  - `admin`: full access, manage cohorts, roles, competency frameworks, users, consent, and audit logs
- Prefer lightweight session management for the pilot and log auth decisions for auditability.
- Keep PIPEDA-aligned data handling in mind: store the minimum personal data, protect tokens, log consent, and use secure refresh token storage.
- Define privacy controls for consent, purpose statements, retention, and deletion.
- Capture audit logs for auth events, data access, consent changes, RBAC decisions, and AI-driven readiness/index actions.
- Preserve audit trails even when underlying data subject records are removed.

## Core Entities

The main entities in the system are:

- User (with roles: youth, coach, employer, admin)
- Cohort
- RoleFamily
- Role
- Competency
- CompetencyRubric
- Assessment
- AssessmentResult
- Evidence
- CompetencyIndex
- ReadinessIndex
- Match
- AuditLog
- ConsentRecord
- RegulatoryReference
- ACIASession
- ACIAScenario
- ACIAObservation
- ACIAIndex
- ACIARetentionSignal
- CohortEligibility

## ACIA Module (Career Intelligence Front Door)

ACIA (Aviation Career Intelligence & Alignment) is the front-door layer of AACP. It sits before pathway selection and the cohort session, and produces a career alignment profile that also feeds retention analytics after placement.

### Entry model

- Youth and early-stage participants enter through ACIA by default. The cohort session is never the default entry point.
- The cohort session (pathway selection, competency assessment, placement) is reserved for participants whose `User.cohortAccessStatus` is `invited` or `enrolled`.
- Two paths into eligibility:
  - `acia_readiness_signal` — a youth participant completes ACIA and a coach confirms readiness for advanced engagement.
  - `early_career_approval` — an early-career professional submits a lightweight application and an admin/coach approves it.
- ACIA uses indexing (tiered bands per pathway/dimension), never a composite score, and never presents a pass/fail outcome to the participant.

### Transition step (ACIA → Cohort Session)

The move from ACIA into the cohort session is an explicit, rule-based decision step — not an automatic unlock and not an ML classifier. It runs once ACIA is complete and considers four inputs:

1. `aciaCompletionStatus` — has the participant finished their ACIA session.
2. Readiness indicators — count of `ACIAIndex` bands at `Aligned`/`Strong` against a fixed, documented threshold (`ACIA_READINESS_BAND_THRESHOLD`).
3. `participantIntent` (`ready_to_continue`|`not_yet`|`undecided`) — the participant's own stated intent, captured on the Career Alignment Profile screen; never assumed.
4. Staff approval (`not_required`|`pending`|`approved`|`declined`) — a coach's confirmation, required whenever the rule leans toward inviting someone.

The rule always resolves to exactly one of three outcomes:

- **`invite_to_cohort`** — ACIA complete, readiness threshold met, intent is `ready_to_continue`, staff approval is `approved`.
- **`remain_in_acia`** — ACIA incomplete, intent is `not_yet`, or staff has declined; always paired with a `recommendedNextAction` message, never a rejection notice.
- **`flag_for_review`** — signals conflict (e.g. strong readiness but undecided intent, or intent to continue without enough readiness signal, or everything aligned but staff approval still pending); paired with a `reviewReason` and routed to the coach review queue.

The rule logic lives in `worker.js` as `evaluateAciaTransition()`, is versioned (`ruleVersion`) for auditability, and is deliberately simple/transparent — thresholds and branches only, no hidden weighting.

### Entities (extends Core Entities above)

- `ACIASession` — one full ACIA run for a user (status, pathway scope, timestamps).
- `ACIAScenario` — a reusable scenario/simulation definition tagged by pathway and behavioral dimension.
- `ACIAObservation` — raw behavioral capture per scenario response (response time, retries, raw telemetry payload).
- `ACIAIndex` — computed per-pathway, per-dimension index bands from a completed session; this is the "career alignment profile" shown to the participant.
- `ACIARetentionSignal` — post-placement check-in compared against the baseline `ACIAIndex`, surfaced to coach/employer dashboards as a drift flag.
- `CohortEligibility` — the gate record tracking how and whether a participant becomes eligible for the cohort session (`source`, `status`, `reviewedBy`, `applicationNote`). `status` now also includes `flagged_for_review`, and it carries `transitionDecisionId`.
- `ACIATransitionDecision` — one row per rule evaluation: `userId`, `aciaSessionId`, `inputsSnapshot` (the four inputs above), `outcome`, `recommendedNextAction` or `reviewReason`, `ruleVersion`, `decidedAt`.

Field additions to existing entities: `User.entryPath` (`youth`|`early_career_professional`), `User.cohortAccessStatus` (`acia_only`|`invited`|`enrolled`), `User.cohortIntent` (`ready_to_continue`|`not_yet`|`undecided`, participant-set), `Match.aciaIndexSessionAtPlacement`, `ConsentRecord.scope` gains `acia_assessment`, `AuditLog.action` gains `acia_index_generated`, `acia_index_viewed`, `acia_retention_signal_generated`, `acia_transition_decided`.

### Minimal screens (MVP)

| Screen | Rail | Notes |
|---|---|---|
| ACIA Welcome | Youth | Platform front door; folds in lightweight signup + consent |
| ACIA Scenario Runner | Youth | Sequential scenario/simulation presentation |
| Career Alignment Profile | Youth | Per-pathway bands; captures `cohortIntent` via an explicit action; shows the transition outcome inline as one of three states — "keep exploring" (`remain_in_acia`), "with your coach" (`flag_for_review`), or "you're invited" (`invite_to_cohort`) — never pass/fail |
| Early-Career Application | Early-career | Lightweight form, separate from ACIA scenarios |
| Cohort Invitation / Welcome | Youth + early-career | Soft, celebratory framing into the cohort session |
| Pathway Selection | Cohort session | Moved inside the cohort session as its first step, informed by the carried-over profile |

Readiness review, `flag_for_review` transitions, and early-career approval all reuse the existing coach/admin review-queue pattern — no dedicated new screens for the pilot.

### Routes (see worker.js for stub implementations)

`POST /acia/session/start`, `GET /acia/session/:sessionId/next`, `POST /acia/observations`, `POST /acia/session/:sessionId/complete`, `GET /acia/index/:userId`, `POST /acia/transition/:userId/intent`, `POST /acia/transition/:userId/evaluate`, `GET /acia/transition/:userId`, `POST /early-career/application`, `GET /cohort-eligibility`, `POST /cohort-eligibility/:id/decision`, `GET /cohort/invite-status/:userId`, `GET /acia/retention-signals`, `POST /acia/retention-signals/generate`.

`evaluate` is the only ACIA route that runs real logic (`evaluateAciaTransition()`); every other ACIA/cohort route remains a mock-response stub pending persistence.

## Regulatory and Compliance Requirements

AACP must:

- Map competencies to aviation and aerospace role families aligned with CARs and Transport Canada guidance where applicable
- Support pilot-related pathways and licensing progression where relevant (permits, licences, ratings, medical requirements)
- Display source references for regulatory or training guidance
- Treat AI outputs as decision support, not authoritative compliance rulings
- Require human review for regulatory-sensitive outputs; the Competency Evaluator uses VR telemetry and produces automated CompetencyIndex outputs without manual review in the standard flow
- Keep rationale logs for CompetencyIndex and ReadinessIndex decisions, scoring, and matching decisions

AACP must also:

- Collect only the minimum personal information needed for the pilot
- Obtain and record consent for personal data processing
- Support privacy notices, retention rules, and access controls
- Protect data using encryption, RBAC, audit logs, and secure storage
- Be designed for PIPEDA-aligned data handling for Canadian operations and federally regulated partners

## Project Workflow

1. Start in planning mode:
   - Ask for the user's goal
   - Propose a step-by-step plan
   - Wait for confirmation before writing code

2. Use incremental steps:
   - Set up project structure
   - Create core entities and APIs
   - Implement dashboards
   - Integrate AI agents
   - Add auth and RBAC
   - Add privacy and audit features

3. Write small, testable changes.

4. Always summarize what was changed and what to test next.

## Response Style

- Be concise and practical.
- Prefer bullet points over long paragraphs.
- Use tables for entities, APIs, and dashboards.
- Flag regulatory-sensitive or privacy-sensitive areas for human review.
- Do not generate legal advice or authoritative regulatory interpretations.
- When discussing regulatory content, show it as guidance with source references.
