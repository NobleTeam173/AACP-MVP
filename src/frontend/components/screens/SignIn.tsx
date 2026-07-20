import React, { useState } from 'react';
import { api, ApiError } from '../api';

interface SignInProps {
  onSignedIn: (auth: { token: string; userId: string }) => void;
}

// Not one of the four requested ACIA screens — a minimal bootstrap so the
// ACIA flow can call the real auth-backed routes without building a full
// registration/login UI, which was out of scope here.
export default function SignIn({ onSignedIn }: SignInProps) {
  const [email, setEmail] = useState('demo.participant@example.com');
  const [password, setPassword] = useState('Demo-Pass123!');
  const [name, setName] = useState('Demo Participant');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      let login;
      try {
        login = await api.login({ email, password });
      } catch (err) {
        // Not registered yet in this backend's in-memory store — register then retry.
        await api.register({ email, password, name, role: 'youth' });
        login = await api.login({ email, password });
      }
      onSignedIn({ token: login.accessToken, userId: login.userId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Is the backend running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen-card">
      <h1>Welcome to AACP</h1>
      <h2>Sign in to start your ACIA experience</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="button-row">
        <button className="primary" disabled={busy} onClick={handleContinue}>
          {busy ? 'Signing in…' : 'Continue'}
        </button>
      </div>
      <p className="dev-note">
        Youth accounts don't require MFA. This screen just gets a real access token from
        <code> /auth/register</code>/<code>/auth/login</code> so the ACIA screens can call the real API.
      </p>
    </div>
  );
}
