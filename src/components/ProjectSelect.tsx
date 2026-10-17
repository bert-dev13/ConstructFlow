'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listProjects, type ProjectRow } from '../lib/projectsApi';
import { NavIcon } from './NavIcon';

interface ProjectSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Shown when the current id is not in the loaded list. */
  fallbackLabel?: string;
}

export function ProjectSelect({
  value,
  onChange,
  disabled,
  className,
  fallbackLabel,
}: ProjectSelectProps) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuBox, setMenuBox] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listProjects()
        .then((res) => {
          if (!cancelled) setProjects(res.projects);
        })
        .catch(() => {
          if (!cancelled) setProjects([]);
        })
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });

    void load();
    // Only retry if the first pass returned nothing (auth may still be hydrating).
    const retry = window.setTimeout(() => {
      if (cancelled) return;
      void listProjects()
        .then((res) => {
          if (!cancelled && res.projects.length) setProjects(res.projects);
        })
        .catch(() => {
          /* keep prior */
        });
    }, 800);

    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, []);

  const placeMenu = useCallback(() => {
    const trigger = containerRef.current?.querySelector('button');
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const searchRow = 52;
    const width = Math.max(rect.width, 280);
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const room = (openUp ? spaceAbove : spaceBelow) - searchRow;
    const maxHeight = Math.max(120, Math.min(Math.round(window.innerHeight * 0.55), room));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    setMenuBox({
      top: openUp ? Math.max(8, rect.top - gap - maxHeight - searchRow) : rect.bottom + gap,
      left,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

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
  }, [open, placeMenu]);

  useEffect(() => {
    const el = menuRef.current;
    if (!open || !el) return;
    try {
      if (!el.matches(':popover-open')) el.showPopover();
    } catch {
      /* popover already showing */
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, menuBox]);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const selected = projects.find((p) => String(p.id) === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || (p.location ?? '').toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-3.5 py-2.5 text-left text-sm text-text shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70"
      >
        <span className="truncate">
          {selected
            ? selected.name
            : !loaded
              ? 'Loading projects…'
              : fallbackLabel?.trim() || 'Select project'}
        </span>
        <NavIcon name="chevron-down" className="h-4 w-4 shrink-0 text-text-muted" />
      </button>

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
              className="overflow-hidden rounded-lg border border-border bg-white shadow-lg"
            >
              <div className="border-b border-border p-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search project…"
                  className="w-full rounded-md border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <ul className="overflow-y-auto py-1" style={{ maxHeight: menuBox.maxHeight }}>
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-text-muted">No projects found</li>
                ) : (
                  filtered.map((p) => {
                    const isSelected = String(p.id) === value;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            onChange(String(p.id));
                            setOpen(false);
                          }}
                          className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm transition hover:bg-surface-muted ${
                            isSelected ? 'bg-primary-light/50 font-semibold text-primary' : 'text-text'
                          }`}
                        >
                          <span className="w-full truncate">{p.name}</span>
                          {p.location && (
                            <span className="w-full truncate text-[11px] text-text-muted">
                              {p.location}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
