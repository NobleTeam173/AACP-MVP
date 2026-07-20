import React, { useState } from 'react';
import { api, ApiError, Scenario } from '../api';

interface AciaActivityProps {
  token: string;
  sessionId: string;
  initialScenario: Scenario;
  onCompleted: () => void;
}

// The stub backend serves exactly two scenarios per session (the one
// returned by /acia/session/start, then a fixed second one from
// /acia/session/:id/next) — this constant tracks that until the backend
// serves a real, variable-length mission sequence.
const TOTAL_SCENARIOS = 2;

export default function AciaActivity({ token, sessionId, initialScenario, onCompleted }: AciaActivityProps) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!selectedOptionId) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitObservation(token, {
        sessionId,
        scenarioId: scenario.scenarioId,
        selectedOptionId,
      });

      if (scenarioIndex + 1 < TOTAL_SCENARIOS) {
        const { scenario: next } = await api.nextScenario(token, sessionId);
        setScenario(next);
        setScenarioIndex(scenarioIndex + 1);
        setSelectedOptionId(null);
      } else {
        await api.completeSession(token, sessionId);
        onCompleted();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong recording your response.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen-card">
      <div className="progress-dots">
        {Array.from({ length: TOTAL_SCENARIOS }).map((_, i) => (
          <span key={i} className={`progress-dot${i <= scenarioIndex ? ' is-complete' : ''}`} />
        ))}
      </div>
      <h1>{scenario.title}</h1>
      <h2>
        Scenario {scenarioIndex + 1} of {TOTAL_SCENARIOS}
      </h2>
      <p>{scenario.prompt}</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="option-list">
        {scenario.options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            className={`option-card${selectedOptionId === option.optionId ? ' is-selected' : ''}`}
            onClick={() => setSelectedOptionId(option.optionId)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="button-row">
        <button className="primary" disabled={busy || !selectedOptionId} onClick={handleSubmit}>
          {busy
            ? 'Recording…'
            : scenarioIndex + 1 < TOTAL_SCENARIOS
              ? 'Next scenario'
              : 'Finish ACIA'}
        </button>
      </div>
    </div>
  );
}
