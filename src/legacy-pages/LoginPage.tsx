'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { NavIcon } from '../components/NavIcon';
import { NO_ROLE_MESSAGE } from '../types';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, logout, user, loading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** Avoid auth-gated tree swaps during hydration. */
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [mounted, loading, user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const profile = await login(email, password);
      if (!profile.role) {
        await logout();
        setError(NO_ROLE_MESSAGE);
        return;
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  };

  const busy = !mounted || loading || submitting;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-[#e8e8e6] via-surface to-surface-muted p-6">
      <Link
        to="/"
        className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/90 px-3.5 py-2 text-sm font-medium text-text-muted shadow-sm backdrop-blur transition hover:border-primary/40 hover:bg-white hover:text-primary md:left-8 md:top-8"
      >
        <NavIcon name="arrow-left" className="h-4 w-4" />
        Back to homepage
      </Link>

      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-xl">
        <div className="flex flex-col items-center text-center">
          <Logo size="lg" showText={false} className="items-center" />
          <p className="mt-5 text-[10px] font-bold uppercase tracking-widest text-text-muted">
            Secure sign in
          </p>
          <h1 className="mt-1 text-xl font-bold text-text">Sign in</h1>
          <p className="mt-1 text-sm text-text-muted">
            Enter your email and password to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-text" htmlFor="login-email">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="name@example.com"
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-text outline-none placeholder:text-text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-text" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter your password"
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-text outline-none placeholder:text-text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              required
            />
          </div>
          {error && (
            <p
              className={`rounded-xl px-4 py-3 text-sm ${
                error === NO_ROLE_MESSAGE
                  ? 'bg-amber-50 text-amber-900'
                  : 'bg-red-50 text-red-600'
              }`}
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : loading && mounted ? 'Checking session…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
