'use client';

import { Link } from '../lib/nextRouter';
import type { Role } from '../types';
import { ROLE_LABELS } from '../types';
import { AGENCY_NAME, OFFICE_NAME, SYSTEM_NAME } from '../lib/branding';
import { CURRENT_PERIOD } from '../data/mockData';
import { PageHeader } from './ui/PageHeader';

const isReviewer = (role: Role) =>
  role === 'engineer_2' || role === 'engineer_3' || role === 'engineer_4';

const CONFIG: Record<
  Role,
  {
    title: string;
    description: string | null;
    primaryAction?: string;
    primaryLink?: string;
  }
> = {
  engineer_1: {
    title: 'Engineer I Dashboard',
    description: `Prepare progress reports, enter schedule data, and submit for Engineer II approval. Current period: ${CURRENT_PERIOD}.`,
    primaryAction: 'New Progress Report',
    primaryLink: '/reports',
  },
  engineer_2: {
    title: ROLE_LABELS.engineer_2,
    description: 'Review submitted reports, monitor approval work, and access finalized project documents.',
    primaryAction: 'Open approval queue',
    primaryLink: '/workflow',
  },
  engineer_3: {
    title: ROLE_LABELS.engineer_3,
    description: 'Review assigned reports and keep project approvals moving through the workflow.',
    primaryAction: 'Open approval queue',
    primaryLink: '/workflow',
  },
  engineer_4: {
    title: ROLE_LABELS.engineer_4,
    description: 'Finalize approved reports, manage documents, and maintain the reporting archive.',
    primaryAction: 'Open approval queue',
    primaryLink: '/workflow',
  },
  contractor: {
    title: 'Contractor Dashboard',
    description: `Prepare construction schedules and progress reports (SWA, STEWA, IAR), then submit for engineer approval. Current period: ${CURRENT_PERIOD}.`,
    primaryAction: 'SWA / STEWA / IAR',
    primaryLink: '/swa-stewa',
  },
};

interface DashboardHeaderProps {
  role: Role;
  period?: string;
}

export function DashboardHeader({ role, period }: DashboardHeaderProps) {
  const cfg = CONFIG[role];
  const hideBadge = isReviewer(role);

  return (
    <div className="space-y-3 px-8 pb-2 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card/80 px-3 py-2 text-[11px] text-text-muted shadow-sm">
        <p className="font-semibold uppercase tracking-widest">
          {SYSTEM_NAME} · {OFFICE_NAME}
        </p>
        <p className="truncate">{AGENCY_NAME}</p>
      </div>

      <PageHeader
        badge={hideBadge ? undefined : 'Dashboard'}
        title={cfg.title}
        description={cfg.description ?? undefined}
        actions={
          <>
            {period && !isReviewer(role) ? (
              <span className="rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 text-[11px] font-medium text-text">
                Period: <span className="font-semibold text-primary">{period}</span>
              </span>
            ) : null}
            {cfg.primaryAction && cfg.primaryLink ? (
              cfg.primaryLink.startsWith('#') ? (
                <a
                  href={cfg.primaryLink}
                  className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-primary-dark"
                >
                  {cfg.primaryAction}
                </a>
              ) : (
                <Link
                  to={cfg.primaryLink}
                  className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-primary-dark"
                >
                  {cfg.primaryAction}
                </Link>
              )
            ) : null}
          </>
        }
      />
    </div>
  );
}
