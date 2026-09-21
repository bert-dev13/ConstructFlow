'use client';

import { useState } from 'react';
import { Link } from '../lib/nextRouter';
import { SubmissionSuccessSign } from '../components/ui/SubmissionSuccessSign';
import { uploadTemplate } from '../lib/api';
import type { ReportType } from '../types';

const TYPES: ReportType[] = ['SWA', 'STEWA', 'PROGRESS'];

export function TemplateManagePage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successType, setSuccessType] = useState('');

  const handleUpload = async (type: ReportType, file: File | null) => {
    if (!file) return;
    setUploading(type);
    setError('');
    setMessage('');
    try {
      const result = await uploadTemplate(type, file);
      setMessage(`${type}: ${result.message}`);
      setSuccessType(type);
      setShowSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <Link to="/reports" className="text-sm text-text-muted hover:text-primary">Back to reports</Link>
      <h1 className="mt-4 text-2xl font-bold text-text">Manage Report Templates</h1>
      <p className="mt-2 max-w-2xl text-sm text-text-muted">
        Upload your client&apos;s SWA, STEWA, or Progress Report templates. HTML files with{' '}
        <code>{'{{placeholders}}'}</code> are used immediately. Word/Excel files are stored for reference
        until converted to HTML.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {TYPES.map((type) => (
          <div key={type} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="font-bold text-text">{type} Template</p>
            <p className="mt-1 text-xs text-text-muted">
              Accepts .html (ready) or .docx / .xlsx (stored)
            </p>
            <label className="mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-border bg-surface/50 px-4 py-6 hover:border-primary/40">
              <span className="text-sm font-medium text-primary">
                {uploading === type ? 'Uploading…' : 'Choose file'}
              </span>
              <input
                type="file"
                accept=".html,.htm,.docx,.xlsx"
                className="hidden"
                disabled={uploading === type}
                onChange={(e) => handleUpload(type, e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        ))}
      </div>

      {message && <p className="mt-6 text-sm text-primary">{message}</p>}
      {error && <p className="mt-6 text-sm text-red-600">{error}</p>}

      <div className="mt-8 space-y-3 rounded-2xl border border-border bg-card p-6 text-sm text-text-muted">
        <h2 className="font-semibold text-text">Manual setup (folder)</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Open your template in Word and note each blank field.</li>
          <li>Save as HTML or copy layout to <code>templates/{'{TYPE}'}/default.html</code>.</li>
          <li>Replace blanks with placeholders like <code>{'{{project_name}}'}</code>.</li>
          <li>Edit <code>templates/manifest.json</code> to add any new field keys.</li>
          <li>See <code>templates/HOW_TO_ADD_TEMPLATES.txt</code> for full instructions.</li>
        </ol>
      </div>

      <SubmissionSuccessSign
        open={showSuccess}
        title="Submission Successful"
        message={successType ? `${successType} template file uploaded.` : undefined}
        onClose={() => setShowSuccess(false)}
      />
    </main>
  );
}
