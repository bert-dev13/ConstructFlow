'use client';

import { useEffect } from 'react';
import { useNavigate } from '../lib/nextRouter';

/** Old role-picker route — redirects to credential-only login. */
export function RoleSelectionPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/login', { replace: true });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center text-text-muted">
      Redirecting to login…
    </div>
  );
}
