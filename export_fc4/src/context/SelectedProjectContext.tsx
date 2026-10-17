'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'sitetrack_project';

interface SelectedProjectValue {
  projectId: string;
  setProjectId: (id: string) => void;
}

const SelectedProjectContext = createContext<SelectedProjectValue | null>(null);

function readStoredProjectId(): string {
  // Never default to a hard-coded demo/sample id — those were purged and cause
  // SWA/IAR `boqItems` reads to fail with permission-denied on a missing parent.
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function SelectedProjectProvider({ children }: { children: ReactNode }) {
  // Read localStorage synchronously so SWA/IAR/PDM mount with the correct project
  // (async useEffect left the first fetch on a stale default project id).
  const [projectId, setProjectIdState] = useState<string>(readStoredProjectId);

  const setProjectId = useCallback((id: string) => {
    const next = String(id || '').trim();
    setProjectIdState(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const value = useMemo(() => ({ projectId, setProjectId }), [projectId, setProjectId]);

  return (
    <SelectedProjectContext.Provider value={value}>{children}</SelectedProjectContext.Provider>
  );
}

export function useSelectedProject() {
  const ctx = useContext(SelectedProjectContext);
  if (!ctx) {
    throw new Error('useSelectedProject must be used within SelectedProjectProvider');
  }
  return ctx;
}
