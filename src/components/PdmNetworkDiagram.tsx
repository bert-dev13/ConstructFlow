'use client';

import { useMemo } from 'react';
import { formatDependencyLag, getCriticalPath, isIndependentActivity } from '../lib/pdm';
import {
  dependencyEdge,
  dependencyLaneOffsets,
  diagramBounds,
  endActivityBranchPath,
  layoutPaperNetwork,
  layoutProjectEndNode,
  layoutProjectStartNode,
  PDM_BUS_STUB,
  PDM_END_HALF_W,
  roundedOrthoPath,
  startActivityBranchPath,
} from '../lib/pdmLayout';
import {
  PdmNode,
  PdmStartNode,
  PdmEndNode,
  PDM_NODE_HALF_H,
  PDM_NODE_HALF_W,
} from './PdmNode';
import type { PdmActivity, PdmDependency } from '../types';

export type PdmNetworkDiagramProps = {
  activities: PdmActivity[];
  dependencies: PdmDependency[];
  panelId?: string;
  compact?: boolean;
};

export function PdmNetworkDiagram({
  activities,
  dependencies,
  panelId = 'pdm-diagram-panel',
  compact = false,
}: PdmNetworkDiagramProps) {
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

  const bounds = useMemo(
    () => diagramBounds(positions, PDM_NODE_HALF_W, PDM_NODE_HALF_H, startNode, endNode),
    [positions, startNode, endNode],
  );

  const criticalActivityCount = activities.filter((activity) => activity.isCritical).length;

  const arrowMarkerId = `arrow-${panelId}`;
  const arrowCriticalMarkerId = `arrow-critical-${panelId}`;
  const arrowStructureMarkerId = `arrow-structure-${panelId}`;

  return (
    <div
      id={panelId}
      className="schedule-panel-in overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm"
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b border-border/70 ${
          compact ? 'px-3 py-2.5' : 'px-5 py-4'
        }`}
      >
        <div>
          <h2 className={`font-semibold text-text ${compact ? 'text-sm' : 'text-lg'}`}>
            Network diagram
          </h2>
          {!compact ? (
            <p className="mt-1 text-sm text-text-muted">
              Activity flow with rounded elbows and flush arrow docking.
            </p>
          ) : null}
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
              id={arrowMarkerId}
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
              id={arrowCriticalMarkerId}
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
              id={arrowStructureMarkerId}
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
                    markerEnd={`url(#${arrowStructureMarkerId})`}
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
                      markerEnd={`url(#${arrowStructureMarkerId})`}
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

            const placedLabels: Array<{ x: number; y: number }> = [];
            const withLabels = rendered.map((item) => {
              let labelX = item.edge.labelX;
              let labelY = item.edge.labelY;
              for (let attempt = 0; attempt < 8; attempt += 1) {
                const clash = placedLabels.some(
                  (p) => Math.abs(p.x - labelX) < 36 && Math.abs(p.y - labelY) < 14,
                );
                if (!clash) break;
                labelY += attempt % 2 === 0 ? -14 : 14;
              }
              placedLabels.push({ x: labelX, y: labelY });
              const label = `${item.dep.type}${item.lagText}`;
              const labelW = Math.max(28, label.length * 6.2 + 10);
              return { ...item, labelX, labelY, label, labelW };
            });

            return withLabels.map(
              (
                { dep, fromAct, toAct, isCritical, stroke, edge, lagText, labelX, labelY, label, labelW },
                index,
              ) => (
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
                    markerEnd={
                      isCritical
                        ? `url(#${arrowCriticalMarkerId})`
                        : `url(#${arrowMarkerId})`
                    }
                  >
                    <title>
                      {fromAct?.number ?? '?'} → {toAct?.number ?? '?'} ({dep.type}
                      {lagText || ', lag 0'})
                    </title>
                  </path>
                  <rect
                    x={labelX - labelW / 2}
                    y={labelY - 7}
                    width={labelW}
                    height={14}
                    rx={3}
                    fill="rgba(255,255,255,0.92)"
                    stroke="rgba(148,163,184,0.45)"
                    strokeWidth={0.75}
                  />
                  <text
                    className="pdm-label-in"
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#334155"
                    fontSize={9}
                    fontWeight={700}
                    fontFamily="system-ui, sans-serif"
                  >
                    {label}
                  </text>
                </g>
              ),
            );
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
  );
}
