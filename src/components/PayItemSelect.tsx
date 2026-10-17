'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listBoqItems, searchBoqItems } from '../lib/boqLookup';
import { listPayItems, type PayItem } from '../lib/payItemsApi';
import type { ProjectBoqItem } from '../lib/projectBoqApi';

interface PayItemSelectProps {
  value: string;
  onChange: (item: PayItem | null) => void;
  disabled?: boolean;
  fallbackLabel?: string;
  /**
   * When provided (SWA/IAR), project BOQ and schedule item numbers are listed first.
   * Pay Item Master rows are included so the DPWH standard list can be searched too.
   */
  projectBoqItems?: ProjectBoqItem[];
  /** Re-fetch project BOQ when the dropdown opens (picks up newly saved BOQ rows). */
  onRefreshProjectBoq?: () => void | Promise<void>;
  /**
   * SWA Item No. may be a pay item or any text, including a section heading
   * such as "I. OTHER GENERAL REQUIREMENTS".
   */
  allowCustomText?: boolean;
  onCustomText?: (text: string) => void;
}

function boqToSelectable(item: ProjectBoqItem): PayItem {
  const itemNo = String(item.itemNo || '').trim();
  return {
    id: item.payItemId || item.id,
    itemNo: itemNo || item.payItemId || item.id,
    normalizedItemNo: (itemNo || item.payItemId || item.id).toLowerCase().replace(/\s+/g, ''),
    description: item.description || '',
    unit: item.unit || '',
    active: item.active,
    version: item.payItemVersion || 1,
    uniquenessKey: `${item.payItemId || item.id}::${item.id}::v${item.payItemVersion || 1}`,
    source: 'project-boq',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: null,
  };
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function catalogToSelectable(hit: { itemNo: string; description: string; unit: string }): PayItem {
  const itemNo = hit.itemNo.trim();
  return {
    id: `catalog:${itemNo}`,
    itemNo,
    normalizedItemNo: normalizeQuery(itemNo),
    description: hit.description || '',
    unit: hit.unit && hit.unit !== '—' ? hit.unit : '',
    active: true,
    version: 1,
    uniquenessKey: `catalog:${normalizeQuery(itemNo)}`,
    source: 'catalog',
    createdAt: '',
    updatedAt: '',
    createdBy: null,
  };
}

export function PayItemSelect({
  value,
  onChange,
  disabled,
  fallbackLabel,
  projectBoqItems,
  onRefreshProjectBoq,
  allowCustomText = false,
  onCustomText,
}: PayItemSelectProps) {
  const [masterItems, setMasterItems] = useState<PayItem[]>([]);
  const [query, setQuery] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuBox, setMenuBox] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const useProjectScope = projectBoqItems !== undefined;

  const refreshMasterItems = useCallback(() => {
    listPayItems(false)
      .then(setMasterItems)
      .catch(() => setMasterItems([]));
  }, []);

  useEffect(() => {
    // SWA/IAR already have the project BOQ plus the local DPWH catalog.
    // Loading the Firestore Pay Item Master here reads every master document.
    if (useProjectScope) return;
    refreshMasterItems();
  }, [refreshMasterItems, useProjectScope]);

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const placeMenu = useCallback(() => {
    const input = rootRef.current?.querySelector('input');
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const width = useProjectScope ? 176 : Math.min(512, window.innerWidth - 16);
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(220, Math.min(Math.round(window.innerHeight * 0.7), openUp ? spaceAbove : spaceBelow));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    setMenuBox({
      top: openUp ? rect.top - gap - maxHeight : rect.bottom + gap,
      left,
      width,
      maxHeight,
    });
  }, [useProjectScope]);

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onMove = () => placeMenu();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, placeMenu, query]);

  useEffect(() => {
    const el = menuRef.current;
    if (!open || !el) return;
    try {
      if (!el.matches(':popover-open')) el.showPopover();
    } catch {
      /* popover already showing */
    }
  }, [open, menuBox]);

  const items = useMemo(() => {
    if (useProjectScope) {
      return projectBoqItems!
        .filter((row) => row.active !== false && (row.payItemId || row.itemNo))
        .map(boqToSelectable);
    }
    return masterItems;
  }, [useProjectScope, projectBoqItems, masterItems]);

  const selected = items.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const activeQuery = filtering ? query : '';
    const key = normalizeQuery(activeQuery);
    const matchesQuery = (itemNo: string) => !key || normalizeQuery(itemNo).includes(key);
    const projectMatches = items.filter((item) => matchesQuery(item.itemNo));

    if (!useProjectScope) return projectMatches;

    const byNo = new Map<string, PayItem>();
    for (const item of projectMatches) byNo.set(normalizeQuery(item.itemNo), item);
    for (const item of masterItems) {
      if (item.active === false || !matchesQuery(item.itemNo)) continue;
      const itemKey = normalizeQuery(item.itemNo);
      if (!byNo.has(itemKey)) byNo.set(itemKey, item);
    }
    const catalogHits = key ? searchBoqItems(activeQuery, 5000) : listBoqItems();
    for (const hit of catalogHits) {
      const itemKey = normalizeQuery(hit.itemNo);
      if (!itemKey || byNo.has(itemKey)) continue;
      byNo.set(itemKey, catalogToSelectable(hit));
    }
    return [...byNo.values()];
  }, [items, masterItems, query, filtering, useProjectScope]);

  const commitSelection = (item: PayItem) => {
    onChange(item);
    setQuery(item.itemNo);
    setOpen(false);
  };

  const commitCustomText = (text: string) => {
    const trimmed = text.trim();
    const exact = filtered.find(
      (item) => normalizeQuery(item.itemNo) === normalizeQuery(trimmed),
    );
    if (exact) {
      commitSelection(exact);
      return;
    }
    onCustomText?.(trimmed);
    setQuery(trimmed);
    setOpen(false);
  };

  const inputValue =
    open && filtering ? query : selected ? selected.itemNo : fallbackLabel || '';

  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setFiltering(false);
    setQuery('');
    setOpen(true);
    if (!useProjectScope) refreshMasterItems();
    if (useProjectScope && onRefreshProjectBoq) {
      setRefreshing(true);
      void Promise.resolve(onRefreshProjectBoq()).finally(() => setRefreshing(false));
    }
  };

  return (
    <div
      className={`relative ${
        allowCustomText ? 'min-w-[16rem] w-[18rem]' : useProjectScope ? 'w-[7.25rem]' : 'min-w-[220px]'
      }`}
      ref={rootRef}
    >
      <input
        type="text"
        disabled={disabled}
        value={inputValue}
        placeholder={useProjectScope ? 'Item No.' : 'Select Pay Item…'}
        onFocus={handleFocus}
        onBlur={() => {
          const typed = query;
          const wasFiltering = filtering;
          blurTimer.current = setTimeout(() => {
            setOpen(false);
            setFiltering(false);
            if (!allowCustomText || !wasFiltering) return;
            const currentLabel = (selected?.itemNo || fallbackLabel || '').trim();
            if (typed.trim() === currentLabel) return;
            commitCustomText(typed);
          }, 150);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setFiltering(true);
          setQuery(next);
          setOpen(true);
          if (!next.trim()) {
            if (value) onChange(null);
            else if (allowCustomText) onCustomText?.('');
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!filtering) {
              setOpen(false);
              return;
            }
            const exact = filtered.find(
              (item) => normalizeQuery(item.itemNo) === normalizeQuery(query),
            );
            if (exact) {
              commitSelection(exact);
              return;
            }
            if (allowCustomText) {
              commitCustomText(query);
              return;
            }
            if (filtered.length === 1) commitSelection(filtered[0]);
          }
        }}
        className={`w-full rounded border border-border bg-white py-1.5 pl-2 text-left text-xs text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70 ${
          useProjectScope ? 'pr-5' : 'rounded-lg px-2.5 py-2'
        }`}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {useProjectScope && (
        <span className="pointer-events-none absolute right-1 top-1.5 text-[9px] text-text-muted" aria-hidden>
          ▼
        </span>
      )}
      {selected && !open && !useProjectScope && (
        <p className="mt-0.5 truncate text-[10px] text-text-muted" title={selected.description}>
          {selected.description}
        </p>
      )}
      {open && !disabled && menuBox && typeof document !== 'undefined'
        ? createPortal(
        <div
          ref={menuRef}
          popover="manual"
          style={{
            position: 'fixed',
            margin: 0,
            top: menuBox.top,
            left: menuBox.left,
            right: 'auto',
            bottom: 'auto',
            width: menuBox.width,
          }}
          className={`overflow-hidden border border-border bg-white shadow-lg ${
            useProjectScope ? 'rounded-md' : 'rounded-xl'
          }`}
        >
          <div className="overflow-y-auto py-1" style={{ maxHeight: menuBox.maxHeight }}>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-text-muted">
                {refreshing
                  ? 'Loading item numbers…'
                  : useProjectScope
                    ? allowCustomText
                      ? 'No matching item number. Press Enter to keep this text, including a section heading.'
                      : 'No matching item number. Keep typing, for example A.1 or B.1.'
                    : 'No active Pay Items found.'}
              </p>
            ) : (
              filtered.map((item) => (
                <button
                  type="button"
                  key={item.uniquenessKey}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitSelection(item)}
                  className={`block w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-muted ${
                    item.id === value ? 'bg-surface-muted font-semibold' : ''
                  }`}
                >
                  {useProjectScope ? (
                    item.itemNo
                  ) : (
                    <>
                      <span className="block text-xs font-semibold text-text">
                        {item.itemNo} · {item.unit || '—'} · v{item.version}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {item.description}
                      </span>
                    </>
                  )}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}
