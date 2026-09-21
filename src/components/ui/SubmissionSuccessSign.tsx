'use client';

import { useEffect } from 'react';

type SubmissionSuccessSignProps = {
  open: boolean;
  title?: string;
  message?: string;
  onClose: () => void;
  /** Auto-close after ms (default 2800). Set 0 to keep open until dismissed. */
  autoCloseMs?: number;
};

/**
 * Centered success sign matching the green check + "Submission Successful" graphic.
 */
export function SubmissionSuccessSign({
  open,
  title = 'Submission Successful',
  message,
  onClose,
  autoCloseMs = 2800,
}: SubmissionSuccessSignProps) {
  useEffect(() => {
    if (!open || autoCloseMs <= 0) return;
    const t = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(t);
  }, [open, autoCloseMs, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-white/95 p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="submission-success-title"
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 120 120"
          fill="none"
          aria-hidden="true"
          className="drop-shadow-sm"
        >
          <circle cx="60" cy="60" r="52" stroke="#22c55e" strokeWidth="8" />
          <path
            d="M34 62 L52 80 L88 42"
            stroke="#22c55e"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h2
          id="submission-success-title"
          className="mt-6 text-2xl font-semibold tracking-tight text-black"
        >
          {title}
        </h2>
        {message ? (
          <p className="mt-3 max-w-sm text-sm text-neutral-600">{message}</p>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="mt-8 rounded-xl bg-[#22c55e] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#16a34a]"
        >
          OK
        </button>
      </div>
    </div>
  );
}
