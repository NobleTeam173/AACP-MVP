// Thin fetch client for the existing worker.js routes. No new backend routes
// or mock data are introduced here — this only calls what already exists.

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

export interface Scenario {
  scenarioId: string;
  pathwayTags: string[];
  dimensionTags: string[];
  type: string;
  title: string;
  prompt: string;
  options: { optionId: string; label: string }[];
}

export interface ProfileEntry {
  pathway: string;
  dimension: string;
  band: 'Emerging' | 'Developing' | 'Aligned' | 'Strong';
}

export type ParticipantIntent = 'ready_to_continue' | 'not_yet' | 'undecided';
export type StaffApprovalStatus = 'not_required' | 'pending' | 'approved' | 'declined';
export type TransitionOutcome = 'invite_to_cohort' | 'remain_in_acia' | 'flag_for_review';

export interface TransitionResult {
  outcome: TransitionOutcome;
  recommendedNextAction?: string;
  reviewReason?: string;
}

class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request to ${path} failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  register: (body: { email: string; password: string; name: string; role: string }) =>
    request<{ userId: string; role: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    request<{ userId: string; role: string; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  startAciaSession: (token: string) =>
    request<{ sessionId: string; userId: string; firstScenario: Scenario }>(
      '/acia/session/start',
      { method: 'POST' },
      token,
    ),

  nextScenario: (token: string, sessionId: string) =>
    request<{ sessionId: string; scenario: Scenario }>(
      `/acia/session/${sessionId}/next`,
      { method: 'GET' },
      token,
    ),

  submitObservation: (
    token: string,
    body: { sessionId: string; scenarioId: string; selectedOptionId: string },
  ) => request<{ observationId: string; received: boolean }>('/acia/observations', { method: 'POST', body: JSON.stringify(body) }, token),

  completeSession: (token: string, sessionId: string) =>
    request<{ sessionId: string; status: string; indexId: string }>(
      `/acia/session/${sessionId}/complete`,
      { method: 'POST' },
      token,
    ),

  getIndex: (token: string, userId: string) =>
    request<{ userId: string; profile: ProfileEntry[]; cohortAccessStatus: string }>(
      `/acia/index/${userId}`,
      { method: 'GET' },
      token,
    ),

  submitIntent: (token: string, userId: string, cohortIntent: ParticipantIntent) =>
    request<{ userId: string; cohortIntent: string }>(
      `/acia/transition/${userId}/intent`,
      { method: 'POST', body: JSON.stringify({ cohortIntent }) },
      token,
    ),

  evaluateTransition: (
    token: string,
    userId: string,
    body: {
      aciaCompletionStatus: 'complete';
      readinessBandCount: number;
      participantIntent: ParticipantIntent;
      staffApprovalStatus: StaffApprovalStatus;
    },
  ) =>
    request<TransitionResult>(
      `/acia/transition/${userId}/evaluate`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),
};

export { ApiError };
