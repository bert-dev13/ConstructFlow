'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { usePagination } from '../hooks/usePagination';
import {
  createPayItem,
  deletePayItem,
  listPayItems,
  setPayItemActive,
  updatePayItem,
  type PayItem,
} from '../lib/payItemsApi';

type StatusFilter = 'all' | 'active' | 'inactive';

export function PayItemMasterPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<PayItem[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<PayItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ itemNo: '', description: '', unit: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setItems(await listPayItems(true));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pay items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(() => {
    const active = items.filter((item) => item.active).length;
    return {
      total: items.length,
      active,
      inactive: items.length - active,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter === 'active' && !item.active) return false;
      if (statusFilter === 'inactive' && item.active) return false;
      if (!q) return true;
      return [item.itemNo, item.description, item.unit, `v${item.version}`].some((value) =>
        value.toLowerCase().includes(q),
      );
    });
  }, [items, query, statusFilter]);

  const {
    page,
    setPage,
    pageItems,
    totalPages,
    from,
    to,
    total,
    pageSize,
  } = usePagination(filtered, {
    resetKey: `${query}|${statusFilter}`,
  });

  const closeForm = () => {
    setEditing(null);
    setShowForm(false);
    setForm({ itemNo: '', description: '', unit: '' });
  };

  const openNew = () => {
    setEditing(null);
    setForm({ itemNo: '', description: '', unit: '' });
    setError('');
    setMessage('');
    setShowForm(true);
  };

  const openEdit = (item: PayItem) => {
    setEditing(item);
    setForm({ itemNo: item.itemNo, description: item.description, unit: item.unit });
    setError('');
    setMessage('');
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
        const updated = await updatePayItem(editing.id, form, String(user.id));
        setMessage(
          updated.version !== editing.version
            ? `${form.itemNo} saved as version ${updated.version}.`
            : `${form.itemNo} updated.`,
        );
      } else {
        await createPayItem(form, String(user.id));
        setMessage(`${form.itemNo} added to the Pay Item Master.`);
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save pay item.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: PayItem) => {
    setError('');
    setMessage('');
    try {
      await setPayItemActive(item.id, !item.active);
      setMessage(
        item.active
          ? `${item.itemNo} deactivated. It remains in the master list but cannot be selected for new project records.`
          : `${item.itemNo} activated.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    }
  };

  const removeItem = async (item: PayItem) => {
    if (
      !window.confirm(
        `Delete ${item.itemNo}? It will be marked Inactive and stay in the database so existing project snapshots are unchanged.`,
      )
    ) {
      return;
    }
    setError('');
    setMessage('');
    try {
      await deletePayItem(item.id);
      setMessage(`${item.itemNo} deleted (set to Inactive).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete pay item.');
    }
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-5 px-8 pb-10 pt-6">
        <PageHeader
          badge="Engineer I · Master data"
          title="Pay Item Master"
          description="Item No., Description, and Unit from the DPWH Revised Standard Pay Item List (DO 143 s. 2017), reused by project BOQs, PDM, S-Curve, and reports."
          actions={
            <button
              type="button"
              onClick={openNew}
              className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white"
            >
              + Add Pay Item
            </button>
          }
        />

        {message && (
          <div className="rounded-xl border border-primary/20 bg-primary-light p-4 text-sm text-primary">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Total</p>
            <p className="mt-2 text-2xl font-semibold text-text">{counts.total}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Active</p>
            <p className="mt-2 text-2xl font-semibold text-text">{counts.active}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Inactive</p>
            <p className="mt-2 text-2xl font-semibold text-text">{counts.inactive}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">Search pay items</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Item No., description, or unit…"
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="sm:w-44">
            <span className="sr-only">Status filter</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-end justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-text">Standardized pay items</h2>
              <p className="mt-1 text-sm text-text-muted">
                {loading ? 'Loading…' : `${filtered.length} items shown`}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-surface-muted/60 text-[11px] uppercase tracking-wider text-text-muted">
                <tr className="border-b border-border">
                  <th className="px-5 py-3">Item No.</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Unit</th>
                  <th className="px-5 py-3">Version</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {pageItems.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-muted/40">
                    <td className="px-5 py-4 font-semibold text-text">{item.itemNo}</td>
                    <td className="px-5 py-4 text-text">{item.description}</td>
                    <td className="px-5 py-4 text-text-muted">{item.unit}</td>
                    <td className="px-5 py-4 text-text-muted">v{item.version}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${
                          item.active
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-border bg-surface-muted text-text-muted'
                        }`}
                      >
                        {item.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="mr-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted"
                      >
                        Edit
                      </button>
                      {item.active ? (
                        <button
                          type="button"
                          onClick={() => void removeItem(item)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700"
                        >
                          Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void toggleActive(item)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted"
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && !filtered.length && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-text-muted">
                      No pay items match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            from={from}
            to={to}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </div>
      </div>

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close pay item form"
            onClick={closeForm}
            className="absolute inset-0"
          />
          <form onSubmit={save} className="relative w-full max-w-lg rounded-2xl bg-card p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-text">
              {editing ? 'Edit pay item' : 'Add pay item'}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {editing
                ? 'Changing Item No., Description, or Unit creates a new version. Duplicate Item No. + Version is not allowed.'
                : 'These values become the standardized source for project BOQs, PDM, S-Curve, and reports.'}
            </p>
            <div className="mt-5 space-y-4">
              {(
                [
                  ['itemNo', 'Item No.'],
                  ['description', 'Description'],
                  ['unit', 'Unit'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="block text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  {label}
                  <input
                    required
                    value={form[key]}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [key]: event.target.value }))
                    }
                    className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm font-normal normal-case text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              ))}
              {editing && (
                <p className="text-xs text-text-muted">
                  Current version: <strong>v{editing.version}</strong>
                </p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : editing ? 'Save' : 'Add Pay Item'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
