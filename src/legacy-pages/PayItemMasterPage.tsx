'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  createPayItem,
  listPayItems,
  setPayItemActive,
  updatePayItem,
  type PayItem,
} from '../lib/payItemsApi';
import { parseSwaWorkbook, type WorkbookPayItemRow } from '../lib/workbookImport';
import { listProjects, type ProjectRow } from '../lib/projectsApi';
import { listProjectBoq, saveProjectBoqItem } from '../lib/projectBoqApi';

type ImportRow = WorkbookPayItemRow & { error?: string };

export function PayItemMasterPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<PayItem[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<PayItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ itemNo: '', description: '', unit: '' });
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setItems(await listPayItems(true));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pay items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    listProjects().then((result) => setProjects(result.projects)).catch(() => setProjects([]));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!showInactive && !item.active) return false;
      return !q || [item.itemNo, item.description, item.unit].some((value) => value.toLowerCase().includes(q));
    });
  }, [items, query, showInactive]);

  const openNew = () => {
    setEditing(null);
    setForm({ itemNo: '', description: '', unit: '' });
    setError('');
    setShowForm(true);
  };

  const openEdit = (item: PayItem) => {
    setEditing(item);
    setForm({ itemNo: item.itemNo, description: item.description, unit: item.unit });
    setError('');
    setShowForm(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (editing) {
        await updatePayItem(editing.id, form, String(user.id));
        setMessage(`${form.itemNo} updated to a new version.`);
      } else {
        await createPayItem(form, String(user.id));
        setMessage(`${form.itemNo} added to the Pay Item Master.`);
      }
      setEditing(null);
      setShowForm(false);
      setForm({ itemNo: '', description: '', unit: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save pay item.');
    } finally {
      setSaving(false);
    }
  };

  const prepareImport = (parsed: WorkbookPayItemRow[]) => {
    setError('');
    setMessage('');
    const imported: ImportRow[] = parsed.map((row) => ({ ...row }));
    const seen = new Set<string>();
    const existing = new Set(items.map((item) => item.normalizedItemNo));
    imported.forEach((row) => {
      const key = row.itemNo.toLowerCase().replace(/\s+/g, '').replace(/[.()[\]{}-]/g, '');
      if (seen.has(key)) row.error = 'Duplicate in import file';
      else if (existing.has(key)) row.error = 'Already exists — review before updating';
      seen.add(key);
    });
    setPreview(imported);
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      prepareImport(parseSwaWorkbook(await file.arrayBuffer()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read SWA workbook.');
    }
  };

  const loadProvidedWorkbook = async () => {
    try {
      const response = await fetch('/SWA-STEWA-RCBC.xlsx');
      if (!response.ok) throw new Error('The provided SWA/STEWA/RCBC workbook could not be loaded.');
      prepareImport(parseSwaWorkbook(await response.arrayBuffer()));
      setMessage('RCBC workbook loaded. Review the extracted SWA pay items before importing.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the provided workbook.');
    }
  };

  const confirmImport = async () => {
    if (!user?.id) return;
    const newRows = preview.filter((row) => !row.error);
    const boqRows = selectedProjectId
      ? preview.filter((row) => !row.error || row.error?.startsWith('Already exists'))
      : [];
    if (!newRows.length && !boqRows.length) {
      setError('There are no new valid rows to import.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const importedItems = new Map(items.map((item) => [item.normalizedItemNo, item]));
      let imported = 0;
      for (const row of newRows) {
        const created = await createPayItem(
          { ...row, source: `SWA-STEWA-RCBC.xlsx · ${row.sourceSheet}` },
          String(user.id),
        );
        importedItems.set(created.normalizedItemNo, created);
        imported += 1;
      }
      if (selectedProjectId) {
        const existingBoq = await listProjectBoq(selectedProjectId);
        const boqByPayItem = new Map(existingBoq.map((item) => [item.payItemId, item]));
        for (const row of boqRows) {
          const normalized = row.itemNo.toLowerCase().replace(/\s+/g, '').replace(/[.()[\]{}-]/g, '');
          const payItem = importedItems.get(normalized);
          if (!payItem) continue;
          const existing = boqByPayItem.get(payItem.id);
          await saveProjectBoqItem(selectedProjectId, {
            payItemId: payItem.id,
            programmedQty: row.programmedQty,
            revisedQty: existing?.revisedQty ?? null,
            unitPrice: row.unitPrice,
            active: true,
          }, existing?.id);
        }
      }
      setPreview([]);
      setMessage(`${imported} pay items imported${selectedProjectId ? ' and the selected project BOQ was updated' : ''}. Existing or invalid master rows were not overwritten.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-6 px-8 pb-10 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">Engineer I · Master data</span>
            <h1 className="mt-3 font-serif text-3xl text-text">Pay Item Master</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-muted">Manage the standardized Item No., Description, and Unit values used by project BOQs and reports.</p>
          </div>
        <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void loadProvidedWorkbook()} className="rounded-xl border border-primary/30 bg-primary-light px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary-light/70">Load RCBC workbook</button>
            <label className="cursor-pointer rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-text hover:bg-surface-muted">
              Import SWA workbook
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importFile} />
            </label>
            <button type="button" onClick={openNew} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">+ Add pay item</button>
          </div>
        </div>

        {message && <div className="rounded-xl border border-primary/20 bg-primary-light p-4 text-sm text-primary">{message}</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Total items</p><p className="mt-2 text-2xl font-semibold text-text">{items.length}</p></div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Active items</p><p className="mt-2 text-2xl font-semibold text-text">{items.filter((item) => item.active).length}</p></div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Inactive items</p><p className="mt-2 text-2xl font-semibold text-text">{items.filter((item) => !item.active).length}</p></div>
        </div>

        {preview.length > 0 && (
          <section className="rounded-2xl border border-primary/30 bg-primary-light/30 p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-text">Import preview</h2><p className="mt-1 text-sm text-text-muted">SWA sheets were scanned for real pay-item rows. Existing items and invalid rows will not be overwritten.</p></div>
              <div className="flex gap-2"><button type="button" onClick={() => setPreview([])} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-text-muted">Cancel</button><button type="button" onClick={() => void confirmImport()} disabled={saving} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirm import</button></div>
            </div>
            <label className="mt-4 block max-w-xl text-xs font-semibold uppercase tracking-wide text-text-muted">Also update project BOQ (optional)
              <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-normal normal-case text-text">
                <option value="">Do not update a project BOQ</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-border bg-card"><table className="w-full min-w-[900px] text-left text-sm"><thead className="sticky top-0 bg-surface-muted"><tr><th className="px-3 py-2">Item No.</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2 text-right">Programmed Qty</th><th className="px-3 py-2 text-right">Unit Price</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Validation</th></tr></thead><tbody className="divide-y divide-border">{preview.map((row, index) => <tr key={`${row.itemNo}-${index}`}><td className="px-3 py-2 font-medium">{row.itemNo || '—'}</td><td className="px-3 py-2">{row.description || '—'}</td><td className="px-3 py-2">{row.unit || '—'}</td><td className="px-3 py-2 text-right">{row.programmedQty.toLocaleString()}</td><td className="px-3 py-2 text-right">₱{row.unitPrice.toLocaleString()}</td><td className="px-3 py-2 text-xs text-text-muted">{row.sourceSheet}</td><td className={`px-3 py-2 text-xs ${row.error ? 'text-red-600' : 'text-primary'}`}>{row.error || 'Ready to import'}</td></tr>)}</tbody></table></div>
          </section>
        )}

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row">
          <label className="flex-1"><span className="sr-only">Search pay items</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item number, description, or unit…" className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
          <label className="flex items-center gap-2 rounded-xl border border-border px-3 text-sm text-text-muted"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Show inactive</label>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-end justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="text-lg font-semibold text-text">Standardized pay items</h2><p className="mt-1 text-sm text-text-muted">{loading ? 'Loading…' : `${filtered.length} items shown`}</p></div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-surface-muted/60 text-[11px] uppercase tracking-wider text-text-muted"><tr className="border-b border-border"><th className="px-5 py-3">Item No.</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Unit</th><th className="px-5 py-3">Version</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border/80">{filtered.map((item) => <tr key={item.id} className="hover:bg-surface-muted/40"><td className="px-5 py-4 font-semibold text-text">{item.itemNo}</td><td className="px-5 py-4 text-text">{item.description}</td><td className="px-5 py-4 text-text-muted">{item.unit}</td><td className="px-5 py-4 text-text-muted">v{item.version}</td><td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${item.active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border bg-surface-muted text-text-muted'}`}>{item.active ? 'Active' : 'Inactive'}</span></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => openEdit(item)} className="mr-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted">Edit</button><button type="button" onClick={() => void setPayItemActive(item.id, !item.active).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted">{item.active ? 'Deactivate' : 'Activate'}</button></td></tr>)}{!loading && !filtered.length && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-text-muted">No pay items match the current filters.</td></tr>}</tbody></table></div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close pay item form" onClick={() => { setEditing(null); setShowForm(false); setForm({ itemNo: '', description: '', unit: '' }); }} className="absolute inset-0" />
          <form onSubmit={save} className="relative w-full max-w-lg rounded-2xl bg-card p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-text">{editing ? 'Edit pay item' : 'Add pay item'}</h2>
            <p className="mt-1 text-sm text-text-muted">These values become the standardized source for project and report forms.</p>
            <div className="mt-5 space-y-4">
              {(['itemNo', 'description', 'unit'] as const).map((key) => <label key={key} className="block text-xs font-semibold uppercase tracking-wide text-text-muted">{key === 'itemNo' ? 'Item No.' : key[0].toUpperCase() + key.slice(1)}<input required value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm font-normal normal-case text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>)}
            </div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => { setEditing(null); setShowForm(false); setForm({ itemNo: '', description: '', unit: '' }); }} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text-muted">Cancel</button><button type="submit" disabled={saving} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : editing ? 'Save version' : 'Add pay item'}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
