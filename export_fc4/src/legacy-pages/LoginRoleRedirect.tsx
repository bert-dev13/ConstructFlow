'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function LoginRoleRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login/');
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-text-muted">
      Redirecting to login…
    </div>
  );
}
