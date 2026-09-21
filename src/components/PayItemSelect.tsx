'use client';

import { useEffect, useMemo, useState } from 'react';
import { listPayItems, type PayItem } from '../lib/payItemsApi';

interface PayItemSelectProps {
  value: string;
  onChange: (item: PayItem | null) => void;
  disabled?: boolean;
  fallbackLabel?: string;
}

export function PayItemSelect({ value, onChange, disabled, fallbackLabel }: PayItemSelectProps) {
  const [items, setItems] = useState<PayItem[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    listPayItems(false).then(setItems).catch(() => setItems([]));
  }, []);

  const selected = items.find((item) => item.id === value);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return items.slice(0, 100);
    return items.filter((item) =>
      [item.itemNo, item.description, item.unit].some((field) => field.toLowerCase().includes(text)),
    ).slice(0, 100);
  }, [items, query]);

  return (
    <div className="relative min-w-[220px]">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-xs text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {selected ? `${selected.itemNo} — ${selected.description}` : fallbackLabel || 'Select Pay Item'}
      </button>
      {open && !disabled && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Item No. or Description…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-primary"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-text-muted">No active Pay Items found.</p>
            ) : filtered.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  onChange(item);
                  setOpen(false);
                  setQuery('');
                }}
                className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-primary-light ${item.id === value ? 'bg-primary-light' : ''}`}
              >
                <span className="block text-xs font-semibold text-text">{item.itemNo} · {item.unit}</span>
                <span className="block truncate text-[11px] text-text-muted">{item.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
