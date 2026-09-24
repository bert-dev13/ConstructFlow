import { topologicalSort } from './pdm';
import type { PdmActivity, PdmDependency } from '../types';

/** Activity node half-width (must match PdmNode PDM_NODE_W / 2). */
const PDM_ACTIVITY_HALF_W = 64;

export const PDM_COL_W = 184;
export const PDM_ROW_H = 144;
export const PDM_ORIGIN_X = 160;
export const PDM_ORIGIN_Y = 110;
export const PDM_START_NODE_W = 72;
export const PDM_START_NODE_H = 48;
export const PDM_START_HALF_W = PDM_START_NODE_W / 2;
export const PDM_START_HALF_H = PDM_START_NODE_H / 2;
export const PDM_END_NODE_W = PDM_START_NODE_W;
export const PDM_END_NODE_H = PDM_START_NODE_H;
export const PDM_END_HALF_W = PDM_START_HALF_W;
export const PDM_END_HALF_H = PDM_START_HALF_H;
export const PDM_BUS_STUB = 16;
/** Marker tip sits on the node edge; keep last segment long enough for clean orientation. */
export const PDM_ARROW_INSET = 0;

/**
 * Orthogonal polyline with rounded elbows so arrow approaches stay horizontal
 * into the successor and leave horizontally from the predecessor.
 */
export function roundedOrthoPath(
  points: Array<{ x: number; y: number }>,
  radius = 10,
): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    const r = Math.min(radius, len1 / 2, len2 / 2);

    if (r < 0.75 || len1 < 1 || len2 < 1) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const x1 = curr.x - (dx1 / len1) * r;
    const y1 = curr.y - (dy1 / len1) * r;
    const x2 = curr.x + (dx2 / len2) * r;
    const y2 = curr.y + (dy2 / len2) * r;
    d += ` L ${x1} ${y1} Q ${curr.x} ${curr.y} ${x2} ${y2}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Elbow from predecessor → successor.
 * Always finishes with a horizontal approach into the left edge of the target
 * so arrowheads stay level and dock flush against the node.
 */
export function dependencyEdge(
  from: { x: number; y: number },
  to: { x: number; y: number },
  nodeHalfW: number = PDM_ACTIVITY_HALF_W,
  options?: {
    attachOffsetY?: number;
    laneOffsetX?: number;
    startOffsetY?: number;
    nodeHalfH?: number;
    cornerRadius?: number;
  },
): { d: string; endX: number; endY: number; labelX: number; labelY: number } {
  const attachOffsetY = options?.attachOffsetY ?? 0;
  const laneOffsetX = options?.laneOffsetX ?? 0;
  const startOffsetY = options?.startOffsetY ?? 0;
  const nodeHalfH = options?.nodeHalfH ?? 48;
  const cornerRadius = options?.cornerRadius ?? 10;
  const maxAttach = Math.max(8, nodeHalfH - 16);
  const yAttach = to.y + Math.max(-maxAttach, Math.min(maxAttach, attachOffsetY));
  const yStart = from.y + Math.max(-maxAttach, Math.min(maxAttach, startOffsetY));

  const x1 = from.x + nodeHalfW;
  const y1 = yStart;
  // Dock exactly on the left edge so the marker tip sits flush.
  const x2 = to.x - nodeHalfW - PDM_ARROW_INSET;
  const y2 = yAttach;
  const sameRow = Math.abs(from.y - to.y) < 8;
  const gap = x2 - x1;

  let points: Array<{ x: number; y: number }>;

  if (sameRow && gap > 24) {
    if (Math.abs(y1 - y2) < 0.5) {
      points = [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ];
    } else {
      // Keep the vertical jog near the target, with enough final horizontal run
      // for the arrowhead to orient correctly.
      const turnX = Math.max(x1 + 20, x2 - Math.max(22, Math.min(36, gap * 0.28)));
      points = [
        { x: x1, y: y1 },
        { x: turnX, y: y1 },
        { x: turnX, y: y2 },
        { x: x2, y: y2 },
      ];
    }
  } else if (gap > 40) {
    // Place the vertical corridor in the open column gap, then approach horizontally.
    const midX = x1 + Math.max(28, Math.min(gap * 0.42, gap - 28)) + laneOffsetX;
    points = [
      { x: x1, y: y1 },
      { x: midX, y: y1 },
      { x: midX, y: y2 },
      { x: x2, y: y2 },
    ];
  } else {
    // Tight / reverse gaps: short outbound stub, then vertical, then into target.
    const stub = Math.max(14, Math.min(22, Math.abs(gap) * 0.35 || 14));
    const midX = (gap > 0 ? x1 + stub : x1 + stub) + laneOffsetX;
    points = [
      { x: x1, y: y1 },
      { x: midX, y: y1 },
      { x: midX, y: y2 },
      { x: x2, y: y2 },
    ];
  }

  const labelX = (points[0].x + points[points.length - 1].x) / 2;
  const labelY =
    points.length >= 3
      ? (points[1].y + points[points.length - 2].y) / 2
      : (y1 + y2) / 2;

  return {
    d: roundedOrthoPath(points, cornerRadius),
    endX: x2,
    endY: y2,
    labelX,
    labelY: labelY - 10,
  };
}

/** Branch from project start into a first-column activity. */
export function startActivityBranchPath(
  start: { x: number; y: number },
  activity: { x: number; y: number },
  startHalfW: number = PDM_START_HALF_W,
  nodeHalfW: number = PDM_ACTIVITY_HALF_W,
): { d: string; endX: number; endY: number } {
  const x1 = start.x + startHalfW;
  const y1 = start.y;
  const x2 = activity.x - nodeHalfW;
  const y2 = activity.y;
  const points =
    Math.abs(y1 - y2) < 1
      ? [
          { x: x1, y: y1 },
          { x: x2, y: y2 },
        ]
      : [
          { x: x1, y: y1 },
          { x: x1 + PDM_BUS_STUB, y: y1 },
          { x: x1 + PDM_BUS_STUB, y: y2 },
          { x: x2, y: y2 },
        ];
  return {
    d: roundedOrthoPath(points, 8),
    endX: x2,
    endY: y2,
  };
}

/** Spread incoming dependency lanes so edges do not share one attach point. */
export function dependencyLaneOffsets(
  count: number,
  spacing = 28,
): { attachOffsetY: number; laneOffsetX: number }[] {
  if (count <= 1) return [{ attachOffsetY: 0, laneOffsetX: 0 }];
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const slot = index - mid;
    return {
      attachOffsetY: slot * spacing,
      laneOffsetX: slot * 12,
    };
  });
}

/** Column x — index 0 is first ES column after the Start node. */
export function pdmActivityColumnX(depth: number): number {
  return PDM_ORIGIN_X + PDM_COL_W + depth * PDM_COL_W;
}

/**
 * PDM layout: one column per Early Start (ES), stacked vertically in that column.
 * Activities marked extendToEnd are placed as side branches near their predecessor
 * (Predecessor → Activity → End). Branch order follows activity letter — visual only.
 */
export function layoutPaperNetwork(
  activities: PdmActivity[],
  dependencies: PdmDependency[],
): Record<string, { x: number; y: number }> {
  if (!topologicalSort(activities, dependencies)) return {};

  const core = activities.filter((a) => !a.extendToEnd);
  const extending = activities.filter((a) => a.extendToEnd);

  const uniqueEs = [...new Set(activities.map((a) => a.es ?? 0))].sort((a, b) => a - b);
  const colByEs = new Map(uniqueEs.map((es, index) => [es, index]));
  const map: Record<string, { x: number; y: number }> = {};
  const incomingById = new Map<string, PdmDependency[]>();
  for (const dep of dependencies) {
    if (!incomingById.has(dep.toId)) incomingById.set(dep.toId, []);
    incomingById.get(dep.toId)!.push(dep);
  }

  const usedSlotsByEs = new Map<number, Set<number>>();

  function claimSlot(es: number, preferredSlot: number) {
    const used = usedSlotsByEs.get(es) ?? new Set<number>();
    usedSlotsByEs.set(es, used);
    if (!used.has(preferredSlot)) {
      used.add(preferredSlot);
      return preferredSlot;
    }
    for (let distance = 1; distance < 64; distance += 1) {
      const below = preferredSlot + distance;
      if (!used.has(below)) {
        used.add(below);
        return below;
      }
      const above = Math.max(0, preferredSlot - distance);
      if (!used.has(above)) {
        used.add(above);
        return above;
      }
    }
    const fallback = used.size;
    used.add(fallback);
    return fallback;
  }

    for (const es of uniqueEs) {
    const col = colByEs.get(es) ?? 0;
    const group = core
      .filter((activity) => (activity.es ?? 0) === es)
      .map((activity, index) => {
        const incoming = incomingById.get(activity.id) ?? [];
        let idealY = PDM_ORIGIN_Y + index * PDM_ROW_H;
        if (incoming.length > 0) {
          // With multiple predecessors, center the box on the average predecessor Y
          // so feeders align cleanly around the activity (REVISIONS visual rule).
          const predYs: number[] = [];
          for (const dep of incoming) {
            const predPos = map[dep.fromId];
            if (predPos) predYs.push(predPos.y);
          }
          if (predYs.length === 1) {
            idealY = predYs[0]!;
          } else if (predYs.length > 1) {
            idealY = predYs.reduce((sum, y) => sum + y, 0) / predYs.length;
          }
        }
        return { activity, idealY };
      })
      .sort(
        (a, b) =>
          a.idealY - b.idealY ||
          a.activity.number.localeCompare(b.activity.number, undefined, { numeric: true }),
      );

    for (const { activity, idealY } of group) {
      const preferredSlot = Math.max(0, Math.round((idealY - PDM_ORIGIN_Y) / PDM_ROW_H));
      const slot = claimSlot(es, preferredSlot);
      map[activity.id] = {
        x: pdmActivityColumnX(col),
        y: PDM_ORIGIN_Y + slot * PDM_ROW_H,
      };
    }
  }

  // Driving predecessor for branch placement.
  const drivingPred = new Map<string, string>();
  for (const a of extending) {
    const incoming = dependencies.filter((d) => d.toId === a.id);
    if (incoming.length === 0) continue;
    let bestId = incoming[0].fromId;
    let bestEf = -Infinity;
    for (const dep of incoming) {
      const pred = activities.find((x) => x.id === dep.fromId);
      const ef = pred?.ef ?? 0;
      if (ef >= bestEf) {
        bestEf = ef;
        bestId = dep.fromId;
      }
    }
    drivingPred.set(a.id, bestId);
  }

  // Group extending activities by predecessor; sort by label within each group.
  const byPred = new Map<string, PdmActivity[]>();
  const noPred: PdmActivity[] = [];
  for (const a of extending) {
    const pid = drivingPred.get(a.id);
    if (!pid) {
      noPred.push(a);
      continue;
    }
    if (!byPred.has(pid)) byPred.set(pid, []);
    byPred.get(pid)!.push(a);
  }
  for (const group of byPred.values()) {
    group.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  }
  noPred.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  const occupied = new Set(
    Object.values(map).map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`),
  );

  function placeBranch(a: PdmActivity, preferredY: number) {
    const es = a.es ?? 0;
    const col = colByEs.get(es) ?? 0;
    const x = pdmActivityColumnX(col);
    let y = preferredY;
    let guard = 0;
    while (occupied.has(`${Math.round(x)}:${Math.round(y)}`) && guard < 40) {
      y += PDM_ROW_H;
      guard += 1;
    }
    occupied.add(`${Math.round(x)}:${Math.round(y)}`);
    map[a.id] = { x, y };
  }

  for (const [predId, group] of byPred) {
    const predPos = map[predId];
    const baseY = predPos?.y ?? PDM_ORIGIN_Y;
    group.forEach((a, index) => {
      // Alternate below / above predecessor by letter index — visual only.
      const offset =
        index % 2 === 0
          ? PDM_ROW_H * (1 + Math.floor(index / 2))
          : -PDM_ROW_H * (1 + Math.floor(index / 2));
      placeBranch(a, baseY + offset);
    });
  }

  noPred.forEach((a, index) => {
    placeBranch(a, PDM_ORIGIN_Y + (index + 1) * PDM_ROW_H);
  });

  return map;
}

/** Center the Start box on the first-line activities (no predecessors). */
export function layoutProjectStartNode(
  startActivities: PdmActivity[],
  positions: Record<string, { x: number; y: number }>,
): { x: number; y: number } | null {
  const ys = startActivities
    .map((a) => positions[a.id]?.y)
    .filter((y): y is number => y != null);
  if (ys.length === 0) return null;
  return {
    x: PDM_ORIGIN_X,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** End bus + box — mirror of project start (activities → vertical spine → end). */
export function layoutProjectEndNode(
  endActivities: PdmActivity[],
  positions: Record<string, { x: number; y: number }>,
): { x: number; y: number; busX: number; busY1: number; busY2: number } | null {
  const ys = endActivities
    .map((a) => positions[a.id]?.y)
    .filter((y): y is number => y != null);
  const xs = endActivities
    .map((a) => positions[a.id]?.x)
    .filter((x): x is number => x != null);
  if (ys.length === 0 || xs.length === 0) return null;

  const busX = Math.max(...xs) + PDM_ACTIVITY_HALF_W + PDM_BUS_STUB * 2;
  const busY1 = Math.min(...ys);
  const busY2 = Math.max(...ys);
  // Keep end box aligned with the critical-path / top row when possible.
  const topY = busY1;
  const centerY = ys.length === 1 ? busY1 : (busY1 + busY2) / 2;

  return {
    busX,
    busY1,
    busY2: Math.max(busY2, topY),
    x: busX + PDM_BUS_STUB + PDM_END_HALF_W,
    y: centerY,
  };
}

/**
 * Path from a terminal activity to the end bus.
 * Always joins the vertical bus (never skips to the end box) so the spine stays continuous.
 * When several terminals share a row, non-rightmost feeders drop to a lower lane
 * so they do not look like activity→activity links.
 */
export function endActivityBranchPath(
  pos: { x: number; y: number },
  busX: number,
  sameRowPositions: { x: number; y: number }[],
  nodeHalfW: number,
  nodeHalfH: number,
): { d: string; attachY: number } {
  const x1 = pos.x + nodeHalfW;
  const y = pos.y;
  const stubX = x1 + PDM_BUS_STUB;
  const rightmostX = Math.max(...sameRowPositions.map((p) => p.x));
  const isRightmost = pos.x >= rightmostX - 0.5;
  const aloneOnRow = sameRowPositions.length <= 1;

  if (isRightmost || aloneOnRow) {
    return {
      d: roundedOrthoPath(
        [
          { x: x1, y },
          { x: busX, y },
        ],
        8,
      ),
      attachY: y,
    };
  }

  const laneY = y + nodeHalfH + 12;
  return {
    d: roundedOrthoPath(
      [
        { x: x1, y },
        { x: stubX, y },
        { x: stubX, y: laneY },
        { x: busX, y: laneY },
      ],
      8,
    ),
    attachY: laneY,
  };
}

export function diagramBounds(
  positions: Record<string, { x: number; y: number }>,
  nodeHalfW: number,
  nodeHalfH: number,
  startNode?: { x: number; y: number } | null,
  endNode?: { x: number; y: number } | null,
) {
  const pad = 72;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  Object.values(positions).forEach((p) => {
    minX = Math.min(minX, p.x - nodeHalfW);
    maxX = Math.max(maxX, p.x + nodeHalfW);
    minY = Math.min(minY, p.y - nodeHalfH);
    maxY = Math.max(maxY, p.y + nodeHalfH);
  });
  if (startNode) {
    minX = Math.min(minX, startNode.x - PDM_START_HALF_W);
    maxX = Math.max(maxX, startNode.x + PDM_START_HALF_W);
    minY = Math.min(minY, startNode.y - PDM_START_HALF_H);
    maxY = Math.max(maxY, startNode.y + PDM_START_HALF_H);
  }
  if (endNode) {
    minX = Math.min(minX, endNode.x - PDM_END_HALF_W);
    maxX = Math.max(maxX, endNode.x + PDM_END_HALF_W);
    minY = Math.min(minY, endNode.y - PDM_END_HALF_H);
    maxY = Math.max(maxY, endNode.y + PDM_END_HALF_H);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, w: 560, h: 360 };
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}
