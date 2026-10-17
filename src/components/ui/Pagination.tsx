'use client';

import { PAGE_SIZE } from '../../hooks/usePagination';

type PaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  className?: string;
  /** Hide the control entirely when there is only one page. Default true. */
  hideWhenSinglePage?: boolean;
};

function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('…');
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (end < total - 1) pages.push('…');
  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  totalPages,
  total,
  from,
  to,
  onPageChange,
  pageSize = PAGE_SIZE,
  className = '',
  hideWhenSinglePage = true,
}: PaginationProps) {
  if (total === 0) return null;
  if (hideWhenSinglePage && totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <div
      className={`flex flex-col gap-3 border-t border-border bg-surface/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <p className="text-xs text-text-muted">
        Showing <span className="font-semibold text-text">{from}</span>–
        <span className="font-semibold text-text">{to}</span> of{' '}
        <span className="font-semibold text-text">{total}</span>
        <span className="text-text-muted"> · {pageSize} per page</span>
      </p>

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>

        {pages.map((entry, index) =>
          entry === '…' ? (
            <span
              key={`ellipsis-${index}`}
              className="px-1.5 text-xs text-text-muted"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              aria-current={entry === page ? 'page' : undefined}
              onClick={() => onPageChange(entry)}
              className={`min-w-[2rem] rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                entry === page
                  ? 'bg-primary text-white'
                  : 'border border-border bg-card text-text-muted hover:bg-surface-muted'
              }`}
            >
              {entry}
            </button>
          ),
        )}

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
