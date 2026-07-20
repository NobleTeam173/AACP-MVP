import React, { useEffect, useState } from 'react';
import { api, ApiError, ProfileEntry } from '../api';

interface AciaProfileProps {
  token: string;
  userId: string;
  onContinue: (profile: ProfileEntry[]) => void;
}

export default function AciaProfile({ token, userId, onContinue }: AciaProfileProps) {
  const [profile, setProfile] = useState<ProfileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getIndex(token, userId)
      .then((res) => {
        if (!cancelled) setProfile(res.profile);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your profile.');
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  return (
    <div className="screen-card">
      <h1>Your Career Alignment Profile</h1>
      <h2>What ACIA observed — no scores, no rankings</h2>
      {error && <div className="error-banner">{error}</div>}
      {!profile && !error && <p className="muted">Loading your profile…</p>}
      {profile && (
        <>
          <table className="profile-table">
            <thead>
              <tr>
                <th>Pathway</th>
                <th>Dimension</th>
                <th>Where you're at</th>
              </tr>
            </thead>
            <tbody>
              {profile.map((entry, i) => (
                <tr key={i}>
                  <td>{entry.pathway}</td>
                  <td>{entry.dimension.replace(/_/g, ' ')}</td>
                  <td>
                    <span className={`band-pill band-${entry.band}`}>{entry.band}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            These bands describe how you approached the scenarios — they're not a ranking against
            other participants, and there's no pass/fail threshold here.
          </p>
          <div className="button-row">
            <button className="primary" onClick={() => onContinue(profile)}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}
