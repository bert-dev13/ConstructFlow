'use client';

import type { ReactNode } from 'react';
import { Link } from '../../lib/nextRouter';
import { NavIcon } from '../NavIcon';
import { StatusBadge } from './StatusBadge';

interface PageHeaderProps {
  badge?: string;
  title: string;
  description?: string;
  status?: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}

export function PageHeader({
  badge,
  title,
  description,
  status,
  backTo,
  backLabel = 'Back',
  actions,
}: PageHeaderProps) {
  return (
    <div className="border-b border-border/80 bg-gradient-to-b from-card to-surface/30 px-8 py-6">
      {backTo && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-semibold text-text shadow-sm transition hover:border-primary/50 hover:bg-primary-light hover:text-primary"
        >
          <NavIcon name="arrow-left" className="h-4 w-4" />
          {backLabel}
        </Link>
      )}
      <div className={`flex flex-wrap items-start justify-between gap-4 ${backTo ? 'mt-4' : ''}`}>
        <div className="max-w-3xl">
          {badge && (
            <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
              {badge}
            </span>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-2xl font-normal text-text sm:text-3xl">{title}</h1>
            {status && <StatusBadge status={status} />}
          </div>
          {description && <p className="mt-2 text-sm leading-relaxed text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
