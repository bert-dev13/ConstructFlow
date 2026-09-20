import { useEffect, useMemo, useRef, useState } from 'react';
import { listProjects, type ProjectRow } from '../lib/projectsApi';

const FALLBACK_PROJECTS: ProjectRow[] = [
  { id: 1, name: 'Provincial Capitol Annex', location: null, status: 'active' },
  { id: 2, name: 'North Zone Pipe Replacement', location: null, status: 'active' },
];

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects()
      .then((res) => setProjects(res.projects.length ? res.projects : FALLBACK_PROJECTS))
      .catch(() => setProjects(FALLBACK_PROJECTS))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
    if (open) {
      setQuery('');
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
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
        <span className="shrink-0 text-xs text-text-muted">▾</span>
      </button>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full min-w-[240px] overflow-hidden rounded-lg border border-border bg-white shadow-lg">
          <div className="border-b border-border p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search project…"
              className="w-full rounded-md border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-muted">No projects found</li>
            ) : (
              filtered.map((p) => {
                const isSelected = String(p.id) === value;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
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
        </div>
      )}
    </div>
  );
}
