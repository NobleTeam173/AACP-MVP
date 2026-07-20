import React, { useState } from 'react';
import { api, ApiError, Scenario } from '../api';

interface AciaIntakeProps {
  token: string;
  onStarted: (params: { sessionId: string; scenario: Scenario }) => void;
}

export default function AciaIntake({ token, onStarted }: AciaIntakeProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBegin() {
    setBusy(true);
    setError(null);
    try {
      const { sessionId, firstScenario } = await api.startAciaSession(token);
      onStarted({ sessionId, scenario: firstScenario });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start your ACIA session.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen-card">
      <h1>Welcome aboard</h1>
      <h2>ACIA — your aviation career alignment experience</h2>
      <p>
        You're about to work through a few realistic aviation scenarios — inspections, decisions,
        and problem-solving moments across Pilot, AME, AMT, ATC, and Aerospace/STEM pathways.
      </p>
      <p className="muted">
        This isn't a test. There's no score, no pass/fail, and no ranking. What you get at the end
        is a career alignment profile — a plain description of where your instincts seem to fit
        best, so you and a coach can decide together what's next.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="button-row">
        <button className="primary" disabled={busy} onClick={handleBegin}>
          {busy ? 'Starting…' : 'Begin ACIA'}
        </button>
      </div>
    </div>
  );
}
