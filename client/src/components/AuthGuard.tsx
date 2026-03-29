import React, { useState } from 'react';

const STORAGE_KEY = 'adminSecret';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const [secret, setSecret] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  if (secret) {
    return <>{children}</>;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setError('Please enter the admin secret.');
      return;
    }
    localStorage.setItem(STORAGE_KEY, trimmed);
    setSecret(trimmed);
    setError('');
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 mb-4">
            <span className="text-3xl">🤖</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Atlas AI</h1>
          <p className="text-gray-400 text-sm mt-1">Admin Dashboard</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-100 mb-1">Sign in</h2>
          <p className="text-sm text-gray-400 mb-5">
            Enter your admin secret to access the dashboard.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="admin-secret">
                Admin Secret
              </label>
              <input
                id="admin-secret"
                type="password"
                className="input"
                placeholder="Enter admin secret..."
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError('');
                }}
                autoFocus
                autoComplete="current-password"
              />
              {error && (
                <p className="text-red-400 text-xs mt-1.5">{error}</p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full">
              Access Dashboard
            </button>
          </form>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          Set <code className="text-gray-500">ADMIN_SECRET</code> in your .env file
        </p>
      </div>
    </div>
  );
}
