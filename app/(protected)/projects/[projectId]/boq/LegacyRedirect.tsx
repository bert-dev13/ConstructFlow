'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RoleGuard } from '../../../../../src/components/RoleGuard';

/** Redirects /projects/[projectId]/boq to /projects/boq/?projectId=... */
export default function LegacyRedirect() {
  const params = useParams<{ projectId?: string }>();
  const router = useRouter();
  const projectId = String(params?.projectId ?? '').trim();

  useEffect(() => {
    if (!projectId || projectId === '_') {
      router.replace('/projects/');
      return;
    }
    router.replace(`/projects/boq/?projectId=${encodeURIComponent(projectId)}`);
  }, [projectId, router]);

  return (
    <RoleGuard roles={['engineer_1']}>
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-muted">
        Opening project Pay Items…
      </div>
    </RoleGuard>
  );
}
