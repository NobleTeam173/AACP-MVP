import React, { useState } from 'react';
import NavBar, { STEPS, StepKey } from './components/NavBar';
import SignIn from './screens/SignIn';
import AciaIntake from './screens/AciaIntake';
import AciaActivity from './screens/AciaActivity';
import AciaProfile from './screens/AciaProfile';
import AciaTransition from './screens/AciaTransition';
import { ProfileEntry, Scenario } from './api';

interface AuthState {
  token: string;
  userId: string;
}

interface SessionState {
  sessionId: string;
  scenario: Scenario;
}

export default function App() {
  const [step, setStep] = useState<StepKey>('signin');
  const [maxReachedIndex, setMaxReachedIndex] = useState(0);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [profile, setProfile] = useState<ProfileEntry[] | null>(null);

  function goTo(nextStep: StepKey) {
    const nextIndex = STEPS.findIndex((s) => s.key === nextStep);
    setMaxReachedIndex((current) => Math.max(current, nextIndex));
    setStep(nextStep);
  }

  function handleNavigate(target: StepKey) {
    const targetIndex = STEPS.findIndex((s) => s.key === target);
    if (targetIndex <= maxReachedIndex) setStep(target);
  }

  return (
    <div className="app-shell">
      <NavBar currentStep={step} maxReachedIndex={maxReachedIndex} onNavigate={handleNavigate} />
      <main className="app-main">
        {step === 'signin' && (
          <SignIn
            onSignedIn={(nextAuth) => {
              setAuth(nextAuth);
              goTo('intake');
            }}
          />
        )}

        {step === 'intake' && auth && (
          <AciaIntake
            token={auth.token}
            onStarted={(nextSession) => {
              setSession(nextSession);
              goTo('activity');
            }}
          />
        )}

        {step === 'activity' && auth && session && (
          <AciaActivity
            token={auth.token}
            sessionId={session.sessionId}
            initialScenario={session.scenario}
            onCompleted={() => goTo('profile')}
          />
        )}

        {step === 'profile' && auth && (
          <AciaProfile
            token={auth.token}
            userId={auth.userId}
            onContinue={(nextProfile) => {
              setProfile(nextProfile);
              goTo('transition');
            }}
          />
        )}

        {step === 'transition' && auth && profile && (
          <AciaTransition token={auth.token} userId={auth.userId} profile={profile} />
        )}
      </main>
    </div>
  );
}
