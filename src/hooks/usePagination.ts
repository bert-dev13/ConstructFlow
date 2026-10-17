import { useEffect, useMemo, useState } from 'react';

export const PAGE_SIZE = 20;

export function usePagination<T>(
  items: T[],
  options?: {
    pageSize?: number;
    /** Change this when filters/tabs change so the page resets to 1. */
    resetKey?: string | number | boolean | null;
  },
) {
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  const resetKey = options?.resetKey;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = useMemo(
    () => items.slice(start, start + pageSize),
    [items, start, pageSize],
  );

  return {
    page: safePage,
    setPage,
    pageSize,
    total,
    totalPages,
    pageItems,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    hasPagination: total > pageSize,
  };
}
