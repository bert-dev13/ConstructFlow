'use client';

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from '../lib/nextRouter';
import { Logo } from '../components/Logo';
import { SYSTEM_NAME } from '../lib/branding';
import { verifyReportQr } from '../lib/swaStewaApi';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending',
  with_engineer_3: 'Pending',
  with_engineer_4: 'Pending',
  approved: 'Approved',
  rejected: 'Revision Requested',
  generated: 'Approved (PDF generated)',
};

export function VerifyPage() {
  const [params] = useSearchParams();
  const qr = params.get('qr');
  const [loading, setLoading] = useState(!!qr);
  const [valid, setValid] = useState(false);
  const [verified, setVerified] = useState(false);
  const [report, setReport] = useState<{
    report_number: string;
    report_type: string;
    status: string;
    project_name?: string;
    report_data?: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    if (!qr) return;
    verifyReportQr(qr)
      .then((res) => {
        setValid(!!res.valid);
        setVerified(!!res.verified);
        if (res.report) setReport(res.report);
      })
      .catch(() => setValid(false))
      .finally(() => setLoading(false));
  }, [qr]);

  const projectName =
    (report?.report_data?.project_name as string) ||
    (report?.report_data?.project_title as string) ||
    report?.project_name ||
    '—';

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
        <Logo showText={false} className="items-center" />
        <h1 className="mt-6 text-xl font-bold text-text">Document Verification</h1>

        {!qr ? (
          <p className="mt-4 text-text-muted">No QR code provided.</p>
        ) : loading ? (
          <p className="mt-4 text-text-muted">Verifying…</p>
        ) : valid && report ? (
          <>
            <div className={`mt-4 rounded-xl p-4 ${verified ? 'bg-primary-light' : 'bg-warning-bg'}`}>
              <p className={`text-sm font-semibold ${verified ? 'text-primary' : 'text-warning'}`}>
                {verified ? 'Verified — System Generated' : 'Report found — pending final approval'}
              </p>
              <p className="mt-2 text-sm text-text-muted">
                This report is stored in {SYSTEM_NAME}.
              </p>
            </div>
            <dl className="mt-6 space-y-2 text-left text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Report No.</dt>
                <dd className="font-mono text-right">{report.report_number}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Project</dt>
                <dd className="text-right">{projectName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Type</dt>
                <dd>{report.report_type}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Status</dt>
                <dd>{STATUS_LABELS[report.status] ?? report.status}</dd>
              </div>
            </dl>
            <Link
              to={`/reports/view?reportNumber=${encodeURIComponent(report.report_number)}`}
              className="mt-6 inline-block text-sm font-semibold text-primary underline"
            >
              Open full report view
            </Link>
          </>
        ) : (
          <p className="mt-4 text-red-600">QR code not found in system records.</p>
        )}
      </div>
    </div>
  );
}
