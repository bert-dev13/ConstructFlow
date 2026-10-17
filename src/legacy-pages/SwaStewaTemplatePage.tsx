'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { SubmissionSuccessSign } from '../components/ui/SubmissionSuccessSign';
import { uploadTemplate } from '../lib/api';
import { deleteDoc, doc } from 'firebase/firestore';
import { COLLECTIONS } from '../lib/firebase/collections';
import { db } from '../lib/firebase/config';
import { fetchTemplatesFs } from '../lib/firebase/templates';

interface TemplateInfo {
  report_type: 'SWA' | 'STEWA' | 'IAR';
  exists: boolean;
  filename: string | null;
  uploaded_at: string | null;
  download_url: string | null;
}

export function SwaStewaTemplatePage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successType, setSuccessType] = useState('');

  const loadTemplates = useCallback(async () => {
    const types = ['STEWA', 'SWA', 'IAR'] as const;
    const rows: TemplateInfo[] = [];
    for (const type of types) {
      try {
        const res = await fetchTemplatesFs(type);
        rows.push({
          report_type: type,
          exists: !!(res.downloadUrl || res.storagePath),
          filename: res.fileName ?? null,
          uploaded_at: res.updatedAt ? res.updatedAt.slice(0, 10) : null,
          download_url: res.downloadUrl ?? null,
        });
      } catch {
        rows.push({
          report_type: type,
          exists: false,
          filename: null,
          uploaded_at: null,
          download_url: null,
        });
      }
    }
    setTemplates(rows);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const upload = async (type: 'SWA' | 'STEWA' | 'IAR', file: File | null) => {
    if (!file) return;
    setUploading(type);
    setError('');
    setMessage('');
    try {
      const data = await uploadTemplate(type, file);
      setMessage(`${type}: ${data.message}`);
      setSuccessType(type);
      setShowSuccess(true);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
      setDragOver(null);
    }
  };

  const clearTemplate = async (type: 'SWA' | 'STEWA' | 'IAR') => {
    if (!window.confirm(`Clear the ${type} template?`)) return;
    setClearing(type);
    setError('');
    setMessage('');
    try {
      await deleteDoc(doc(db, COLLECTIONS.reportTemplates, type));
      await loadTemplates();
      setMessage(`${type} template cleared.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear template');
    } finally {
      setClearing(null);
    }
  };

  const getInfo = (type: 'SWA' | 'STEWA' | 'IAR') =>
    templates.find((t) => t.report_type === type);

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <Link to="/reports" className="text-sm text-text-muted hover:text-primary">
        ← Reports Hub
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-text">Upload Excel Templates</h1>
      <p className="mt-2 max-w-2xl text-sm text-text-muted">
        Upload official <strong>.xlsx</strong> files. Templates are stored in Firebase Storage.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Currently stored templates
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(['STEWA', 'SWA', 'IAR'] as const).map((type) => {
            const info = getInfo(type);
            return (
              <div
                key={type}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                  info?.exists
                    ? 'border-primary/40 bg-primary-light/40'
                    : 'border-border bg-surface-muted/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text">{type}</p>
                  {info?.exists ? (
                    <>
                      <p className="truncate text-sm text-text">{info.filename}</p>
                      <p className="text-xs text-text-muted">Uploaded {info.uploaded_at}</p>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {info.download_url && (
                          <a
                            href={info.download_url}
                            className="text-xs font-medium text-primary underline"
                            download
                          >
                            Download
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => clearTemplate(type)}
                          disabled={clearing === type}
                          className="text-xs font-medium text-red-600 underline disabled:opacity-50"
                        >
                          {clearing === type ? 'Clearing…' : 'Clear'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted">No template uploaded</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {message && (
        <p className="mt-4 rounded-xl bg-primary-light px-4 py-3 text-sm text-primary">{message}</p>
      )}
      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {(['STEWA', 'SWA', 'IAR'] as const).map((type) => (
          <div
            key={type}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(type);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              void upload(type, e.dataTransfer.files?.[0] ?? null);
            }}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition ${
              dragOver === type ? 'border-primary bg-primary-light/40' : 'border-border bg-card'
            }`}
          >
            <p className="font-semibold text-text">{type}</p>
            <p className="mt-1 text-xs text-text-muted">Drop .xlsx or choose a file</p>
            <label className="mt-4 inline-block cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">
              {uploading === type ? 'Uploading…' : 'Choose file'}
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={uploading === type}
                onChange={(e) => void upload(type, e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        ))}
      </div>

      {showSuccess && (
        <SubmissionSuccessSign
          open={showSuccess}
          title={`${successType} template uploaded`}
          onClose={() => setShowSuccess(false)}
        />
      )}
    </main>
  );
}
