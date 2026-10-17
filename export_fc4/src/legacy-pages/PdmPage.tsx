'use client';

import { useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from '../components/ProjectSelect';
import { DocumentsBackLink } from '../components/DocumentsBackLink';
import { getProjectScheduleVersions, getSchedule, getScheduleVersion, type ProjectScheduleVersions } from '../lib/scheduleApi';
import { DEPENDENCY_LABELS, activityIncomingLink, formatDependencyLag } from '../lib/pdm';
import { PdmNetworkDiagram } from '../components/PdmNetworkDiagram';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { PreviewModal } from '../components/ui/PreviewModal';
import { usePagination } from '../hooks/usePagination';
import type { PdmActivity, PdmDependency } from '../types';
import { downloadReportPreviewPdf } from '../lib/downloadReportPdf';
import { buildPdmNetworkPreviewHtml } from '../lib/previewHelpers';
import { canEditProjectCharts } from '../lib/chartPermissions';

export function PdmPage() {
  const { user } = useAuth();
  const { projectId, setProjectId } = useSelectedProject();
  const canEditCharts = canEditProjectCharts(user?.role);
  const [activities, setActivities] = useState<PdmActivity[]>([]);
  const [dependencies, setDependencies] = useState<PdmDependency[]>([]);
  const [projectDuration, setProjectDuration] = useState(0);
  const [criticalPath, setCriticalPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [downloadingPreview, setDownloadingPreview] = useState(false);
  const [versions, setVersions] = useState<ProjectScheduleVersions | null>(null);
  const [viewingOriginal, setViewingOriginal] = useState(false);
  const activityPaging = usePagination(activities, { resetKey: `${projectId}|${viewingOriginal}` });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [data, versionInfo] = await Promise.all([
          viewingOriginal ? getScheduleVersion(projectId, 'original') : getSchedule(projectId),
          getProjectScheduleVersions(projectId).catch(() => null),
        ]);
        if (!cancelled) {
          setActivities(data.activities);
          setDependencies(data.dependencies);
          setProjectDuration(data.projectDuration);
          setCriticalPath(data.criticalPath);
          setError(data.pdmError ?? '');
          setVersions(versionInfo);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load PDM schedule from database.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, viewingOriginal]);

  const criticalNumbers = criticalPath.join(' → ');
  const criticalActivityCount = activities.filter((activity) => activity.isCritical).length;
  const dependencyTypeCount = new Set(dependencies.map((dependency) => dependency.type)).size;

  const openPdmPreview = () => {
    const panel = document.getElementById('pdm-diagram-panel');
    const svg = panel?.querySelector('svg') as SVGSVGElement | null;
    setPreviewHtml(
      buildPdmNetworkPreviewHtml({
        projectLabel: `Project ${projectId}`,
        projectDuration,
        criticalPath: criticalNumbers,
        svg,
      }),
    );
    setPreviewOpen(true);
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <DocumentsBackLink />
      <div className="space-y-5 px-8 pb-10 pt-6">
      <PageHeader
        badge="Schedule"
        title="PDM schedule"
        description="Review activity sequencing, durations, dependencies, and the critical path for the selected project. Editing the schedule is limited to the Contractor (Prepare Schedule)."
        actions={
          <>
            {!canEditCharts && (
              <span className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
                View only
              </span>
            )}
            {versions?.hasOriginal && (
              <button
                type="button"
                onClick={() => setViewingOriginal((current) => !current)}
                className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text"
              >
                {viewingOriginal ? 'Current schedule' : 'Original schedule'}
              </button>
            )}
            <div className="min-w-[160px] flex-1 sm:max-w-[220px]">
              <ProjectSelect value={projectId} onChange={setProjectId} />
            </div>
            <button
              type="button"
              disabled={loading || activities.length === 0}
              onClick={openPdmPreview}
              className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text transition hover:border-primary/30 hover:bg-primary-light/40 disabled:opacity-50"
            >
              Preview
            </button>
            {user?.role === 'contractor' && (
              <Link
                to="/schedule"
                className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-primary/90"
              >
                Prepare schedule
              </Link>
            )}
          </>
        }
      />

      {versions?.hasOriginal && (
        <p className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-text">
          {viewingOriginal
            ? 'Original Schedule / Previous Schedule — reference only'
            : versions.activeLabel || 'Current Active Schedule'}
        </p>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-border bg-card" />)}
        </div>
      ) : activities.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-sm">
          <p className="text-lg font-semibold text-text">No PDM schedule yet</p>
          <p className="mt-2 text-sm text-text-muted">
            All activities and dependencies were cleared. Send the new reference schedule to be loaded,
            or use <strong>Prepare Construction Schedule</strong> to enter activities manually.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {([
              ['Project duration', `${projectDuration} days`, 'Planned network duration', 'schedule'],
              ['Activities', activities.length, 'Total scheduled activities', 'projects'],
              ['Critical activities', criticalActivityCount, criticalNumbers ? `Path: ${criticalNumbers}` : 'No critical path found', 'approval'],
              ['Dependencies', dependencies.length, `${dependencyTypeCount} relationship type${dependencyTypeCount === 1 ? '' : 's'}`, 'pdm'],
            ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
              <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                    <NavIcon name={icon} className="h-5 w-5" />
                  </span>
                </div>
                <p className={`mt-3 text-2xl font-semibold ${label === 'Critical activities' && criticalActivityCount > 0 ? 'text-red-600' : 'text-text'}`}>{value}</p>
                <p className="mt-1 truncate text-xs text-text-muted" title={caption}>{caption}</p>
              </div>
            ))}
          </div>

          <PdmNetworkDiagram activities={activities} dependencies={dependencies} />

            <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="border-b border-border bg-surface-muted/40 px-5 py-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                      Precedence network
                    </p>
                    <h2 className="mt-0.5 text-lg font-semibold text-text">Activity schedule</h2>
                    <p className="mt-1 text-sm text-text-muted">
                      Early and late dates from the PDM network. Float = 0 marks the critical path.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-border bg-card px-2.5 py-1 font-semibold text-text">
                      {activities.length} activities
                    </span>
                    <span className="rounded-full border border-border bg-card px-2.5 py-1 font-semibold text-text">
                      {dependencies.length} dependencies
                    </span>
                    <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700">
                      {activities.filter((a) => a.isCritical).length} critical
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 border-b border-border p-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border/80 bg-surface/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Node fields
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(
                      [
                        ['D', 'Duration'],
                        ['ES', 'Early Start'],
                        ['EF', 'Early Finish'],
                        ['LS', 'Latest Start'],
                        ['LF', 'Latest Finish'],
                        ['TF', 'Total float (LS−ES)'],
                      ] as const
                    ).map(([code, label]) => (
                      <div
                        key={code}
                        className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-2"
                      >
                        <span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md bg-primary-light px-1.5 text-[11px] font-bold text-primary">
                          {code}
                        </span>
                        <span className="text-xs leading-tight text-text-muted">{label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
                    Total float is LS − ES (same as LF − EF). Activities with float = 0 are critical.
                  </p>
                </div>

                <div className="rounded-xl border border-border/80 bg-surface/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Dependency types
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(DEPENDENCY_LABELS).map(([key, label]) => (
                      <div
                        key={key}
                        className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-2"
                        title={label}
                      >
                        <span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md bg-slate-800 px-1.5 text-[11px] font-bold text-white">
                          {key}
                        </span>
                        <span className="text-xs text-text-muted">{label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
                    Lag defaults to 0. A lead is a negative lag. With multiple predecessors, the
                    latest required date governs.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                  <thead className="bg-surface-muted/60">
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                      <th className="px-4 py-3 font-semibold">No.</th>
                      <th className="px-4 py-3 font-semibold">Activity</th>
                      <th className="px-4 py-3 font-semibold" title="Duration">
                        D
                      </th>
                      <th className="px-4 py-3 font-semibold" title="Early Start">
                        ES
                      </th>
                      <th className="px-4 py-3 font-semibold" title="Early Finish">
                        EF
                      </th>
                      <th className="px-4 py-3 font-semibold">Link</th>
                      <th className="px-4 py-3 font-semibold" title="Latest Start">
                        LS
                      </th>
                      <th className="px-4 py-3 font-semibold" title="Latest Finish">
                        LF
                      </th>
                      <th className="px-4 py-3 font-semibold" title="Total float (LS − ES)">
                        Float
                      </th>
                      <th className="px-4 py-3 font-semibold">Path</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/80">
                    {activityPaging.pageItems.map((a) => {
                      const floatEs = (a.ls ?? 0) - (a.es ?? 0);
                      const link = activityIncomingLink(a.id, activities, dependencies);
                      const isIndependent = link.type === 'Independent';
                      return (
                        <tr
                          key={a.id}
                          className={`transition hover:bg-surface-muted/40 ${
                            a.isCritical ? 'bg-red-50/70' : ''
                          }`}
                        >
                          <td className="px-4 py-3 font-semibold text-text">{a.number}</td>
                          <td className="max-w-[280px] px-4 py-3">
                            <p className="font-medium text-text">{a.name}</p>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-text">{a.duration}</td>
                          <td className="px-4 py-3 tabular-nums text-text-muted">
                            {a.es == null ? '—' : a.es}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-text-muted">
                            {a.ef == null ? '—' : a.ef}
                          </td>
                          <td className="px-4 py-3">
                            {isIndependent ? (
                              <span className="text-xs text-text-muted">Independent</span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  {link.type}
                                  {formatDependencyLag(link.lag)}
                                </span>
                                <span className="text-xs text-text-muted">→ {link.to}</span>
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-text-muted">
                            {a.ls == null ? '—' : a.ls}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-text-muted">
                            {a.lf == null ? '—' : a.lf}
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            <span
                              className={
                                floatEs === 0
                                  ? 'font-semibold text-red-600'
                                  : 'text-text-muted'
                              }
                            >
                              {floatEs}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {a.isCritical ? (
                              <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-700">
                                Critical
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                Float
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={activityPaging.page}
                totalPages={activityPaging.totalPages}
                total={activityPaging.total}
                from={activityPaging.from}
                to={activityPaging.to}
                pageSize={activityPaging.pageSize}
                onPageChange={activityPaging.setPage}
              />
            </div>
        </>
      )}
    </div>

      <PreviewModal
        title="Network diagram preview"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        iframeSrcDoc={previewHtml}
        iframeTitle="PDM network diagram preview"
        wide
        downloading={downloadingPreview}
        onDownload={() => {
          void (async () => {
            setDownloadingPreview(true);
            try {
              await downloadReportPreviewPdf({
                fileName: `pdm-network-${projectId}.pdf`,
                frame: document.querySelector(
                  'iframe[title="PDM network diagram preview"]',
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
