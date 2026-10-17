'use client';

import type { DashboardKpi } from '../lib/dashboardApi';
import { NavIcon, type NavIconName } from './NavIcon';

type KpiKey = 'visibleProjects' | 'pendingApprovals' | 'delayedProjects' | 'inputWarnings';

interface KpiCardsProps {
  kpis?: {
    visibleProjects: DashboardKpi;
    pendingApprovals: DashboardKpi;
    delayedProjects: DashboardKpi;
    inputWarnings: DashboardKpi;
  };
  loading?: boolean;
  cards?: KpiKey[];
}

const CARD_META: { key: KpiKey; title: string; dot: string; icon: NavIconName }[] = [
  { key: 'visibleProjects', title: 'Visible Projects', dot: 'bg-primary', icon: 'projects' },
  { key: 'pendingApprovals', title: 'Pending Approvals', dot: 'bg-text-muted/40', icon: 'approval' },
  { key: 'delayedProjects', title: 'Delayed Projects', dot: 'bg-warning', icon: 'schedule' },
  { key: 'inputWarnings', title: 'Input Warnings', dot: 'bg-warning', icon: 'cross' },
];

export function KpiCards({ kpis, loading, cards }: KpiCardsProps) {
  const visibleCards = cards
    ? CARD_META.filter((card) => cards.includes(card.key))
    : CARD_META;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {visibleCards.map((card) => {
        const data = kpis?.[card.key];
        return (
          <div
            key={card.key}
            className="relative rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{card.title}</p>
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary`}>
                <NavIcon name={card.icon} className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold text-text">
              {loading ? '…' : (data?.value ?? '—')}
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {loading ? 'Loading from database…' : (data?.label ?? '')}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function PeriodPill({ period }: { period?: string }) {
  return (
    <span className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs font-medium text-text-muted">
      {period ?? 'Current period'}
    </span>
  );
}
