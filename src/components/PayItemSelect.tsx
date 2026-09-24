'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { listPayItems, type PayItem } from '../lib/payItemsApi';
import type { ProjectBoqItem } from '../lib/projectBoqApi';

interface PayItemSelectProps {
  value: string;
  onChange: (item: PayItem | null) => void;
  disabled?: boolean;
  fallbackLabel?: string;
  /**
   * When provided (e.g. SWA/IAR report forms), only project BOQ Pay Items are offered.
   * Same project snapshots used by PDM / S-Curve / Bar Chart — master is not edited.
   */
  projectBoqItems?: ProjectBoqItem[];
}

function boqToSelectable(item: ProjectBoqItem): PayItem {
  return {
    id: item.payItemId,
    itemNo: item.itemNo,
    normalizedItemNo: item.itemNo.toLowerCase().replace(/\s+/g, ''),
    description: item.description,
    unit: item.unit,
    active: item.active,
    version: item.payItemVersion,
    uniquenessKey: `${item.payItemId}::v${item.payItemVersion}`,
    source: 'project-boq',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: null,
  };
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

export function PayItemSelect({
  value,
  onChange,
  disabled,
  fallbackLabel,
  projectBoqItems,
}: PayItemSelectProps) {
  const [masterItems, setMasterItems] = useState<PayItem[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const useProjectScope = projectBoqItems !== undefined;

  useEffect(() => {
    if (useProjectScope) return;
    listPayItems(false).then(setMasterItems).catch(() => setMasterItems([]));
  }, [useProjectScope]);

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const items = useMemo(() => {
    if (useProjectScope) {
      return projectBoqItems!
        .filter((row) => row.active && row.payItemId && row.itemNo)
        .map(boqToSelectable);
    }
    return masterItems;
  }, [useProjectScope, projectBoqItems, masterItems]);

  const selected = items.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const key = normalizeQuery(query);
    if (!text) return items.slice(0, 100);
    return items
      .filter((item) => {
        const itemKey = normalizeQuery(item.itemNo);
        return (
          itemKey.includes(key)
          || item.itemNo.toLowerCase().includes(text)
          || item.description.toLowerCase().includes(text)
          || item.unit.toLowerCase().includes(text)
        );
      })
      .slice(0, 100);
  }, [items, query]);

  const commitSelection = (item: PayItem) => {
    onChange(item);
    setQuery(item.itemNo);
    setOpen(false);
  };

  const inputValue = open
    ? query
    : selected
      ? selected.itemNo
      : fallbackLabel || '';

  return (
    <div className="relative min-w-[220px]" ref={rootRef}>
      <input
        type="text"
        disabled={disabled}
        value={inputValue}
        placeholder={
          useProjectScope ? 'Type Item No. to search…' : 'Select Pay Item…'
        }
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setOpen(true);
          setQuery(selected?.itemNo || fallbackLabel || '');
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          if (!next.trim() && value) onChange(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            const exact = filtered.find(
              (item) => normalizeQuery(item.itemNo) === normalizeQuery(query),
            );
            const pick = exact || (filtered.length === 1 ? filtered[0] : null);
            if (pick) commitSelection(pick);
          }
        }}
        className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-xs text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {selected && !open && (
        <p className="mt-0.5 truncate text-[10px] text-text-muted" title={selected.description}>
          {selected.description}
        </p>
      )}
      {open && !disabled && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-text-muted">
                {useProjectScope
                  ? 'No matching project items. Add them on the project BOQ page (same list used by PDM / S-Curve).'
                  : 'No active Pay Items found.'}
              </p>
            ) : (
              filtered.map((item) => (
                <button
                  type="button"
                  key={`${item.id}-${item.version}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitSelection(item)}
                  className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-primary-light ${
                    item.id === value ? 'bg-primary-light' : ''
                  }`}
                >
                  <span className="block text-xs font-semibold text-text">
                    {item.itemNo} · {item.unit}
                    {useProjectScope ? '' : ` · v${item.version}`}
                  </span>
                  <span className="block truncate text-[11px] text-text-muted">
                    {item.description}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
