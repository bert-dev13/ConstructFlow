'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from '../components/ProjectSelect';
import { UndoRedoToolbar } from '../components/ui/UndoRedoToolbar';
import { useUndoRedo, useUndoRedoKeyboard } from '../hooks/useUndoRedo';
import { fetchTemplates, generateReport } from '../lib/api';
import type { ReportType } from '../types';
import { CURRENT_PERIOD } from '../data/mockData';

interface TemplateField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

interface TemplateConfig {
  label: string;
  description: string;
  fields: TemplateField[];
}

const VALID_TYPES: ReportType[] = ['SWA', 'STEWA', 'PROGRESS'];

type FormSnapshot = {
  fields: Record<string, string>;
  projectId: string;
  period: string;
};

export function ReportCreatePage() {
  const { type } = useParams<{ type: string }>();
  const reportType = VALID_TYPES.includes(type as ReportType) ? (type as ReportType) : null;
  const { user } = useAuth();
  const { projectId: selectedProjectId, setProjectId: setSelectedProjectId } = useSelectedProject();
  const initialProjectRef = useRef(selectedProjectId);
  const navigate = useNavigate();

  const [config, setConfig] = useState<TemplateConfig | null>(null);
  const {
    state: form,
    set: setForm,
    replace: replaceForm,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo<FormSnapshot>({
    fields: {},
    projectId: initialProjectRef.current,
    period: CURRENT_PERIOD,
  });
  const { fields, projectId, period } = form;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!reportType) return;
    fetchTemplates(reportType)
      .then((data) => {
        setConfig(data.config as unknown as TemplateConfig);
        const initial: Record<string, string> = { period: CURRENT_PERIOD };
        if (user?.name) initial.prepared_by = user.name;
        (data.config.fields as unknown as TemplateField[]).forEach((f) => {
          if (f.key === 'period') initial.period = CURRENT_PERIOD;
        });
        replaceForm({ fields: initial, projectId: initialProjectRef.current, period: CURRENT_PERIOD });
      })
      .catch(() => setError('Could not load template. Check that templates/manifest.json exists.'));
  }, [reportType, user, replaceForm]);

  useUndoRedoKeyboard(undo, redo, !!reportType);

  if (!reportType) {
    return (
      <main className="p-8">
        <p>Invalid report type.</p>
        <Link to="/reports" className="text-primary">Back to reports</Link>
      </main>
    );
  }

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  };

  const handleSubmit = async (e: FormEvent, submit: boolean) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await generateReport({
        report_type: reportType,
        project_id: projectId,
        submitted_by: 1,
        period_label: period,
        fields: { ...fields, period },
        submit,
      });
      setPreviewUrl(result.preview_url);
      if (submit) navigate('/workflow');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <Link to="/reports" className="text-sm text-text-muted hover:text-primary">Back to reports</Link>
      <h1 className="mt-4 text-2xl font-bold text-text">{config?.label ?? reportType}</h1>
      <p className="mt-1 text-sm text-text-muted">{config?.description}</p>

      <form className="mt-8 max-w-2xl space-y-5" onSubmit={(e) => handleSubmit(e, true)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold">Project</label>
            <ProjectSelect
              value={projectId}
              onChange={(v) => {
                setForm((prev) => ({ ...prev, projectId: v }));
                setSelectedProjectId(v);
              }}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">Reporting period</label>
            <input
              value={period}
              onChange={(e) => setForm((prev) => ({ ...prev, period: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-border bg-surface-muted px-4 py-2.5 text-sm"
            />
          </div>
        </div>

        {config?.fields.map((field) => (
          <div key={field.key}>
            <label className="block text-sm font-semibold">
              {field.label}
              {field.required && <span className="text-red-500"> *</span>}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                required={field.required}
                value={fields[field.key] ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                rows={4}
                placeholder={field.placeholder}
                className="mt-1 w-full rounded-xl border border-border bg-surface-muted px-4 py-2.5 text-sm"
              />
            ) : field.type === 'select' ? (
              <select
                required={field.required}
                value={fields[field.key] ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-surface-muted px-4 py-2.5 text-sm"
              >
                <option value="">Select…</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                required={field.required}
                value={fields[field.key] ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="mt-1 w-full rounded-xl border border-border bg-surface-muted px-4 py-2.5 text-sm"
              />
            )}
          </div>
        ))}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-4">
          <UndoRedoToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
          <button
            type="button"
            disabled={loading}
            onClick={(e) => handleSubmit(e as unknown as FormEvent, false)}
            className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate & submit to Engineer II'}
          </button>
        </div>
      </form>

      {previewUrl && (
        <div className="mt-6 rounded-xl border border-primary/30 bg-primary-light/40 p-4">
          <p className="text-sm font-medium text-primary">Report generated</p>
          <a href={previewUrl} target="_blank" rel="noreferrer" className="mt-1 text-sm underline">
            Open preview
          </a>
        </div>
      )}

      <div className="mt-8 rounded-xl border border-border bg-surface-muted/50 p-4 text-sm text-text-muted">
        <strong className="text-text">Using your client template:</strong> place HTML files in{' '}
        <code className="rounded bg-card px-1">templates/SWA/</code>,{' '}
        <code className="rounded bg-card px-1">templates/STEWA/</code>, or{' '}
        <code className="rounded bg-card px-1">templates/PROGRESS/</code> with{' '}
        <code className="rounded bg-card px-1">{'{{placeholders}}'}</code> matching the field keys above.
      </div>
    </main>
  );
}
