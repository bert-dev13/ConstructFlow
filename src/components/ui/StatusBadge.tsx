'use client';

const STYLES: Record<string, string> = {
  draft: 'bg-surface-muted text-text-muted border-border',
  pending_contractor: 'bg-orange-50 text-orange-800 border-orange-200',
  contractor_confirmed: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  pending_review: 'bg-amber-50 text-amber-800 border-amber-200',
  with_engineer_3: 'bg-sky-50 text-sky-800 border-sky-200',
  with_engineer_4: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  approved: 'bg-primary-light text-primary border-primary/20',
  generated: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

const LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_contractor: 'With contractor',
  contractor_confirmed: 'Contractor confirmed',
  pending_review: 'With Engineer II',
  with_engineer_3: 'With Engineer III',
  with_engineer_4: 'With Engineer IV',
  approved: 'Approved',
  generated: 'PDF Generated',
  rejected: 'Revision requested',
};

export function StatusBadge({ status }: { status: string }) {
  const key = status.replace(/ /g, '_').toLowerCase();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STYLES[key] ?? STYLES.draft}`}
    >
      {LABELS[key] ?? status.replace(/_/g, ' ')}
    </span>
  );
}

export function ReportTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    SWA: 'bg-violet-50 text-violet-700 border-violet-200',
    STEWA: 'bg-amber-50 text-amber-800 border-amber-200',
    IAR: 'bg-teal-50 text-teal-800 border-teal-200',
  };
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${colors[type] ?? 'bg-surface-muted text-text-muted border-border'}`}
    >
      {type}
    </span>
  );
}
