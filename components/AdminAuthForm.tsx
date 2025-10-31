import React from 'react';

export default function AdminAuthForm({
  password,
  setPassword,
  loading,
  onSubmit,
}: {
  password: string;
  setPassword: (v: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void | Promise<void>;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-lg">
        <h1 className="text-center text-2xl font-bold text-foreground">Admin Access</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-input-border px-4 py-2 text-base transition duration-150 focus:border-primary focus:ring-2 focus:ring-primary"
            placeholder="Password"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-primary px-6 py-2 text-base font-semibold text-white transition duration-150 hover:bg-primary-hover disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}

