import { topologicalSort } from './pdm';
import type { PdmActivity, PdmDependency } from '../types';

/** Activity node half-width (must match PdmNode PDM_NODE_W / 2). */
const PDM_ACTIVITY_HALF_W = 64;

export const PDM_COL_W = 168;
export const PDM_ROW_H = 132;
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
export const PDM_BUS_STUB = 14;

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

  const slotInEsCol = new Map<number, number>();
  const map: Record<string, { x: number; y: number }> = {};

  [...core]
    .sort(
      (a, b) =>
        (a.es ?? 0) - (b.es ?? 0) ||
        a.number.localeCompare(b.number, undefined, { numeric: true }),
    )
    .forEach((a) => {
      const es = a.es ?? 0;
      const col = colByEs.get(es) ?? 0;
      const slot = slotInEsCol.get(es) ?? 0;
      slotInEsCol.set(es, slot + 1);
      map[a.id] = {
        x: pdmActivityColumnX(col),
        y: PDM_ORIGIN_Y + slot * PDM_ROW_H,
      };
    });

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
      d: `M ${x1} ${y} L ${busX} ${y}`,
      attachY: y,
    };
  }

  const laneY = y + nodeHalfH + 12;
  return {
    d: `M ${x1} ${y} L ${stubX} ${y} L ${stubX} ${laneY} L ${busX} ${laneY}`,
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
