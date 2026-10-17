'use client';

type Props = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  className?: string;
};

export function UndoRedoToolbar({ canUndo, canRedo, onUndo, onRedo, className = '' }: Props) {
  return (
    <div className={`flex items-center gap-1 ${className}`} role="group" aria-label="Undo and redo">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-text shadow-sm transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-text shadow-sm transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Redo
      </button>
    </div>
  );
}
