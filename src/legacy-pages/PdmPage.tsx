'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from '../components/ProjectSelect';
import { DocumentsBackLink } from '../components/DocumentsBackLink';
import { getSchedule } from '../lib/scheduleApi';
import { DEPENDENCY_LABELS, activityIncomingLink, formatDependencyLag, getCriticalPath, isIndependentActivity } from '../lib/pdm';
import { dependencyEdge, dependencyLaneOffsets, diagramBounds, endActivityBranchPath, layoutPaperNetwork, layoutProjectEndNode, layoutProjectStartNode, PDM_BUS_STUB, PDM_END_HALF_W, roundedOrthoPath, startActivityBranchPath } from '../lib/pdmLayout';
import { PdmNode, PdmStartNode, PdmEndNode, PDM_NODE_HALF_H, PDM_NODE_HALF_W } from '../components/PdmNode';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { usePagination } from '../hooks/usePagination';
import type { PdmActivity, PdmDependency } from '../types';

export function PdmPage() {
  const { user } = useAuth();
  const { projectId, setProjectId } = useSelectedProject();
  const [activities, setActivities] = useState<PdmActivity[]>([]);
  const [dependencies, setDependencies] = useState<PdmDependency[]>([]);
  const [projectDuration, setProjectDuration] = useState(0);
  const [criticalPath, setCriticalPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activityPaging = usePagination(activities, { resetKey: projectId });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getSchedule(projectId);
        if (!cancelled) {
          setActivities(data.activities);
          setDependencies(data.dependencies);
          setProjectDuration(data.projectDuration);
          setCriticalPath(data.criticalPath);
          setError(data.pdmError ?? '');
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
  }, [projectId]);

  const mainChainIds = useMemo(
    () => new Set(getCriticalPath(activities, dependencies).map((a) => a.id)),
    [activities, dependencies],
  );

  const positions = useMemo(
    () => layoutPaperNetwork(activities, dependencies),
    [activities, dependencies],
  );

  const startActivities = useMemo(
    () => activities.filter((a) => isIndependentActivity(a.id, dependencies)),
    [activities, dependencies],
  );

  const startNode = useMemo(
    () => layoutProjectStartNode(startActivities, positions),
    [startActivities, positions],
  );

  const endActivities = useMemo(
    () => activities.filter((a) => !dependencies.some((d) => d.fromId === a.id)),
    [activities, dependencies],
  );

  const endNode = useMemo(
    () => layoutProjectEndNode(endActivities, positions),
    [endActivities, positions],
  );

  const criticalNumbers = criticalPath.join(' → ');
  const criticalActivityCount = activities.filter((activity) => activity.isCritical).length;
  const dependencyTypeCount = new Set(dependencies.map((dependency) => dependency.type)).size;

  const bounds = useMemo(
    () => diagramBounds(positions, PDM_NODE_HALF_W, PDM_NODE_HALF_H, startNode, endNode),
    [positions, startNode, endNode],
  );

  return (
    <main className="flex-1 overflow-y-auto">
      <DocumentsBackLink />
      <div className="space-y-5 px-8 pb-10 pt-6">
      <PageHeader
        badge="Schedule"
        title="PDM schedule"
        description="Review activity sequencing, durations, dependencies, and the critical path for the selected project."
        actions={
          <>
            <div className="min-w-[160px] flex-1 sm:max-w-[220px]">
              <ProjectSelect value={projectId} onChange={setProjectId} />
            </div>
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

          <div className="schedule-panel-in overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-text">Network diagram</h2>
                <p className="mt-1 text-sm text-text-muted">
                  Activity flow with rounded elbows and flush arrow docking.
                </p>
              </div>
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                {criticalActivityCount} critical {criticalActivityCount === 1 ? 'activity' : 'activities'}
              </span>
            </div>
            <div className="pdm-diagram-canvas overflow-x-auto p-4 sm:p-5">
            <svg
              viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
              className="min-h-[300px] overflow-visible"
              style={{ width: Math.max(bounds.w, 640), height: Math.max(bounds.h, 300) }}
              preserveAspectRatio="xMinYMin meet"
            >

              <defs>
                <marker
                  id="arrow"
                  markerUnits="userSpaceOnUse"
                  markerWidth="18"
                  markerHeight="18"
                  refX="15"
                  refY="9"
                  orient="auto"
                >
                  <path d="M2,2 L15,9 L2,16 Z" fill="#334155" />
                </marker>
                <marker
                  id="arrow-critical"
                  markerUnits="userSpaceOnUse"
                  markerWidth="18"
                  markerHeight="18"
                  refX="15"
                  refY="9"
                  orient="auto"
                >
                  <path d="M2,2 L15,9 L2,16 Z" fill="#dc2626" />
                </marker>
                <marker
                  id="arrow-structure"
                  markerUnits="userSpaceOnUse"
                  markerWidth="16"
                  markerHeight="16"
                  refX="13"
                  refY="8"
                  orient="auto"
                >
                  <path d="M2,2 L13,8 L2,14 Z" fill="#0b3a5c" />
                </marker>
              </defs>

              {startNode && startActivities.length > 0 && (
                <g key="project-start">
                  {startActivities.map((a, index) => {
                    const pos = positions[a.id];
                    if (!pos) return null;
                    const branch = startActivityBranchPath(startNode, pos);
                    return (
                      <path
                        key={`branch-${a.id}`}
                        className="pdm-edge-draw"
                        style={{ animationDelay: `${80 + index * 40}ms` }}
                        pathLength={1}
                        d={branch.d}
                        fill="none"
                        stroke="#0b3a5c"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        markerEnd="url(#arrow-structure)"
                      />
                    );
                  })}
                  <PdmStartNode x={startNode.x} y={startNode.y} />
                </g>
              )}

              {endNode && endActivities.length > 0 && (
                <g key="project-end">
                  {(() => {
                    const feeders = endActivities.flatMap((a) => {
                      const pos = positions[a.id];
                      if (!pos) return [];
                      const sameRow = endActivities
                        .map((x) => positions[x.id])
                        .filter(
                          (p): p is { x: number; y: number } =>
                            !!p && Math.abs(p.y - pos.y) < 8,
                        );
                      const branch = endActivityBranchPath(
                        pos,
                        endNode.busX,
                        sameRow,
                        PDM_NODE_HALF_W,
                        PDM_NODE_HALF_H,
                      );
                      return [{ id: a.id, ...branch }];
                    });

                    if (feeders.length === 0) return null;

                    const attachYs = feeders.map((f) => f.attachY);
                    const busY1 = Math.min(...attachYs);
                    const busY2 = Math.max(...attachYs);
                    const joinY = (busY1 + busY2) / 2;
                    const endJoin = roundedOrthoPath(
                      Math.abs(joinY - endNode.y) < 1
                        ? [
                            { x: endNode.busX, y: joinY },
                            { x: endNode.x - PDM_END_HALF_W, y: endNode.y },
                          ]
                        : [
                            { x: endNode.busX, y: joinY },
                            { x: endNode.busX + PDM_BUS_STUB, y: joinY },
                            { x: endNode.busX + PDM_BUS_STUB, y: endNode.y },
                            { x: endNode.x - PDM_END_HALF_W, y: endNode.y },
                          ],
                      8,
                    );

                    return (
                      <>
                        <line
                          className="pdm-edge-draw"
                          pathLength={1}
                          x1={endNode.busX}
                          y1={busY1}
                          x2={endNode.busX}
                          y2={busY2}
                          stroke="#0b3a5c"
                          strokeWidth={3}
                          strokeLinecap="round"
                        />
                        {feeders.map((f, index) => (
                          <path
                            key={`end-branch-${f.id}`}
                            className="pdm-edge-draw"
                            style={{ animationDelay: `${120 + index * 35}ms` }}
                            pathLength={1}
                            d={f.d}
                            fill="none"
                            stroke="#0b3a5c"
                            strokeWidth={3}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}
                        <path
                          className="pdm-edge-draw"
                          style={{ animationDelay: '220ms' }}
                          pathLength={1}
                          d={endJoin}
                          fill="none"
                          stroke="#0b3a5c"
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          markerEnd="url(#arrow-structure)"
                        />
                        <PdmEndNode x={endNode.x} y={endNode.y} />
                      </>
                    );
                  })()}
                </g>
              )}

              {(() => {
                const offsetsByDepId = new Map<
                  string,
                  { attachOffsetY: number; laneOffsetX: number; startOffsetY: number }
                >();
                const depsByTarget = new Map<string, typeof dependencies>();
                const depsBySource = new Map<string, typeof dependencies>();
                for (const dep of dependencies) {
                  const toList = depsByTarget.get(dep.toId) ?? [];
                  toList.push(dep);
                  depsByTarget.set(dep.toId, toList);
                  const fromList = depsBySource.get(dep.fromId) ?? [];
                  fromList.push(dep);
                  depsBySource.set(dep.fromId, fromList);
                }

                for (const [toId, deps] of depsByTarget) {
                  const to = positions[toId];
                  if (!to || deps.length <= 1) {
                    for (const dep of deps) {
                      const prev = offsetsByDepId.get(dep.id) ?? {
                        attachOffsetY: 0,
                        laneOffsetX: 0,
                        startOffsetY: 0,
                      };
                      offsetsByDepId.set(dep.id, { ...prev, attachOffsetY: 0, laneOffsetX: 0 });
                    }
                    continue;
                  }
                  const critical = deps.filter(
                    (dep) => mainChainIds.has(dep.fromId) && mainChainIds.has(dep.toId),
                  );
                  const others = deps
                    .filter((dep) => !critical.includes(dep))
                    .sort(
                      (a, b) =>
                        (positions[a.fromId]?.y ?? 0) - (positions[b.fromId]?.y ?? 0) ||
                        a.id.localeCompare(b.id),
                    );

                  if (critical.length === 1) {
                    const prev = offsetsByDepId.get(critical[0].id) ?? {
                      attachOffsetY: 0,
                      laneOffsetX: 0,
                      startOffsetY: 0,
                    };
                    offsetsByDepId.set(critical[0].id, { ...prev, attachOffsetY: 0, laneOffsetX: 0 });
                    others.forEach((dep, index) => {
                      const fromY = positions[dep.fromId]?.y ?? to.y;
                      const sign = fromY >= to.y ? 1 : -1;
                      const rank = index + 1;
                      const existing = offsetsByDepId.get(dep.id) ?? {
                        attachOffsetY: 0,
                        laneOffsetX: 0,
                        startOffsetY: 0,
                      };
                      offsetsByDepId.set(dep.id, {
                        ...existing,
                        attachOffsetY: sign * rank * 24,
                        laneOffsetX: sign * rank * 10,
                      });
                    });
                  } else {
                    const sorted = [...deps].sort(
                      (a, b) =>
                        (positions[a.fromId]?.y ?? 0) - (positions[b.fromId]?.y ?? 0) ||
                        a.id.localeCompare(b.id),
                    );
                    const lanes = dependencyLaneOffsets(sorted.length);
                    sorted.forEach((dep, index) => {
                      const lane = lanes[index] ?? { attachOffsetY: 0, laneOffsetX: 0 };
                      const existing = offsetsByDepId.get(dep.id) ?? {
                        attachOffsetY: 0,
                        laneOffsetX: 0,
                        startOffsetY: 0,
                      };
                      offsetsByDepId.set(dep.id, { ...existing, ...lane });
                    });
                  }
                }

                for (const [fromId, deps] of depsBySource) {
                  const from = positions[fromId];
                  if (!from || deps.length <= 1) {
                    for (const dep of deps) {
                      const prev = offsetsByDepId.get(dep.id) ?? {
                        attachOffsetY: 0,
                        laneOffsetX: 0,
                        startOffsetY: 0,
                      };
                      offsetsByDepId.set(dep.id, { ...prev, startOffsetY: 0 });
                    }
                    continue;
                  }
                  const critical = deps.filter(
                    (dep) => mainChainIds.has(dep.fromId) && mainChainIds.has(dep.toId),
                  );
                  const others = deps
                    .filter((dep) => !critical.includes(dep))
                    .sort(
                      (a, b) =>
                        (positions[a.toId]?.y ?? 0) - (positions[b.toId]?.y ?? 0) ||
                        a.id.localeCompare(b.id),
                    );

                  if (critical.length === 1) {
                    const prev = offsetsByDepId.get(critical[0].id) ?? {
                      attachOffsetY: 0,
                      laneOffsetX: 0,
                      startOffsetY: 0,
                    };
                    offsetsByDepId.set(critical[0].id, { ...prev, startOffsetY: 0 });
                    others.forEach((dep, index) => {
                      const toY = positions[dep.toId]?.y ?? from.y;
                      const sign = toY >= from.y ? 1 : -1;
                      const rank = index + 1;
                      const existing = offsetsByDepId.get(dep.id) ?? {
                        attachOffsetY: 0,
                        laneOffsetX: 0,
                        startOffsetY: 0,
                      };
                      offsetsByDepId.set(dep.id, {
                        ...existing,
                        startOffsetY: sign * rank * 20,
                      });
                    });
                  } else {
                    const sorted = [...deps].sort(
                      (a, b) =>
                        (positions[a.toId]?.y ?? 0) - (positions[b.toId]?.y ?? 0) ||
                        a.id.localeCompare(b.id),
                    );
                    const lanes = dependencyLaneOffsets(sorted.length, 20);
                    sorted.forEach((dep, index) => {
                      const existing = offsetsByDepId.get(dep.id) ?? {
                        attachOffsetY: 0,
                        laneOffsetX: 0,
                        startOffsetY: 0,
                      };
                      offsetsByDepId.set(dep.id, {
                        ...existing,
                        startOffsetY: lanes[index]?.attachOffsetY ?? 0,
                      });
                    });
                  }
                }

                const rendered = dependencies
                  .map((dep) => {
                    const fromAct = activities.find((a) => a.id === dep.fromId);
                    const toAct = activities.find((a) => a.id === dep.toId);
                    const from = positions[dep.fromId];
                    const to = positions[dep.toId];
                    if (!from || !to) return null;
                    const isCritical =
                      mainChainIds.has(dep.fromId) && mainChainIds.has(dep.toId);
                    const stroke = isCritical ? '#dc2626' : '#334155';
                    const lane = offsetsByDepId.get(dep.id) ?? {
                      attachOffsetY: 0,
                      laneOffsetX: 0,
                      startOffsetY: 0,
                    };
                    const edge = dependencyEdge(from, to, PDM_NODE_HALF_W, {
                      attachOffsetY: lane.attachOffsetY,
                      laneOffsetX: lane.laneOffsetX,
                      startOffsetY: lane.startOffsetY,
                      nodeHalfH: PDM_NODE_HALF_H,
                    });
                    const lagText = formatDependencyLag(dep.lag);
                    return {
                      dep,
                      fromAct,
                      toAct,
                      isCritical,
                      stroke,
                      edge,
                      lagText,
                    };
                  })
                  .filter((item): item is NonNullable<typeof item> => item != null);

                rendered.sort((a, b) => Number(a.isCritical) - Number(b.isCritical));

                return rendered.map(({ dep, fromAct, toAct, isCritical, stroke, edge, lagText }, index) => (
                  <g key={dep.id}>
                    <path
                      className={`pdm-edge-draw ${isCritical ? 'pdm-edge-critical' : ''}`}
                      style={{ animationDelay: `${160 + index * 45}ms` }}
                      pathLength={1}
                      d={edge.d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={isCritical ? 3.5 : 3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      markerEnd={isCritical ? 'url(#arrow-critical)' : 'url(#arrow)'}
                    >
                      <title>
                        {fromAct?.number ?? '?'} → {toAct?.number ?? '?'} ({dep.type}
                        {lagText || ', lag 0'})
                      </title>
                    </path>
                    <text
                      className="pdm-label-in fill-slate-700 text-[10px] font-bold"
                      x={edge.labelX}
                      y={edge.labelY}
                      textAnchor="middle"
                    >
                      {dep.type}
                      {lagText}
                    </text>
                  </g>
                ));
              })()}

              {activities.map((act, index) => {
                const pos = positions[act.id];
                if (!pos) return null;
                return (
                  <PdmNode
                    key={act.id}
                    activity={act}
                    x={pos.x}
                    y={pos.y}
                    onMainCriticalPath={mainChainIds.has(act.id)}
                    style={{ animationDelay: `${220 + index * 50}ms` }}
                  />
                );
              })}
            </svg>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-card/90 px-3 py-2.5 text-xs text-text-muted">
              <span className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-6 rounded bg-red-600" />
                Critical path
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-6 rounded bg-[#5a6b7d]" />
                Dependency
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-5 w-9 rounded border-2 border-primary bg-white" />
                Start / end
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-5 w-9 rounded border border-dashed border-[#6b7c72] bg-[#f8faf8]" />
                Until project end
              </span>
              <span className="text-[11px]">
                Arrows dock flush on node edges · same ES shares a column
              </span>
            </div>
            </div>
          </div>

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
    </main>
  );
}
