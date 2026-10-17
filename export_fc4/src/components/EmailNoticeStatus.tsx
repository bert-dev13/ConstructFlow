'use client';

const CLAIM_STALE_MS = 10 * 60 * 1000;

const LABELS: Record<string, string> = {
  NOT_SENT: 'Not sent',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
};

function formatSentAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function EmailNoticeStatus({
  reportStatus,
  emailStatus,
  emailSentAt,
  emailError,
  emailClaimedAt,
  emailRecipients,
  canRetry,
  busy,
  onRetry,
  compact = false,
}: {
  reportStatus: string;
  emailStatus?: string | null;
  emailSentAt?: string | null;
  emailError?: string | null;
  emailClaimedAt?: string | null;
  emailRecipients?: string[] | null;
  canRetry?: boolean;
  busy?: boolean;
  onRetry?: () => void;
  compact?: boolean;
}) {
  if (reportStatus !== 'approved' && reportStatus !== 'generated') return null;

  const status = emailStatus || 'NOT_SENT';
  const recipientCount = emailRecipients?.length ?? 0;
  const claimedAt = emailClaimedAt ? Date.parse(emailClaimedAt) : Number.NaN;
  const claimIsStale =
    status === 'SENDING' && Number.isFinite(claimedAt) && Date.now() - claimedAt > CLAIM_STALE_MS;
  const showRetry = Boolean(
    canRetry && onRetry && (status === 'FAILED' || status === 'NOT_SENT' || claimIsStale),
  );

  return (
    <div className={compact ? 'mt-1 space-y-1' : 'rounded-xl border border-border bg-surface px-4 py-3 text-sm'}>
      <p className={compact ? 'text-[11px] text-text-muted' : 'text-text'}>
        <span className="font-semibold">Project status:</span> APPROVED
      </p>
      <p className={compact ? 'text-[11px] text-text-muted' : 'mt-1 text-text'}>
        <span className="font-semibold">Email notification:</span> {LABELS[status] ?? status}
      </p>
      {recipientCount > 0 && (
        <p className={compact ? 'text-[11px] text-text-muted' : 'mt-1 text-text-muted'}>
          Recipients: {recipientCount}
        </p>
      )}
      {status === 'SENT' && emailSentAt && (
        <p className={compact ? 'text-[11px] text-text-muted' : 'mt-1 text-text-muted'}>
          Sent: {formatSentAt(emailSentAt)}
        </p>
      )}
      {status === 'FAILED' && emailError && (
        <p className={compact ? 'text-[11px] text-warning' : 'mt-1 text-warning'}>{emailError}</p>
      )}
      {showRetry && (
        <button
          type="button"
          disabled={busy}
          onClick={onRetry}
          className="mt-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text disabled:opacity-50"
        >
          {busy ? 'Sending…' : status === 'NOT_SENT' ? 'Send notification' : 'Retry notification'}
        </button>
      )}
    </div>
  );
}
