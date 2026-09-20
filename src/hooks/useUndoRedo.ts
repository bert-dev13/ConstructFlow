import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_HISTORY = 50;

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameSnapshot<T>(a: T, b: T): boolean {
  return a === b;
}

export function useUndoRedo<T>(initial: T) {
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const [present, setPresent] = useState<T>(() => clone(initial));
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncMeta = useCallback(() => {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const set = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setPresent((prev) => {
        const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
        if (sameSnapshot(prev, next)) return prev;
        pastRef.current = [...pastRef.current, clone(prev)].slice(-MAX_HISTORY);
        futureRef.current = [];
        syncMeta();
        // Updater already returns a new object — avoid a second deep clone on every keystroke.
        return next;
      });
    },
    [syncMeta],
  );

  const replace = useCallback(
    (next: T) => {
      pastRef.current = [];
      futureRef.current = [];
      setPresent(clone(next));
      syncMeta();
    },
    [syncMeta],
  );

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    setPresent((current) => {
      const previous = pastRef.current[pastRef.current.length - 1];
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [clone(current), ...futureRef.current];
      syncMeta();
      return clone(previous);
    });
  }, [syncMeta]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    setPresent((current) => {
      const next = futureRef.current[0];
      futureRef.current = futureRef.current.slice(1);
      pastRef.current = [...pastRef.current, clone(current)];
      syncMeta();
      return clone(next);
    });
  }, [syncMeta]);

  return { state: present, set, replace, undo, redo, canUndo, canRedo };
}

export function useUndoRedoKeyboard(
  undo: () => void,
  redo: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Still allow undo/redo in form fields
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, enabled]);
}
