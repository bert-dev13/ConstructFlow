import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from '../components/ProjectSelect';
import { DocumentsBackLink } from '../components/DocumentsBackLink';
import { getSchedule } from '../lib/scheduleApi';
import { DEPENDENCY_LABELS, activityIncomingLink, formatDependencyLag, getCriticalPath, isIndependentActivity } from '../lib/pdm';
import { dependencyEdge, diagramBounds, endActivityBranchPath, layoutPaperNetwork, layoutProjectEndNode, layoutProjectStartNode, PDM_BUS_STUB, PDM_END_HALF_W, PDM_START_HALF_W } from '../lib/pdmLayout';
import { PdmNode, PdmStartNode, PdmEndNode, PDM_NODE_HALF_H, PDM_NODE_HALF_W } from '../components/PdmNode';
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getSchedule(Number(projectId));
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

  const bounds = useMemo(
    () => diagramBounds(positions, PDM_NODE_HALF_W, PDM_NODE_HALF_H, startNode, endNode),
    [positions, startNode, endNode],
  );

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <DocumentsBackLink />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
            PDM Scheduling
          </span>
          <h1 className="mt-3 text-2xl font-bold text-text">Precedence Diagramming Method</h1>
          <p className="mt-2 max-w-3xl text-sm text-text-muted">
            Network diagram showing activity sequencing and dependencies. Each node shows{' '}
            <strong>ES / No. / EF</strong>, activity name, and <strong>LS / D / LF</strong> per the
            precedence diagram template.
          </p>
        </div>
        {user?.role === 'contractor' && (
          <div className="flex flex-wrap items-center gap-3">
            <ProjectSelect value={projectId} onChange={setProjectId} className="min-w-[200px]" />
            <Link
              to="/schedule"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Edit schedule
            </Link>
          </div>
        )}
        {user?.role !== 'contractor' && (
          <ProjectSelect value={projectId} onChange={setProjectId} className="min-w-[200px]" />
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-text-muted">Loading schedule…</p>
      ) : activities.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center shadow-sm">
          <p className="text-lg font-semibold text-text">No PDM schedule yet</p>
          <p className="mt-2 text-sm text-text-muted">
            All activities and dependencies were cleared. Send the new reference schedule to be loaded,
            or use <strong>Prepare Construction Schedule</strong> to enter activities manually.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs uppercase text-text-muted">Project Duration</p>
              <p className="text-2xl font-bold text-text">{projectDuration} days</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs uppercase text-text-muted">Critical Activities</p>
              <p className="text-2xl font-bold text-red-600">{criticalNumbers || '—'}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs uppercase text-text-muted">Dependencies</p>
              <p className="text-sm text-text-muted">
                {[...new Set(dependencies.map((d) => d.type))].join(', ') || '—'}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card p-6 shadow-sm">
            <svg
              viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
              className="min-h-[280px]"
              style={{ width: Math.max(bounds.w, 640), height: Math.max(bounds.h, 280) }}
              preserveAspectRatio="xMinYMin meet"
            >

              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6" fill="#9ca89f" />
                </marker>
                <marker id="arrow-critical" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6" fill="#dc2626" />
                </marker>
              </defs>

              {startNode && startActivities.length > 0 && (
                <g key="project-start">
                  {startActivities.map((a) => {
                    const pos = positions[a.id];
                    if (!pos) return null;
                    const x1 = startNode.x + PDM_START_HALF_W;
                    const y1 = startNode.y;
                    const x2 = pos.x - PDM_NODE_HALF_W;
                    const y2 = pos.y;
                    return (
                      <path
                        key={`branch-${a.id}`}
                        d={
                          Math.abs(y1 - y2) < 8
                            ? `M ${x1} ${y1} L ${x2} ${y2}`
                            : `M ${x1} ${y1} L ${x1 + PDM_BUS_STUB} ${y1} L ${x1 + PDM_BUS_STUB} ${y2} L ${x2} ${y2}`
                        }
                        fill="none"
                        stroke="#2c2c2a"
                        strokeWidth={1.75}
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

                    return (
                      <>
                        <line
                          x1={endNode.busX}
                          y1={busY1}
                          x2={endNode.busX}
                          y2={busY2}
                          stroke="#2c2c2a"
                          strokeWidth={2.5}
                        />
                        {feeders.map((f) => (
                          <path
                            key={`end-branch-${f.id}`}
                            d={f.d}
                            fill="none"
                            stroke="#2c2c2a"
                            strokeWidth={1.75}
                          />
                        ))}
                        <path
                          d={
                            Math.abs(joinY - endNode.y) < 1
                              ? `M ${endNode.busX} ${joinY} L ${endNode.x - PDM_END_HALF_W} ${endNode.y}`
                              : `M ${endNode.busX} ${joinY} L ${endNode.busX + PDM_BUS_STUB} ${joinY} L ${endNode.busX + PDM_BUS_STUB} ${endNode.y} L ${endNode.x - PDM_END_HALF_W} ${endNode.y}`
                          }
                          fill="none"
                          stroke="#2c2c2a"
                          strokeWidth={1.75}
                        />
                        <PdmEndNode x={endNode.x} y={endNode.y} />
                      </>
                    );
                  })()}
                </g>
              )}

              {dependencies.map((dep) => {
                const fromAct = activities.find((a) => a.id === dep.fromId);
                const toAct = activities.find((a) => a.id === dep.toId);
                const from = positions[dep.fromId];
                const to = positions[dep.toId];
                if (!from || !to) return null;
                const isCritical =
                  mainChainIds.has(dep.fromId) && mainChainIds.has(dep.toId);
                const stroke = isCritical ? '#dc2626' : '#9ca89f';
                const edge = dependencyEdge(
                  from,
                  to,
                  PDM_NODE_HALF_W,
                  Object.values(positions),
                  PDM_NODE_HALF_H,
                );
                const lagText = formatDependencyLag(dep.lag);
                return (
                  <g key={dep.id}>
                    <path
                      d={edge.d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={isCritical ? 3 : 1.5}
                      markerEnd={isCritical ? 'url(#arrow-critical)' : 'url(#arrow)'}
                    >
                      <title>
                        {fromAct?.number ?? '?'} → {toAct?.number ?? '?'} ({dep.type}
                        {lagText || ', lag 0'})
                      </title>
                    </path>
                    {lagText ? (
                      <text
                        x={(from.x + to.x) / 2}
                        y={(from.y + to.y) / 2 - 8}
                        textAnchor="middle"
                        className="fill-text-muted text-[9px] font-semibold"
                      >
                        {dep.type}
                        {lagText}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {activities.map((act) => {
                const pos = positions[act.id];
                if (!pos) return null;
                return (
                  <PdmNode
                    key={act.id}
                    activity={act}
                    x={pos.x}
                    y={pos.y}
                    onMainCriticalPath={mainChainIds.has(act.id)}
                  />
                );
              })}
            </svg>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-text-muted">
              <span className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-6 bg-red-600" />
                Critical path (LF−EF = 0 and LS−ES = 0)
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-6 bg-[#9ca89f]" />
                Non-critical dependency
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-6 w-10 rounded border-2 border-text bg-white" />
                Project start / end (day 0 / finish)
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-6 w-0.5 border-l-2 border-dashed border-text" />
                Same ES = same column (stacked vertically)
              </span>
              <span>
                Diagram arrows are only from Dependencies (no auto links). Lines to{' '}
                <em>end</em> are for activities with no successor — not a link between those activities.
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-6 w-10 rounded border border-dashed border-[#6b7c72] bg-[#f8faf8]" />
                Until project end (branch: Predecessor → Activity → End)
              </span>
            </div>
          </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <h3 className="font-semibold text-text">Node legend</h3>
                  <ul className="mt-3 space-y-2 text-sm text-text-muted">
                    <li><strong className="text-text">D</strong> — Duration</li>
                    <li><strong className="text-text">ES</strong> — Early Start</li>
                    <li><strong className="text-text">EF</strong> — Early Finish</li>
                    <li><strong className="text-text">LS</strong> — Latest Start</li>
                    <li><strong className="text-text">LF</strong> — Latest Finish</li>
                    <li>
                      <strong className="text-text">Total float</strong> — LS − ES (same as LF − EF).
                      Float = 0 is critical
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <h3 className="font-semibold text-text">Dependency types</h3>
                  <ul className="mt-3 space-y-2 text-sm text-text-muted">
                    {Object.entries(DEPENDENCY_LABELS).map(([key, label]) => (
                      <li key={key}>
                        <strong className="text-text">{key}</strong> — {label}
                      </li>
                    ))}
                    <li>
                      Lag defaults to 0. A lead is a negative lag. Multiple predecessors use the
                      latest required date.
                    </li>
                  </ul>
                </div>
              </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-text">Activity Schedule Table</h3>
              <div className="mt-3 max-h-none overflow-x-auto">
              <table className="data-table w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-text-muted">
                    <th className="py-2">No.</th>
                    <th>Activity</th>
                    <th>D</th>
                    <th>ES</th>
                    <th>EF</th>
                    <th>Type</th>
                    <th>TO</th>
                    <th>LS</th>
                    <th>LF</th>
                    <th>LF−EF</th>
                    <th>LS−ES</th>
                    <th>Critical</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => {
                    const floatEf = (a.lf ?? 0) - (a.ef ?? 0);
                    const floatEs = (a.ls ?? 0) - (a.es ?? 0);
                    const link = activityIncomingLink(a.id, activities, dependencies);
                    return (
                    <tr
                      key={a.id}
                      className={`border-b border-border/50 ${a.isCritical ? 'bg-red-50' : ''}`}
                    >
                      <td className="py-2 font-medium">{a.number}</td>
                      <td>{a.name}</td>
                      <td>{a.duration}</td>
                      <td>{a.es == null ? '—' : a.es}</td>
                      <td>{a.ef}</td>
                      <td>
                        {link.type}
                        {link.type !== 'Independent' ? formatDependencyLag(link.lag) : ''}
                      </td>
                      <td>{link.to}</td>
                      <td>{a.ls == null ? '—' : a.ls}</td>
                      <td>{a.lf}</td>
                      <td>{floatEf}</td>
                      <td>{floatEs}</td>
                      <td className={a.isCritical ? 'font-semibold text-red-600' : ''}>
                        {a.isCritical ? 'Yes' : '—'}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
