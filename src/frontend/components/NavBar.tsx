import React from 'react';

export type StepKey = 'signin' | 'intake' | 'activity' | 'profile' | 'transition';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'signin', label: 'Sign In' },
  { key: 'intake', label: 'ACIA Welcome' },
  { key: 'activity', label: 'ACIA Activity' },
  { key: 'profile', label: 'Career Profile' },
  { key: 'transition', label: 'Next Step' },
];

interface NavBarProps {
  currentStep: StepKey;
  maxReachedIndex: number;
  onNavigate: (step: StepKey) => void;
}

export default function NavBar({ currentStep, maxReachedIndex, onNavigate }: NavBarProps) {
  return (
    <nav className="nav-bar">
      <span className="nav-brand">AACP · ACIA</span>
      <div className="nav-steps">
        {STEPS.map((step, index) => {
          const isActive = step.key === currentStep;
          const isDone = index < STEPS.findIndex((s) => s.key === currentStep);
          const isReachable = index <= maxReachedIndex;
          return (
            <button
              key={step.key}
              type="button"
              className={`nav-step${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
              disabled={!isReachable}
              onClick={() => onNavigate(step.key)}
            >
              {step.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export { STEPS };
