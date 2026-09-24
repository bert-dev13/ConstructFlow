'use client';

import type { ReactNode } from 'react';
import { Link } from '../../lib/nextRouter';
import { NavIcon } from '../NavIcon';
import { StatusBadge } from './StatusBadge';

interface PageHeaderProps {
  /** Small uppercase label above the title */
  badge?: string;
  title: string;
  /** Kept for callers; shown as tooltip on the title in the compact header */
  description?: string;
  status?: string;
  backTo?: string;
  backLabel?: string;
  /** Extra chips / controls shown with actions on the right */
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  badge,
  title,
  description,
  status,
  backTo,
  backLabel = 'Back',
  children,
  actions,
  className = '',
}: PageHeaderProps) {
  const hasRight = Boolean(children || actions || status);

  return (
    <header
      className={`page-header-in relative z-20 overflow-visible rounded-xl border border-border/80 bg-card/90 px-4 py-3 shadow-sm sm:px-5 ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-xl"
      >
        <div className="page-accent-sweep h-full bg-gradient-to-r from-primary via-accent to-transparent" />
      </div>

      <div className="page-toolbar-in flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {backTo ? (
            <Link
              to={backTo}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text transition hover:border-primary/40 hover:bg-primary-light hover:text-primary"
            >
              <NavIcon name="arrow-left" className="h-3.5 w-3.5" />
              {backLabel}
            </Link>
          ) : null}

          <div className="min-w-0">
            {badge ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                {badge}
              </p>
            ) : null}
            <h1
              className="font-[family-name:var(--font-display)] text-xl font-semibold leading-tight tracking-tight text-text sm:text-2xl"
              title={description}
            >
              {title}
            </h1>
          </div>
        </div>

        {hasRight ? (
          <div className="relative z-30 flex flex-wrap items-center justify-end gap-2">
            {status ? <StatusBadge status={status} /> : null}
            {children}
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
