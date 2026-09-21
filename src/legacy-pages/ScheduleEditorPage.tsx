'use client';

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from '../components/ProjectSelect';
import { UndoRedoToolbar } from '../components/ui/UndoRedoToolbar';
import { useUndoRedo, useUndoRedoKeyboard } from '../hooks/useUndoRedo';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import { getSchedule, saveSchedule, clearSchedule, loadReferenceSchedule, type ProjectSchedule } from '../lib/scheduleApi';
import { listProjects } from '../lib/projectsApi';
import { applyPdmDerivatives, deriveBarChartFromPdm } from '../lib/scheduleSync';
import { activityIncomingLinksMap, setActivityPredecessor, suggestFsDependency } from '../lib/pdm';
import { REFERENCE_PDM_TITLE, HAS_REFERENCE_PDM } from '../data/roadPdmSample';
import type { DependencyType, PdmActivity, PdmDependency } from '../types';

const DEP_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const TYPE_OPTIONS: Array<DependencyType | 'Independent'> = ['Independent', 'FS', 'SS', 'FF', 'SF'];

function newActivity(i: number): PdmActivity {
  const letter = String.fromCharCode(65 + (i % 26));
  return { id: `new-${Date.now()}-${i}`, number: letter, name: `Activity ${letter}`, duration: 3 };
}

const DependencyRow = memo(function DependencyRow({
  dep,
  activities,
  onPatch,
  onRemove,
}: {
  dep: PdmDependency;
  activities: PdmActivity[];
  onPatch: (depId: string, patch: Partial<PdmDependency>) => void;
  onRemove: (depId: string) => void;
}) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-2 pr-2">
        <select
          value={dep.fromId}
          onChange={(e) => onPatch(dep.id, { fromId: e.target.value })}
          className="rounded border border-border px-2 py-1"
        >
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.number} — {a.name}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2">
        <select
          value={dep.toId}
          onChange={(e) => onPatch(dep.id, { toId: e.target.value })}
          className="rounded border border-border px-2 py-1"
        >
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.number} — {a.name}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2">
        <select
          value={dep.type}
          onChange={(e) => onPatch(dep.id, { type: e.target.value as DependencyType })}
          className="rounded border border-border px-2 py-1"
        >
          {DEP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2">
        <input
          type="number"
          value={dep.lag ?? 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            onPatch(dep.id, { lag: Number.isFinite(n) ? n : 0 });
          }}
          className="w-16 rounded border border-border px-2 py-1"
          title="Lag in days. Use a negative number for lead (example: FS with 3-day lead = -3)."
        />
      </td>
      <td className="py-2 text-right">
        <button type="button" onClick={() => onRemove(dep.id)} className="text-xs text-red-600">
          Remove
        </button>
      </td>
    </tr>
  );
});

export function ScheduleEditorPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'contractor';

  const { projectId, setProjectId } = useSelectedProject();
  const [hasProjects, setHasProjects] = useState<boolean | null>(null);
  const {
    state: data,
    set: setData,
    replace: replaceData,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo<ProjectSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tab, setTab] = useState<'pdm' | 'bar'>('pdm');
  const autoSaveReady = useRef(false);
  const saveSeq = useRef(0);
  const savingRef = useRef(false);

  const patchSchedule = useCallback(
    (updater: (schedule: ProjectSchedule) => ProjectSchedule) => {
      setData((d) => (d ? updater(d) : d));
      setDirty(true);
      setSuccess('');
    },
    [setData],
  );

  const derived = useMemo(() => {
    if (!data) return null;
    return deriveBarChartFromPdm(data.activities, data.dependencies, data.barChartTasks);
  }, [data]);

  const scheduledById = useMemo(() => {
    const map = new Map<string, PdmActivity>();
    derived?.activities.forEach((a) => map.set(a.id, a));
    return map;
  }, [derived]);

  const incomingByActivity = useMemo(() => {
    if (!data) return new Map();
    return activityIncomingLinksMap(
      data.activities,
      data.dependencies,
      derived?.activities,
    );
  }, [data, derived]);

  const activityOptions = useMemo(() => {
    if (!data) return [] as PdmActivity[];
    return data.activities;
  }, [data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setDirty(false);
    autoSaveReady.current = false;
    try {
      replaceData(applyPdmDerivatives(await getSchedule(projectId)));
    } catch {
      setError('Could not load schedule from database.');
    } finally {
      setLoading(false);
      // Allow auto-save only after load settles (next tick).
      requestAnimationFrame(() => {
        autoSaveReady.current = true;
      });
    }
  }, [projectId, replaceData]);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((res) => {
        if (cancelled) return;
        setHasProjects(res.projects.length > 0);
        if (res.projects.length > 0 && !res.projects.some((p) => String(p.id) === projectId)) {
          setProjectId(String(res.projects[0].id));
        }
      })
      .catch(() => {
        if (!cancelled) setHasProjects(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, setProjectId]);

  useEffect(() => {
    if (hasProjects === false) return;
    load();
  }, [load, hasProjects]);

  const updateDependency = useCallback(
    (depId: string, patch: Partial<PdmDependency>) => {
      patchSchedule((d) => ({
        ...d,
        dependencies: d.dependencies.map((x) => (x.id === depId ? { ...x, ...patch } : x)),
      }));
    },
    [patchSchedule],
  );

  const removeDependency = useCallback(
    (depId: string) => {
      patchSchedule((d) => ({
        ...d,
        dependencies: d.dependencies.filter((x) => x.id !== depId),
      }));
    },
    [patchSchedule],
  );

  const setIncomingLink = useCallback(
    (activityId: string, type: DependencyType | 'Independent', predecessorId: string | null) => {
      patchSchedule((d) => ({
        ...d,
        dependencies: setActivityPredecessor(
          d.activities,
          d.dependencies,
          activityId,
          type,
          predecessorId,
        ),
      }));
    },
    [patchSchedule],
  );

  const handleSave = useCallback(async (opts?: { silent?: boolean }) => {
    if (!data || savingRef.current) return;
    if (derived?.pdmError) {
      setError(derived.pdmError);
      return;
    }

    const seq = ++saveSeq.current;
    savingRef.current = true;
    setSaving(true);
    if (!opts?.silent) {
      setError('');
      setSuccess('');
    }
    try {
      const saved = applyPdmDerivatives(
        await saveSchedule({
          project_id: projectId,
          activities: data.activities,
          dependencies: data.dependencies,
          barChartTasks: data.barChartTasks,
          barChartTimeNow: data.barChartTimeNow,
        }),
      );
      if (seq !== saveSeq.current) return;
      setDirty(false);
      autoSaveReady.current = false;
      replaceData(saved);
      requestAnimationFrame(() => {
        autoSaveReady.current = true;
      });
      setSuccess(
        opts?.silent
          ? 'Auto-saved. PDM, bar chart, and S-curve synced.'
          : 'Schedule saved. PDM, bar chart, and S-curve are synced. Critical path: ' +
              (saved.criticalPath.join(' → ') || '—'),
      );
      setError('');
    } catch (err) {
      if (seq !== saveSeq.current) return;
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      if (seq === saveSeq.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }, [data, derived?.pdmError, projectId, replaceData]);

  // Auto-save ~2s after the last edit so dropdown changes stay responsive.
  useEffect(() => {
    if (!canEdit || !data || !dirty || loading || !autoSaveReady.current) return;
    if (derived?.pdmError) return;

    const timer = window.setTimeout(() => {
      void handleSave({ silent: true });
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [canEdit, data, dirty, loading, derived?.pdmError, handleSave]);

  const updateActivity = (id: string, patch: Partial<PdmActivity>) => {
    patchSchedule((d) => ({
      ...d,
      activities: d.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  };

  const updateActualEnd = (id: string, actualEndDay: number | undefined) => {
    patchSchedule((d) => ({
      ...d,
      barChartTasks: d.barChartTasks.map((t) => (t.id === id ? { ...t, actualEndDay } : t)),
    }));
  };

  useUndoRedoKeyboard(undo, redo, canEdit && !!data);

  if (!canEdit) {
    return (
      <main className="flex-1 overflow-y-auto px-8 pb-10 pt-8">
        <p className="text-text-muted">Only contractors can edit the construction schedule.</p>
        <Link to="/pdm" className="mt-4 inline-block text-primary underline">
          View PDM Schedule
        </Link>
      </main>
    );
  }

  if (hasProjects === false) {
    return (
      <main className="flex-1 overflow-y-auto px-8 pb-10 pt-8">
        <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <h1 className="text-lg font-bold text-amber-900">Waiting for a project</h1>
          <p className="mt-2 text-sm text-amber-800">
            No project has been created yet. Engineer I must create a project and assign a project
            title before the contractor can prepare the construction schedule.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-6 px-8 pb-10 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
            Schedule workspace
          </span>
          <h1 className="mt-3 font-serif text-3xl text-text">Prepare construction schedule</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-muted">
            Build the PDM network and automatically synchronize the bar chart and S-Curve for the selected project.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectSelect value={projectId} onChange={setProjectId} className="min-w-[240px]" />
          <UndoRedoToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
          <button
            type="button"
            disabled={saving || !data}
            onClick={() => void handleSave()}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : dirty ? 'Save schedule*' : 'Save schedule'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ['Activities', data?.activities.length ?? 0, 'PDM activities in this schedule', 'projects'],
          ['Dependencies', data?.dependencies.length ?? 0, 'Activity relationships', 'pdm'],
          ['Project duration', `${derived?.projectDuration ?? 0} days`, 'Calculated from the network', 'schedule'],
          ['Critical path', derived?.criticalPath.length ?? 0, 'Zero-float activities', 'approval'],
        ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                <NavIcon name={icon} className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-text">{loading ? '…' : value}</p>
            <p className="mt-1 text-xs text-text-muted">{caption}</p>
          </div>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>}
      {success && <div className="rounded-xl border border-primary/20 bg-primary-light p-4 text-sm text-primary">{success}</div>}

      {loading || !data ? (
        <p className="text-sm text-text-muted">Loading schedule…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="flex rounded-xl bg-surface-muted p-1" role="tablist" aria-label="Schedule editor views">
            <button
              type="button"
              onClick={() => setTab('pdm')}
              role="tab"
              aria-selected={tab === 'pdm'}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === 'pdm' ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'}`}
            >
              PDM network
            </button>
            <button
              type="button"
              onClick={() => setTab('bar')}
              role="tab"
              aria-selected={tab === 'bar'}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === 'bar' ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'}`}
            >
              Bar chart preview
            </button>
            </div>
            <p className="text-xs text-text-muted">Changes auto-save after you pause typing.</p>
          </div>

          {tab === 'pdm' && (
            <div className="space-y-6">
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-gradient-to-r from-card to-primary-light/20 px-5 py-5">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold text-text">PDM activities</h2>
                      <span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-semibold text-primary">{data.activities.length} total</span>
                    </div>
                    <p className="mt-1 max-w-2xl text-sm text-text-muted">Define the work sequence, duration, start overrides, and predecessors for this project.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      patchSchedule((d) => ({
                        ...d,
                        activities: [...d.activities, newActivity(d.activities.length)],
                      }))
                    }
                    className="rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm"
                  >
                    + Add activity
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Load the reference PDM (activities, dependencies, bar chart, S-curve)? This replaces the current schedule.',
                        )
                      ) {
                        return;
                      }
                      void (async () => {
                        savingRef.current = true;
                        setSaving(true);
                        setError('');
                        setDirty(false);
                        autoSaveReady.current = false;
                        try {
                          replaceData(
                            applyPdmDerivatives(await loadReferenceSchedule(projectId)),
                          );
                          setSuccess(`Reference loaded: ${REFERENCE_PDM_TITLE}`);
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : 'Could not load reference schedule.',
                          );
                        } finally {
                          savingRef.current = false;
                          setSaving(false);
                          requestAnimationFrame(() => {
                            autoSaveReady.current = true;
                          });
                        }
                      })();
                    }}
                    disabled={saving || !HAS_REFERENCE_PDM}
                    title={
                      HAS_REFERENCE_PDM
                        ? undefined
                        : 'No reference PDM yet — waiting for new schedule data'
                    }
                    className="rounded-xl border border-primary/30 bg-primary-light/60 px-3.5 py-2 text-xs font-semibold text-primary disabled:opacity-50"
                  >
                    Load reference PDM
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Clear all PDM activities, dependencies, and bar chart for this project?',
                        )
                      ) {
                        return;
                      }
                      void (async () => {
                        savingRef.current = true;
                        setSaving(true);
                        setError('');
                        setDirty(false);
                        autoSaveReady.current = false;
                        try {
                          replaceData(applyPdmDerivatives(await clearSchedule(projectId)));
                          setSuccess('Schedule cleared. Ready for a new reference PDM.');
                        } catch {
                          setError('Could not clear schedule.');
                        } finally {
                          savingRef.current = false;
                          setSaving(false);
                          requestAnimationFrame(() => {
                            autoSaveReady.current = true;
                          });
                        }
                      })();
                    }}
                    className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700"
                  >
                    Clear schedule
                  </button>
                  </div>
                </div>
                {data.activities.length === 0 ? (
                  <div className="px-6 py-16 text-center">
                    <p className="font-semibold text-text">No activities in this schedule</p>
                    <p className="mt-2 text-sm text-text-muted">Add your first activity to begin building the project network.</p>
                    <button type="button" onClick={() => patchSchedule((d) => ({ ...d, activities: [newActivity(0)] }))} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">Add first activity</button>
                  </div>
                ) : (
                <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full min-w-[1050px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase text-text-muted">
                      <th className="py-2 pr-2">No.</th>
                      <th className="py-2 pr-2">Name</th>
                      <th className="py-2 pr-2">Duration</th>
                      <th
                        className="py-2 pr-2"
                        title="Activity continues from its Early Start until project completion. Duration is calculated automatically."
                      >
                        Until end
                      </th>
                      <th
                        className="py-2 pr-2 text-primary"
                        title="Optional Early Start day (0 = first day). Leave blank for formula. Set 0 on multiple activities to start in parallel."
                      >
                        Early Start (ES)
                      </th>
                      <th className="py-2 pr-2">ES</th>
                      <th className="py-2 pr-2">Type</th>
                      <th className="py-2 pr-2">TO</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.activities.map((a) => {
                      const link = incomingByActivity.get(a.id) ?? {
                        type: 'Independent' as const,
                        to: 'Independent',
                      };
                      const scheduled = scheduledById.get(a.id);
                      const computedEs = scheduled?.es ?? a.es ?? 0;
                      const displayDuration = a.extendToEnd
                        ? (scheduled?.duration ?? a.duration)
                        : a.duration;
                      return (
                      <tr key={a.id} className="border-b border-border/50">
                        <td className="py-2 pr-2">
                          <input
                            value={a.number}
                            onChange={(e) => updateActivity(a.id, { number: e.target.value })}
                            className="w-24 rounded border border-border px-2 py-1"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            value={a.name}
                            onChange={(e) => updateActivity(a.id, { name: e.target.value })}
                            className="w-full rounded border border-border px-2 py-1"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={displayDuration}
                            disabled={!!a.extendToEnd}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d]/g, '');
                              updateActivity(a.id, {
                                duration: raw === '' ? 0 : Number(raw),
                              });
                            }}
                            title={
                              a.extendToEnd
                                ? 'Duration is auto-calculated: project end − Early Start'
                                : 'Activity duration in days'
                            }
                            className="w-16 rounded border border-border px-2 py-1 disabled:bg-surface-muted disabled:text-text-muted"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <label className="inline-flex items-center gap-1.5 text-xs text-text">
                            <input
                              type="checkbox"
                              checked={!!a.extendToEnd}
                              onChange={(e) =>
                                updateActivity(a.id, { extendToEnd: e.target.checked })
                              }
                              title="Continue until project completion (Predecessor → this activity → End)"
                            />
                            Yes
                          </label>
                        </td>
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={a.esOverride ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d]/g, '');
                                updateActivity(a.id, {
                                  esOverride: raw === '' ? null : Number(raw),
                                });
                              }}
                              placeholder="auto"
                              title="Early Start day (0 = first day). Leave blank to use the normal ES formula."
                              className="w-16 rounded border border-primary/40 bg-primary-light/30 px-2 py-1"
                            />
                            <span className="whitespace-nowrap text-[10px] text-text-muted">
                              → ES {computedEs}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-2 text-text-muted">{computedEs}</td>
                        <td className="py-2 pr-2">
                          <select
                            value={link.type}
                            onChange={(e) => {
                              const nextType = e.target.value as DependencyType | 'Independent';
                              if (nextType === 'Independent') {
                                setIncomingLink(a.id, 'Independent', null);
                                return;
                              }
                              const predId =
                                link.fromId ??
                                data.activities.find((x) => x.id !== a.id)?.id ??
                                null;
                              setIncomingLink(a.id, nextType, predId);
                            }}
                            className="rounded border border-border px-2 py-1"
                            title="Independent = no predecessor. Or pick FS / SS / FF / SF."
                          >
                            {TYPE_OPTIONS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-2">
                          <select
                            value={link.type === 'Independent' ? '' : (link.fromId ?? '')}
                            onChange={(e) => {
                              const predId = e.target.value;
                              if (!predId) {
                                setIncomingLink(a.id, 'Independent', null);
                                return;
                              }
                              const nextType = link.type === 'Independent' ? 'FS' : link.type;
                              setIncomingLink(a.id, nextType, predId);
                            }}
                            className="rounded border border-border px-2 py-1"
                            title="Select Independent, or the predecessor activity (who finishes/starts before this one)."
                          >
                            <option value="">Independent</option>
                            {data.activities
                              .filter((x) => x.id !== a.id)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.number} — {x.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              patchSchedule((d) => ({
                                ...d,
                                activities: d.activities.filter((x) => x.id !== a.id),
                                dependencies: d.dependencies.filter(
                                  (dep) => dep.fromId !== a.id && dep.toId !== a.id,
                                ),
                              }))
                            }
                            className="text-xs text-red-600"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                )}
              </div>

              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-5">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold text-text">Dependencies</h2>
                      <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-text-muted">{data.dependencies.length} links</span>
                    </div>
                    <p className="mt-1 text-sm text-text-muted">Connect activities and control how each task starts relative to its predecessor.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const acts = data.activities;
                      if (acts.length < 2) {
                        setError('Add at least two activities before creating dependencies.');
                        return;
                      }
                      const next = suggestFsDependency(acts, data.dependencies);
                      if (!next) {
                        setError(
                          'Every activity pair already has a dependency. Change a row below or remove one first.',
                        );
                        return;
                      }
                      setError('');
                      patchSchedule((d) => ({
                        ...d,
                        dependencies: [
                          ...d.dependencies,
                          {
                            id: `new-d-${Date.now()}`,
                            fromId: next.fromId,
                            toId: next.toId,
                            type: 'FS' as const,
                            lag: 0,
                          },
                        ],
                      }));
                    }}
                    className="rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                    disabled={data.activities.length < 2}
                  >
                    + Add dependency
                  </button>
                </div>
                {data.activities.length < 2 ? (
                  <div className="bg-amber-50/70 px-6 py-12 text-center">
                    <p className="font-semibold text-amber-950">Add at least two activities first</p>
                    <p className="mt-2 text-sm text-amber-800">Dependencies connect one activity to another. Add another activity above to create the first link.</p>
                  </div>
                ) : data.dependencies.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <p className="font-semibold text-text">No dependencies yet</p>
                    <p className="mt-2 text-sm text-text-muted">Add a dependency to define the order of work.</p>
                  </div>
                ) : (
                <div className="overflow-x-auto px-5">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase text-text-muted">
                      <th className="py-2">From</th>
                      <th className="py-2">To</th>
                      <th className="py-2">Type</th>
                      <th className="py-2">Lag</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.dependencies.map((d) => (
                      <DependencyRow
                        key={d.id}
                        dep={d}
                        activities={activityOptions}
                        onPatch={updateDependency}
                        onRemove={removeDependency}
                      />
                    ))}
                  </tbody>
                </table>
                </div>
                )}
                <p className="mt-3 text-sm text-text-muted">
                  Lag is in days (0 if none). Negative lag = lead. Critical path:{' '}
                  <strong>{derived?.criticalPath.join(' → ') || '—'}</strong> · Project duration:{' '}
                  <strong>{derived?.projectDuration ?? 0} days</strong>
                  {derived?.pdmError ? (
                    <span className="ml-2 text-red-600">({derived.pdmError})</span>
                  ) : null}
                </p>
              </div>
            </div>
          )}

          {tab === 'bar' && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="mb-4 text-sm text-text-muted">
                Bar chart tasks are generated automatically from PDM (ES/EF). You can record actual end days
                for progress tracking.
              </p>
              <div className="mb-4 flex flex-wrap gap-4">
                <label className="text-sm">
                  Total days (from PDM)
                  <input
                    type="number"
                    readOnly
                    value={derived?.projectDuration ?? data.barChartTotalDays}
                    className="ml-2 w-20 rounded border border-border bg-surface-muted px-2 py-1"
                  />
                </label>
                <label className="text-sm">
                  Time-now (day)
                  <input
                    type="number"
                    min={0}
                    value={data.barChartTimeNow}
                    onChange={(e) =>
                      patchSchedule((d) => ({ ...d, barChartTimeNow: Number(e.target.value) }))
                    }
                    className="ml-2 w-20 rounded border border-border px-2 py-1"
                  />
                </label>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-text-muted">
                    <th className="py-2">#</th>
                    <th className="py-2">Task name</th>
                    <th className="py-2">Start</th>
                    <th className="py-2">End</th>
                    <th className="py-2">Actual end</th>
                  </tr>
                </thead>
                <tbody>
                  {derived?.barChartTasks.map((t) => (
                    <tr key={t.id} className="border-b border-border/50">
                      <td className="py-2 pr-2">{t.index}</td>
                      <td className="py-2 pr-2">{t.name}</td>
                      <td className="py-2 pr-2">{t.startDay}</td>
                      <td className="py-2 pr-2">{t.endDay}</td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          value={t.actualEndDay ?? ''}
                          onChange={(e) =>
                            updateActualEnd(
                              t.id,
                              e.target.value === '' ? undefined : Number(e.target.value),
                            )
                          }
                          className="w-16 rounded border border-border px-2 py-1"
                          placeholder="—"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      </div>
    </main>
  );
}
