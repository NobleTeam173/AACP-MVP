import React, { useState } from 'react';
import {
  api,
  ApiError,
  ParticipantIntent,
  ProfileEntry,
  StaffApprovalStatus,
  TransitionResult,
} from '../api';

interface AciaTransitionProps {
  token: string;
  userId: string;
  profile: ProfileEntry[];
}

const INTENT_OPTIONS: { value: ParticipantIntent; label: string }[] = [
  { value: 'ready_to_continue', label: "I'm ready to explore the cohort session" },
  { value: 'undecided', label: "I'm not sure yet" },
  { value: 'not_yet', label: "Not yet — I'd like to keep exploring ACIA" },
];

const OUTCOME_COPY: Record<TransitionResult['outcome'], { heading: string; tone: string }> = {
  invite_to_cohort: { heading: "You're invited!", tone: 'You can move into the cohort session.' },
  remain_in_acia: { heading: 'Keep exploring', tone: 'No rush — pick up where you left off whenever you like.' },
  flag_for_review: { heading: "With your coach", tone: 'A coach will follow up with you on next steps.' },
};

function countReadyBands(profile: ProfileEntry[]): number {
  return profile.filter((entry) => entry.band === 'Aligned' || entry.band === 'Strong').length;
}

export default function AciaTransition({ token, userId, profile }: AciaTransitionProps) {
  const [intent, setIntent] = useState<ParticipantIntent | null>(null);
  const [staffApproval, setStaffApproval] = useState<StaffApprovalStatus>('not_required');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransitionResult | null>(null);

  async function handleSeeNextStep() {
    if (!intent) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitIntent(token, userId, intent);
      const evaluation = await api.evaluateTransition(token, userId, {
        aciaCompletionStatus: 'complete',
        readinessBandCount: countReadyBands(profile),
        participantIntent: intent,
        staffApprovalStatus: staffApproval,
      });
      setResult(evaluation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not evaluate your next step.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen-card">
      <h1>What's next?</h1>
      <h2>This decides whether you move into the cohort session</h2>

      {!result && (
        <>
          <p className="muted">
            There's no gate here to pass — just tell us where you're at, and we'll let you know
            what happens next.
          </p>
          <div className="intent-options">
            {INTENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`option-card${intent === opt.value ? ' is-selected' : ''}`}
                onClick={() => setIntent(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="field">
            <label htmlFor="staffApproval">Demo control: simulate your coach's decision</label>
            <select
              id="staffApproval"
              value={staffApproval}
              onChange={(e) => setStaffApproval(e.target.value as StaffApprovalStatus)}
            >
              <option value="not_required">Not asked yet</option>
              <option value="pending">Pending review</option>
              <option value="approved">Approved</option>
              <option value="declined">Declined</option>
            </select>
          </div>

          {error && <div className="error-banner">{error}</div>}
          <div className="button-row">
            <button className="primary" disabled={busy || !intent} onClick={handleSeeNextStep}>
              {busy ? 'Checking…' : 'See my next step'}
            </button>
          </div>
        </>
      )}

      {result && (
        <>
          <div className={`outcome-banner outcome-${result.outcome}`}>
            <strong>{OUTCOME_COPY[result.outcome].heading}</strong>
            <p style={{ margin: '0.5rem 0 0' }}>{OUTCOME_COPY[result.outcome].tone}</p>
          </div>
          {result.recommendedNextAction && <p>{result.recommendedNextAction}</p>}
          {result.reviewReason && <p className="muted">{result.reviewReason}</p>}
          <div className="button-row">
            <button className="secondary" onClick={() => setResult(null)}>
              Try a different answer
            </button>
          </div>
        </>
      )}
    </div>
  );
}
