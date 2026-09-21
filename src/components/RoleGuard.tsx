'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '../types';
import { useAuth } from '../context/AuthContext';

/**
 * Restricts a route to Firestore-assigned roles on `user.role`.
 * Never uses a UI-selected role. Wrong role → dashboard (not the forbidden page).
 */
export function RoleGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login/');
      return;
    }
    if (!loading && user && !roles.includes(user.role)) {
      router.replace('/dashboard/');
    }
  }, [loading, router, roles, user]);

  if (loading || !user || !roles.includes(user.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted">
        Loading session…
      </div>
    );
  }

  return <>{children}</>;
}
