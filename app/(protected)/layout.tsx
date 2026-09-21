'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../src/components/AppShell';
import { useAuth } from '../../src/context/AuthContext';
import { NO_ROLE_MESSAGE, isValidRole } from '../../src/types';

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login/');
  }, [loading, router, user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted">
        Loading session…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted">
        Redirecting to login…
      </div>
    );
  }

  if (!isValidRole(user.role)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold text-text" role="alert">
          {NO_ROLE_MESSAGE}
        </p>
        <p className="max-w-md text-sm text-text-muted">
          Your account is signed in but has no valid ConstructFlow role in Firestore.
          Contact an administrator.
        </p>
        <button
          type="button"
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white"
          onClick={async () => {
            await logout();
            router.replace('/login/');
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
