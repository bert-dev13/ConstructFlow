'use client';

import { useAuth } from '../context/AuthContext';
import { usePathname } from '../lib/nextRouter';
import { ROLE_LABELS } from '../types';
import { NavIcon } from './NavIcon';

const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  pdm: 'PDM Schedule',
  'bar-chart': 'Bar Chart',
  's-curve': 'S-Curve',
  reports: 'Documents',
  workflow: 'For Approval',
  schedule: 'Prepare Schedule',
  'swa-stewa': 'Reports',
};

function sectionFromPath(pathname: string | null): string {
  const segment = pathname?.split('/').filter(Boolean)[0] ?? 'dashboard';
  return SECTION_LABELS[segment] ?? 'ConstructFlow';
}

export function TopBar() {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  return (
    <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-4 border-b border-border/80 bg-card/95 px-6 py-3 shadow-sm backdrop-blur sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
          <NavIcon name="dashboard" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{sectionFromPath(pathname)}</p>
          <p className="hidden truncate text-[11px] text-text-muted sm:block">
            Cagayan Progress Monitoring
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden rounded-full border border-border bg-surface-muted px-3 py-1.5 text-[11px] font-medium text-text-muted md:inline-flex">
          {ROLE_LABELS[user.role]}
        </span>
        <div className="flex max-w-[180px] items-center gap-2 rounded-xl border border-border bg-surface-muted/60 px-3 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
            {(user.name || user.email).slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-text">{user.name}</span>
            <span className="block truncate text-[10px] text-text-muted">{user.email}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
