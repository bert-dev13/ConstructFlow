'use client';

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from '../components/ProjectSelect';
import { UndoRedoToolbar } from '../components/ui/UndoRedoToolbar';
import { PageHeader } from '../components/ui/PageHeader';
import { PreviewModal } from '../components/ui/PreviewModal';
import { useUndoRedo, useUndoRedoKeyboard } from '../hooks/useUndoRedo';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import {
  getSchedule,
  saveSchedule,
  clearSchedule,
  loadReferenceSchedule,
  getProjectScheduleVersions,
  getScheduleVersion,
  createSuspendedProjectSchedule,
  type ProjectSchedule,
  type ProjectScheduleVersions,
} from '../lib/scheduleApi';
import { listProjects, type ProjectRow } from '../lib/projectsApi';
import { applyPdmDerivatives, deriveBarChartFromPdm } from '../lib/scheduleSync';
import { activityIncomingLinksMap, setActivityPredecessor, suggestFsDependency } from '../lib/pdm';
import type { ActivityIncomingLink } from '../lib/pdm';
import { REFERENCE_PDM_TITLE, HAS_REFERENCE_PDM } from '../data/roadPdmSample';
import type { DependencyType, PdmActivity, PdmDependency } from '../types';
import { PayItemSelect } from '../components/PayItemSelect';
import type { PayItem } from '../lib/payItemsApi';
import { listProjectBoq, type ProjectBoqItem } from '../lib/projectBoqApi';
import { mergeBoqIntoActivities } from '../lib/projectBoqSync';
import { buildPdmNetworkPreviewHtml } from '../lib/previewHelpers';
import { PdmNetworkDiagram } from '../components/PdmNetworkDiagram';
import { downloadReportPreviewPdf } from '../lib/downloadReportPdf';

const DEP_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const TYPE_OPTIONS: Array<DependencyType | 'Independent'> = ['Independent', 'FS', 'SS', 'FF', 'SF'];

const fieldClass =
  'w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-text outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20';
const fieldCompactClass =
  'rounded-md border border-border bg-card px-2 py-1.5 text-xs text-text outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20';

function newActivity(i: number): PdmActivity {
  const letter = String.fromCharCode(65 + (i % 26));
  return { id: `new-${Date.now()}-${i}`, number: letter, name: `Activity ${letter}`, duration: 3 };
}

function activityLabel(a: PdmActivity) {
  return `${a.number || '—'} — ${a.name || 'Untitled'}`;
}

const DependencyCard = memo(function DependencyCard({
  dep,
  index,
  activities,
  onPatch,
  onRemove,
}: {
  dep: PdmDependency;
  index: number;
  activities: PdmActivity[];
  onPatch: (depId: string, patch: Partial<PdmDependency>) => void;
  onRemove: (depId: string) => void;
}) {
  return (
    <article
      className="schedule-row-in flex flex-wrap items-end gap-2 rounded-xl border border-border/80 bg-card px-3 py-2.5 transition hover:border-primary/25 hover:bg-primary-light/10"
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
    >
      <span className="mb-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-light text-[10px] font-bold text-primary">
        {index + 1}
      </span>
      <label className="min-w-[140px] flex-1 space-y-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">From</span>
        <select
          value={dep.fromId}
          onChange={(e) => onPatch(dep.id, { fromId: e.target.value })}
          className={fieldClass}
        >
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {activityLabel(a)}
            </option>
          ))}
        </select>
      </label>
      <label className="w-[4.25rem] space-y-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Type</span>
        <select
          value={dep.type}
          onChange={(e) => onPatch(dep.id, { type: e.target.value as DependencyType })}
          className={fieldCompactClass}
        >
          {DEP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="w-14 space-y-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Lag</span>
        <input
          type="number"
          value={dep.lag ?? 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            onPatch(dep.id, { lag: Number.isFinite(n) ? n : 0 });
          }}
          className={`${fieldCompactClass} w-full text-center`}
          title="Lag in days. Use a negative number for lead."
        />
      </label>
      <NavIcon name="arrow-right" className="mb-2 hidden h-3.5 w-3.5 text-primary/60 sm:block" />
      <label className="min-w-[140px] flex-1 space-y-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">To</span>
        <select
          value={dep.toId}
          onChange={(e) => onPatch(dep.id, { toId: e.target.value })}
          className={fieldClass}
        >
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {activityLabel(a)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => onRemove(dep.id)}
        className="mb-0.5 rounded-md px-2 py-1.5 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
      >
        Remove
      </button>
    </article>
  );
});

const ActivityCard = memo(function ActivityCard({
  activity,
  index,
  link,
  computedEs,
  displayDuration,
  isCritical,
  projectBoqItems,
  activities,
  onUpdate,
  onSetIncoming,
  onRemove,
}: {
  activity: PdmActivity;
  index: number;
  link: ActivityIncomingLink;
  computedEs: number;
  displayDuration: number;
  isCritical: boolean;
  projectBoqItems: ProjectBoqItem[];
  activities: PdmActivity[];
  onUpdate: (id: string, patch: Partial<PdmActivity>) => void;
  onSetIncoming: (activityId: string, type: DependencyType | 'Independent', predecessorId: string | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <article
      className={`schedule-row-in rounded-xl border bg-card px-3 py-2.5 transition hover:border-primary/25 hover:bg-primary-light/10 ${
        isCritical ? 'border-red-200/90 bg-red-50/20' : 'border-border/80'
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
            isCritical ? 'bg-red-50 text-red-700' : 'bg-primary-light text-primary'
          }`}
        >
          {String(index + 1).padStart(2, '0')}
        </span>

        <div className="min-w-[180px] flex-[1.4] space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isCritical ? (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">
                Critical
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <PayItemSelect
                value={activity.payItemId ?? ''}
                onChange={(item: PayItem | null) => {
                  if (!item) {
                    onUpdate(activity.id, {
                      payItemId: undefined,
                      payItemVersion: undefined,
                    });
                    return;
                  }
                  onUpdate(activity.id, {
                    payItemId: item.id,
                    payItemVersion: item.version,
                    number: item.itemNo || activity.number || '',
                    name: item.description || activity.name || '',
                    unit: item.unit || activity.unit || '',
                  });
                }}
                fallbackLabel={activity.number || 'Select Pay Item'}
                projectBoqItems={projectBoqItems}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <input
              value={activity.number}
              onChange={(e) => onUpdate(activity.id, { number: e.target.value })}
              placeholder="Item No."
              title="Item number shown on PDM / S-Curve (editable)"
              className={`${fieldClass} w-[5.5rem]`}
            />
            <input
              value={activity.name}
              onChange={(e) => onUpdate(activity.id, { name: e.target.value })}
              placeholder="Activity description"
              title="Activity name shown on PDM network and charts (editable)"
              className={`${fieldClass} min-w-[10rem] flex-1`}
            />
            <input
              value={activity.unit ?? ''}
              onChange={(e) => onUpdate(activity.id, { unit: e.target.value })}
              placeholder="Unit"
              title="Unit of measure (editable)"
              className={`${fieldClass} w-[4.5rem]`}
            />
          </div>
        </div>

        <label className="w-[4.5rem] space-y-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Days</span>
          <input
            type="text"
            inputMode="numeric"
            value={displayDuration}
            disabled={!!activity.extendToEnd}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, '');
              onUpdate(activity.id, { duration: raw === '' ? 0 : Number(raw) });
            }}
            title={
              activity.extendToEnd
                ? 'Duration is auto-calculated: project end − Early Start'
                : 'Activity duration in days'
            }
            className={`${fieldClass} disabled:bg-surface-muted disabled:text-text-muted`}
          />
        </label>

        <label
          className="flex w-[4.75rem] flex-col justify-end gap-1 pb-0.5"
          title="Continue until project completion"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Until end</span>
          <span className="inline-flex h-[30px] items-center gap-1 text-xs text-text">
            <input
              type="checkbox"
              checked={!!activity.extendToEnd}
              onChange={(e) => onUpdate(activity.id, { extendToEnd: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-border text-primary"
            />
            Yes
          </span>
        </label>

        <label className="w-[7.5rem] space-y-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">ES override</span>
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              value={activity.esOverride ?? ''}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, '');
                onUpdate(activity.id, { esOverride: raw === '' ? null : Number(raw) });
              }}
              placeholder="auto"
              className={`${fieldClass} border-primary/30 bg-primary-light/30`}
            />
            <span className="shrink-0 rounded bg-surface-muted px-1.5 py-1 text-[10px] font-semibold text-text">
              {computedEs}
            </span>
          </div>
        </label>

        <label className="w-[5.5rem] space-y-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Type</span>
          <select
            value={link.type}
            onChange={(e) => {
              const nextType = e.target.value as DependencyType | 'Independent';
              if (nextType === 'Independent') {
                onSetIncoming(activity.id, 'Independent', null);
                return;
              }
              const predId =
                link.fromId ?? activities.find((x) => x.id !== activity.id)?.id ?? null;
              onSetIncoming(activity.id, nextType, predId);
            }}
            className={fieldClass}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-[140px] flex-1 space-y-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Predecessor</span>
          <select
            value={link.type === 'Independent' ? '' : (link.fromId ?? '')}
            onChange={(e) => {
              const predId = e.target.value;
              if (!predId) {
                onSetIncoming(activity.id, 'Independent', null);
                return;
              }
              const nextType = link.type === 'Independent' ? 'FS' : link.type;
              onSetIncoming(activity.id, nextType, predId);
            }}
            className={fieldClass}
          >
            <option value="">Independent</option>
            {activities
              .filter((x) => x.id !== activity.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {activityLabel(x)}
                </option>
              ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => onRemove(activity.id)}
          className="mt-4 rounded-md px-2 py-1.5 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
        >
          Remove
        </button>
      </div>
    </article>
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
  const [tab, setTab] = useState<'activities' | 'dependencies' | 'bar'>('activities');
  const [projectBoqItems, setProjectBoqItems] = useState<ProjectBoqItem[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [downloadingPreview, setDownloadingPreview] = useState(false);
  const [versions, setVersions] = useState<ProjectScheduleVersions | null>(null);
  const [viewingOriginal, setViewingOriginal] = useState(false);
  const [suspendedOpen, setSuspendedOpen] = useState(false);
  const [suspendedProjects, setSuspendedProjects] = useState<ProjectRow[]>([]);
  const [suspendedPick, setSuspendedPick] = useState('');
  const [creatingSuspended, setCreatingSuspended] = useState(false);
  const [scheduleNonce, setScheduleNonce] = useState(0);
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
      const [schedule, boq, versionInfo] = await Promise.all([
        viewingOriginal
          ? getScheduleVersion(projectId, 'original')
          : getSchedule(projectId),
        listProjectBoq(projectId).catch(() => [] as ProjectBoqItem[]),
        getProjectScheduleVersions(projectId).catch(() => null),
      ]);
      replaceData(applyPdmDerivatives(schedule));
      setProjectBoqItems(boq);
      setVersions(versionInfo);
    } catch {
      setError('Could not load schedule from database.');
    } finally {
      setLoading(false);
      // Allow auto-save only after load settles (next tick).
      requestAnimationFrame(() => {
        autoSaveReady.current = true;
      });
    }
  }, [projectId, replaceData, viewingOriginal, scheduleNonce]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const apply = (projects: { id: string }[]) => {
      if (cancelled) return;
      setHasProjects(projects.length > 0);
      if (projects.length > 0 && !projects.some((p) => String(p.id) === projectId)) {
        setProjectId(String(projects[0].id));
      }
    };
    listProjects()
      .then((res) => {
        apply(res.projects);
        if (cancelled || res.projects.length > 0) return;
        window.setTimeout(() => {
          if (cancelled) return;
          listProjects()
            .then((again) => apply(again.projects))
            .catch(() => {
              if (!cancelled) setHasProjects(true);
            });
        }, 500);
      })
      .catch(() => {
        if (!cancelled) setHasProjects(true);
      });
    return () => {
      cancelled = true;
    };
    // projectId is read once per signed-in user so selecting a project does not
    // cancel this load and leave the page on an empty result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, setProjectId]);

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
    if (!data || savingRef.current || viewingOriginal) return;
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
  }, [data, derived?.pdmError, projectId, replaceData, viewingOriginal]);

  // Auto-save ~2s after the last edit so dropdown changes stay responsive.
  useEffect(() => {
    if (!canEdit || viewingOriginal || !data || !dirty || loading || !autoSaveReady.current) return;
    if (derived?.pdmError) return;

    const timer = window.setTimeout(() => {
      void handleSave({ silent: true });
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [canEdit, viewingOriginal, data, dirty, loading, derived?.pdmError, handleSave]);

  const updateActivity = useCallback((id: string, patch: Partial<PdmActivity>) => {
    patchSchedule((d) => ({
      ...d,
      activities: d.activities.map((a) => {
        if (a.id !== id) return a;
        const next = { ...a, ...patch };
        // Firestore rejects undefined — drop keys cleared to undefined by patches.
        (Object.keys(next) as (keyof PdmActivity)[]).forEach((key) => {
          if (next[key] === undefined) delete next[key];
        });
        return next;
      }),
    }));
  }, [patchSchedule]);

  const removeActivity = useCallback(
    (id: string) => {
      patchSchedule((d) => ({
        ...d,
        activities: d.activities.filter((x) => x.id !== id),
        dependencies: d.dependencies.filter((dep) => dep.fromId !== id && dep.toId !== id),
      }));
    },
    [patchSchedule],
  );

  const updateActualEnd = useCallback(
    (id: string, actualEndDay: number | null) => {
      patchSchedule((d) => ({
        ...d,
        barChartTasks: d.barChartTasks.map((t) => (t.id === id ? { ...t, actualEndDay } : t)),
      }));
    },
    [patchSchedule],
  );

  useUndoRedoKeyboard(undo, redo, canEdit && !!data && !viewingOriginal);

  const openSuspendedPanel = () => {
    setSuspendedOpen(true);
    setError('');
    void listProjects()
      .then((res) => {
        const rows = res.projects.filter((project) => project.status === 'suspended');
        setSuspendedProjects(rows);
        setSuspendedPick((current) => current || (rows[0] ? String(rows[0].id) : ''));
      })
      .catch(() => setError('Could not load suspended projects.'));
  };

  const createSuspendedSchedule = async () => {
    if (!suspendedPick) return;
    setCreatingSuspended(true);
    setError('');
    setSuccess('');
    try {
      const result = await createSuspendedProjectSchedule(suspendedPick);
      setViewingOriginal(false);
      setProjectId(String(suspendedPick));
      setScheduleNonce((value) => value + 1);
      setSuspendedOpen(false);
      setSuccess(
        result.alreadyExisted
          ? 'Opened the current schedule for this suspended project. The original schedule is unchanged.'
          : 'New schedule created under the same project. The original schedule is kept for reference.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the suspended-project schedule.');
    } finally {
      setCreatingSuspended(false);
    }
  };

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
      <div className="space-y-5 px-8 pb-10 pt-6">
      <PageHeader
        badge="Schedule"
        title="Prepare schedule"
        description="Build the PDM network and automatically synchronize the bar chart and S-Curve for the selected project."
        actions={
          <>
            <button
              type="button"
              onClick={openSuspendedPanel}
              className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-100"
            >
              For Suspended Projects
            </button>
            <div className="min-w-[160px] flex-1 sm:max-w-[220px]">
              <ProjectSelect value={projectId} onChange={setProjectId} />
            </div>
            <UndoRedoToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
            <button
              type="button"
              disabled={!data || (data.activities.length === 0)}
              onClick={() => {
                if (!derived) return;
                const panel = document.getElementById('schedule-pdm-diagram-panel');
                const svg = panel?.querySelector('svg') as SVGSVGElement | null;
                setPreviewHtml(
                  buildPdmNetworkPreviewHtml({
                    projectLabel: `Project ${projectId}`,
                    projectDuration: derived.projectDuration,
                    criticalPath: derived.criticalPath.join(' → '),
                    svg,
                  }),
                );
                setPreviewOpen(true);
              }}
              className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text disabled:opacity-50"
            >
              Preview
            </button>
            {!viewingOriginal && (
              <button
                type="button"
                disabled={saving || !data}
                onClick={() => void handleSave()}
                className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : dirty ? 'Save*' : 'Save'}
              </button>
            )}
          </>
        }
      />

      {suspendedOpen && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-[220px] flex-1">
              <h2 className="text-sm font-semibold text-text">Suspended projects</h2>
              <p className="mt-1 text-xs text-text-muted">
                Create a new schedule on the same project. The original schedule stays stored and unchanged.
              </p>
              {suspendedProjects.length === 0 ? (
                <p className="mt-3 text-sm text-text-muted">No projects are marked Suspended.</p>
              ) : (
                <label className="mt-3 block text-xs font-semibold text-text-muted">
                  Project
                  <select
                    value={suspendedPick}
                    onChange={(e) => setSuspendedPick(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-text"
                  >
                    {suspendedProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSuspendedOpen(false)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-muted"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!suspendedPick || creatingSuspended}
                onClick={() => void createSuspendedSchedule()}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {creatingSuspended ? 'Creating…' : 'Create new schedule'}
              </button>
            </div>
          </div>
        </section>
      )}

      {versions?.hasOriginal && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <p className="font-semibold text-text">
            {viewingOriginal
              ? 'Original Schedule / Previous Schedule'
              : versions.activeLabel || 'Current Active Schedule'}
          </p>
          <button
            type="button"
            onClick={() => setViewingOriginal((current) => !current)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text"
          >
            {viewingOriginal ? 'Back to current schedule' : 'View original schedule'}
          </button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ['Activities', data?.activities.length ?? 0, 'PDM activities in this schedule', 'projects'],
          ['Dependencies', data?.dependencies.length ?? 0, 'Activity relationships', 'pdm'],
          ['Project duration', `${derived?.projectDuration ?? 0} days`, 'Calculated from the network', 'schedule'],
          ['Critical path', derived?.criticalPath.length ?? 0, 'Zero-float activities', 'approval'],
        ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
          <div key={label} className="rounded-xl border border-border bg-card px-3.5 py-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-light text-primary">
                <NavIcon name={icon} className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-1.5 text-xl font-semibold text-text">{loading ? '…' : value}</p>
            <p className="mt-0.5 text-[11px] text-text-muted">{caption}</p>
          </div>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>}
      {success && <div className="rounded-xl border border-primary/20 bg-primary-light p-4 text-sm text-primary">{success}</div>}

      {loading || !data ? (
        <p className="text-sm text-text-muted">Loading schedule…</p>
      ) : (
        <>
          {derived?.activities.length ? (
            <PdmNetworkDiagram
              panelId="schedule-pdm-diagram-panel"
              activities={derived.activities}
              dependencies={data.dependencies}
              compact
            />
          ) : null}

          {viewingOriginal ? (
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-sm font-semibold text-text">Original schedule (read only)</p>
              <p className="mt-1 text-xs text-text-muted">
                This snapshot is the schedule from before the suspended-project schedule. It is not used by PDM, S-Curve, Bar Chart, SWA, or STEWA.
              </p>
              <ul className="mt-3 divide-y divide-border text-sm">
                {(data?.activities ?? []).map((activity) => (
                  <li key={activity.id} className="flex justify-between gap-3 py-2">
                    <span className="font-medium text-text">
                      {activity.number} — {activity.name}
                    </span>
                    <span className="text-text-muted">{activity.duration}d</span>
                  </li>
                ))}
                {(data?.activities.length ?? 0) === 0 && (
                  <li className="py-2 text-text-muted">No activities in the original schedule.</li>
                )}
              </ul>
            </section>
          ) : (
          <>
          <div className="page-toolbar-in flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card/95 p-2 shadow-sm">
            <div className="flex flex-wrap rounded-lg bg-surface-muted/80 p-0.5" role="tablist" aria-label="Schedule editor views">
              {(
                [
                  ['activities', 'Activities', 'projects', data.activities.length],
                  ['dependencies', 'Dependencies', 'pdm', data.dependencies.length],
                  ['bar', 'Bar chart', 'bar-chart', derived?.barChartTasks.length ?? 0],
                ] as const
              ).map(([id, label, icon, count]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  role="tab"
                  aria-selected={tab === id}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    tab === id ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'
                  }`}
                >
                  <NavIcon name={icon} className="h-3.5 w-3.5" />
                  {label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      tab === id ? 'bg-white/20 text-white' : 'bg-card text-text-muted'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-1.5 text-[11px] text-text-muted">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  saving
                    ? 'schedule-autosave-dot bg-accent'
                    : dirty
                      ? 'schedule-autosave-dot bg-warning'
                      : 'bg-emerald-500'
                }`}
              />
              <span>
                {saving ? 'Saving…' : dirty ? 'Unsaved — auto-saves soon' : 'Saved'}
              </span>
            </div>
          </div>

          {(tab === 'activities' || tab === 'dependencies') && (
            <div className="schedule-panel-in schedule-critical-strip flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/80 px-3 py-2 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-red-50 text-red-600">
                  <NavIcon name="approval" className="h-3.5 w-3.5" />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-red-700/80">
                  Critical · {derived?.projectDuration ?? 0}d
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {(derived?.criticalPath.length ? derived.criticalPath : ['—']).map((step, i, arr) => (
                  <span key={`${step}-${i}`} className="inline-flex items-center gap-1">
                    <span className="rounded border border-red-200/80 bg-card/90 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                      {step}
                    </span>
                    {i < arr.length - 1 ? (
                      <NavIcon name="arrow-right" className="h-3 w-3 text-red-400" />
                    ) : null}
                  </span>
                ))}
              </div>
              {derived?.pdmError ? (
                <p className="text-[11px] font-semibold text-red-600">{derived.pdmError}</p>
              ) : null}
            </div>
          )}

          {tab === 'activities' && (
            <div className="schedule-panel-in overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                <div>
                  <h2 className="text-sm font-semibold text-text">PDM activities</h2>
                  <p className="text-[11px] text-text-muted">Sequence, duration, ES overrides, predecessors</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      patchSchedule((d) => ({
                        ...d,
                        activities: [...d.activities, newActivity(d.activities.length)],
                      }))
                    }
                    className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-primary-dark"
                  >
                    + Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!projectId) return;
                      void (async () => {
                        try {
                          const boq = await listProjectBoq(projectId);
                          if (!boq.some((row) => row.active && row.payItemId)) {
                            setError(
                              'No active project Pay Items found. Select Pay Items on the project BOQ page first.',
                            );
                            return;
                          }
                          patchSchedule((d) => {
                            const merged = mergeBoqIntoActivities(d.activities, boq);
                            setSuccess(
                              `Synced from project BOQ: ${merged.added} added, ${merged.updated} updated. Bar chart / S-Curve use these activities.`,
                            );
                            setError('');
                            return { ...d, activities: merged.activities };
                          });
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : 'Could not sync from project BOQ.',
                          );
                        }
                      })();
                    }}
                    className="rounded-lg border border-primary/25 bg-primary-light/70 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition hover:bg-primary-light"
                    title="Use Pay Items already selected on the project BOQ as PDM activities"
                  >
                    Sync BOQ
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
                    className="rounded-lg border border-primary/25 bg-primary-light/70 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition hover:bg-primary-light disabled:opacity-50"
                  >
                    Load reference
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
                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {data.activities.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm font-semibold text-text">No activities yet</p>
                  <p className="mt-1 text-xs text-text-muted">
                    Add an activity, sync from BOQ, or load the reference PDM.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      patchSchedule((d) => ({ ...d, activities: [newActivity(0)] }))
                    }
                    className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Add first activity
                  </button>
                </div>
              ) : (
                <div className="max-h-[min(62vh,720px)] space-y-1.5 overflow-y-auto p-2.5">
                  {data.activities.map((a, index) => {
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
                      <ActivityCard
                        key={a.id}
                        activity={a}
                        index={index}
                        link={link}
                        computedEs={computedEs}
                        displayDuration={displayDuration}
                        isCritical={!!scheduled?.isCritical}
                        projectBoqItems={projectBoqItems}
                        activities={data.activities}
                        onUpdate={updateActivity}
                        onSetIncoming={setIncomingLink}
                        onRemove={removeActivity}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'dependencies' && (
            <div className="schedule-panel-in overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                <div>
                  <h2 className="text-sm font-semibold text-text">Dependencies</h2>
                  <p className="text-[11px] text-text-muted">
                    Lag in days (0 if none). Negative lag = lead.
                  </p>
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
                  className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
                  disabled={data.activities.length < 2}
                >
                  + Add dependency
                </button>
              </div>

              {data.activities.length < 2 ? (
                <div className="bg-amber-50/70 px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-amber-950">Add at least two activities first</p>
                  <p className="mt-1 text-xs text-amber-800">
                    Switch to the Activities tab to add more work items.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('activities')}
                    className="mt-3 rounded-lg border border-amber-300 bg-card px-3 py-1.5 text-xs font-semibold text-amber-900"
                  >
                    Go to Activities
                  </button>
                </div>
              ) : data.dependencies.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-text">No dependencies yet</p>
                  <p className="mt-1 text-xs text-text-muted">Add a link to define work order.</p>
                </div>
              ) : (
                <div className="max-h-[min(62vh,720px)] space-y-1.5 overflow-y-auto p-2.5">
                  {data.dependencies.map((d, index) => (
                    <DependencyCard
                      key={d.id}
                      dep={d}
                      index={index}
                      activities={activityOptions}
                      onPatch={updateDependency}
                      onRemove={removeDependency}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'bar' && (
            <div className="schedule-panel-in rounded-xl border border-border/80 bg-card p-3 shadow-sm">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-text">Bar chart preview</h2>
                  <p className="text-[11px] text-text-muted">
                    Generated from PDM (ES/EF). Record actual end days for progress.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="rounded-lg border border-border/80 bg-surface-muted/40 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Total days
                    <input
                      type="number"
                      readOnly
                      value={derived?.projectDuration ?? data.barChartTotalDays}
                      className="mt-0.5 block w-20 rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold normal-case tracking-normal text-text"
                    />
                  </label>
                  <label className="rounded-lg border border-border/80 bg-surface-muted/40 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Time-now
                    <input
                      type="number"
                      min={0}
                      value={data.barChartTimeNow}
                      onChange={(e) =>
                        patchSchedule((d) => ({ ...d, barChartTimeNow: Number(e.target.value) }))
                      }
                      className="mt-0.5 block w-20 rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold normal-case tracking-normal text-text outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </label>
                </div>
              </div>
              <div className="max-h-[min(62vh,720px)] overflow-auto rounded-lg border border-border/80">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border bg-surface-muted text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      <th className="px-2.5 py-2">#</th>
                      <th className="px-2.5 py-2">Task name</th>
                      <th className="px-2.5 py-2">Start</th>
                      <th className="px-2.5 py-2">End</th>
                      <th className="px-2.5 py-2">Actual end</th>
                    </tr>
                  </thead>
                  <tbody>
                    {derived?.barChartTasks.map((t, index) => (
                      <tr
                        key={t.id}
                        className="schedule-row-in border-b border-border/50 transition hover:bg-primary-light/20"
                        style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                      >
                        <td className="px-2.5 py-1.5 text-text-muted">{t.index}</td>
                        <td className="px-2.5 py-1.5 font-medium text-text">{t.name}</td>
                        <td className="px-2.5 py-1.5">{t.startDay}</td>
                        <td className="px-2.5 py-1.5">{t.endDay}</td>
                        <td className="px-2.5 py-1.5">
                          <input
                            type="number"
                            value={t.actualEndDay ?? ''}
                            onChange={(e) =>
                              updateActualEnd(
                                t.id,
                                e.target.value === '' ? null : Number(e.target.value),
                              )
                            }
                            className="w-16 rounded-md border border-border px-2 py-1 text-xs outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                            placeholder="—"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>
          )}
        </>
      )}
      </div>

      <PreviewModal
        title="Network diagram preview"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        iframeSrcDoc={previewHtml}
        iframeTitle="Schedule network diagram preview"
        wide
        downloading={downloadingPreview}
        onDownload={() => {
          void (async () => {
            setDownloadingPreview(true);
            try {
              await downloadReportPreviewPdf({
                fileName: `schedule-network-${projectId}.pdf`,
                frame: document.querySelector(
                  'iframe[title="Schedule network diagram preview"]',
                ) as HTMLIFrameElement | null,
              });
            } finally {
              setDownloadingPreview(false);
            }
          })();
        }}
      />
    </main>
  );
}
