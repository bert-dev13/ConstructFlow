'use client';

import { Link } from '../lib/nextRouter';
import type { Role } from '../types';
import { ROLE_LABELS } from '../types';
import { AGENCY_NAME, OFFICE_NAME, SYSTEM_NAME } from '../lib/branding';
import { CURRENT_PERIOD } from '../data/mockData';

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
    <>
      <header className="border-b border-border bg-card/80 px-8 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              {SYSTEM_NAME} · {OFFICE_NAME}
            </p>
            <p className="text-xs text-text-muted">
              {AGENCY_NAME} — Email-based Progress Monitoring
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {SYSTEM_NAME}
            </span>
            <span className="rounded-lg border border-border bg-surface-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Signed in
            </span>
          </div>
        </div>
      </header>

      <div className="px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {!hideBadge && (
              <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                Dashboard
              </span>
            )}
            <h1 className={`${hideBadge ? '' : 'mt-3 '}text-2xl font-bold text-text`}>{cfg.title}</h1>
            {cfg.description && (
              <p className="mt-2 max-w-2xl text-sm text-text-muted">{cfg.description}</p>
            )}
            {period && !isReviewer(role) && (
              <p className="mt-1 text-xs font-medium text-primary">Reporting period: {period}</p>
            )}
          </div>
          {cfg.primaryAction && cfg.primaryLink && (
            cfg.primaryLink.startsWith('#') ? (
              <a
                href={cfg.primaryLink}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
              >
                {cfg.primaryAction}
              </a>
            ) : (
              <Link
                to={cfg.primaryLink}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
              >
                {cfg.primaryAction}
              </Link>
            )
          )}
        </div>
      </div>
    </>
  );
}
