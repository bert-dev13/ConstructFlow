'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from '../lib/nextRouter';
import { PayItemSelect } from '../components/PayItemSelect';
import { listProjectBoq, saveProjectBoqItem, setProjectBoqActive, type ProjectBoqItem } from '../lib/projectBoqApi';
import { listPayItems, type PayItem } from '../lib/payItemsApi';

export function ProjectBoqPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const id = projectId ?? '';
  const [rows, setRows] = useState<ProjectBoqItem[]>([]);
  const [payItems, setPayItems] = useState<PayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [boq, master] = await Promise.all([listProjectBoq(id), listPayItems(false)]);
      setRows(boq);
      setPayItems(master);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load project BOQ.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const patch = (rowId: string, value: Partial<ProjectBoqItem>) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, ...value } : row));
  };

  const addRow = () => {
    setRows((current) => [...current, {
      id: `new-${Date.now()}`,
      projectId: id,
      payItemId: '',
      programmedQty: 0,
      revisedQty: null,
      unitPrice: 0,
      active: true,
      createdAt: '',
      updatedAt: '',
    }]);
  };

  const save = async (row: ProjectBoqItem) => {
    if (!row.payItemId) {
      setError('Select a Pay Item before saving the BOQ row.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await saveProjectBoqItem(id, {
        payItemId: row.payItemId,
        programmedQty: row.programmedQty,
        revisedQty: row.revisedQty,
        unitPrice: row.unitPrice,
        active: row.active,
      }, row.id.startsWith('new-') ? undefined : row.id);
      setRows((current) => current.map((item) => item.id === row.id ? saved : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save BOQ row.');
    } finally {
      setSaving(false);
    }
  };

  const selectPayItem = (rowId: string, item: PayItem | null) => {
    if (!item) return;
    patch(rowId, { payItemId: item.id });
  };

  const masterItem = (payItemId: string) => payItems.find((item) => item.id === payItemId);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-6 px-8 pb-10 pt-8">
        <div>
          <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">Project BOQ</span>
          <h1 className="mt-3 font-serif text-3xl text-text">Bill of quantities</h1>
          <p className="mt-2 text-sm text-text-muted">Assign standardized Pay Items and manage project-specific quantities and prices.</p>
        </div>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div><h2 className="text-lg font-semibold text-text">Project BOQ items</h2><p className="mt-1 text-sm text-text-muted">Item number, description, and unit are controlled by Pay Item Master.</p></div>
            <button type="button" onClick={addRow} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">+ Add BOQ item</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-surface-muted/60 text-[11px] uppercase tracking-wider text-text-muted"><tr className="border-b border-border"><th className="px-5 py-3">Pay Item</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Unit</th><th className="px-5 py-3">Programmed Qty</th><th className="px-5 py-3">Unit Price</th><th className="px-5 py-3">Revised Qty</th><th className="px-5 py-3 text-right">Action</th></tr></thead>
              <tbody className="divide-y divide-border/80">
                {loading ? <tr><td colSpan={7} className="px-5 py-10 text-text-muted">Loading BOQ…</td></tr> : rows.map((row) => { const item = masterItem(row.payItemId); return <tr key={row.id} className="align-top hover:bg-surface-muted/40"><td className="px-5 py-4"><PayItemSelect value={row.payItemId} onChange={(selected) => selectPayItem(row.id, selected)} /></td><td className="px-5 py-4 text-text">{item?.description || 'Select a Pay Item'}</td><td className="px-5 py-4 text-text-muted">{item?.unit || '—'}</td><td className="px-5 py-4"><input type="number" min="0" step="0.01" value={row.programmedQty || ''} onChange={(event) => patch(row.id, { programmedQty: Number(event.target.value) || 0 })} className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-right" /></td><td className="px-5 py-4"><input type="number" min="0" step="0.01" value={row.unitPrice || ''} onChange={(event) => patch(row.id, { unitPrice: Number(event.target.value) || 0 })} className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-right" /></td><td className="px-5 py-4"><input type="number" min="0" step="0.01" value={row.revisedQty ?? ''} onChange={(event) => patch(row.id, { revisedQty: event.target.value === '' ? null : Number(event.target.value) })} className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-right" /></td><td className="px-5 py-4 text-right"><button type="button" disabled={saving} onClick={() => void save(row)} className="rounded-lg bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50">Save</button>{!row.id.startsWith('new-') && <button type="button" onClick={() => void setProjectBoqActive(id, row.id, !row.active).then(load)} className="ml-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted">{row.active ? 'Deactivate' : 'Activate'}</button>}</td></tr>; })}
                {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-text-muted">No BOQ items assigned yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
