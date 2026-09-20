import type { DependencyType, PdmActivity, PdmDependency } from '../types';

function normalizeRootEsOverride(
  esOverride: number | null | undefined,
  hasPredecessors: boolean,
): number | null | undefined {
  if (esOverride == null) return esOverride;
  // Legacy 1-based "day 1 = first day" stored as es_override = 1 — only for root activities.
  if (!hasPredecessors && esOverride === 1) return 0;
  return esOverride;
}

/** Lag days; a lead is stored as negative lag. */
function lagOf(dep: PdmDependency): number {
  return dep.lag ?? 0;
}

/**
 * Required successor ES from one predecessor relationship (forward pass).
 * FS/SS constrain ES; FF/SF constrain EF first, then ES = EF − Duration.
 */
function requiredSuccessorEs(
  type: DependencyType | string | undefined,
  predEs: number,
  predEf: number,
  successorDuration: number,
  lag: number,
): number {
  switch (type) {
    case 'SS':
      return predEs + lag;
    case 'FF':
      return predEf + lag - successorDuration;
    case 'SF':
      return predEs + lag - successorDuration;
    case 'FS':
    default:
      return predEf + lag;
  }
}

/**
 * Required predecessor LS from one successor relationship (backward pass).
 * FS/FF constrain LF first, then LS = LF − Duration.
 * SS/SF constrain LS first, then LF = LS + Duration.
 */
function requiredPredecessorLs(
  type: DependencyType | string | undefined,
  succLs: number,
  succLf: number,
  predecessorDuration: number,
  lag: number,
): number {
  switch (type) {
    case 'SS':
      return succLs - lag;
    case 'FF':
      return succLf - lag - predecessorDuration;
    case 'SF':
      return succLf - lag;
    case 'FS':
    default:
      return succLs - lag - predecessorDuration;
  }
}

/**
 * Forward/backward pass for PDM scheduling (Day 0 baseline).
 * Supports FS, SS, FF, SF with optional lag (lead = negative lag).
 * Activities with extendToEnd stretch from their ES to project completion
 * (project end is driven by non-extending activities only).
 */
export function calculatePdmSchedule(
  activities: PdmActivity[],
  dependencies: PdmDependency[],
): PdmActivity[] {
  const map = new Map(
    activities.map((a) => [
      a.id,
      {
        ...a,
        // Placeholder duration for first pass — extend activities do not drive project end.
        duration: a.extendToEnd ? 1 : Math.max(1, a.duration),
      },
    ]),
  );
  const preds = new Map<string, PdmDependency[]>();
  const succs = new Map<string, PdmDependency[]>();

  for (const dep of dependencies) {
    if (!preds.has(dep.toId)) preds.set(dep.toId, []);
    if (!succs.has(dep.fromId)) succs.set(dep.fromId, []);
    preds.get(dep.toId)!.push(dep);
    succs.get(dep.fromId)!.push(dep);
  }

  const topo = topologicalSort(activities, dependencies);
  if (!topo) return activities;

  for (const id of topo) {
    const act = map.get(id)!;
    const incoming = preds.get(id) ?? [];
    if (incoming.length === 0) {
      act.es = 0;
    } else {
      act.es = Math.max(
        ...incoming.map((dep) => {
          const pred = map.get(dep.fromId)!;
          return requiredSuccessorEs(
            dep.type,
            pred.es ?? 0,
            pred.ef ?? 0,
            act.duration,
            lagOf(dep),
          );
        }),
      );
    }

    // Early Start (ES) override:
    // - No predecessor: use the typed day (0 = project start).
    // - Has predecessor: cannot start earlier than the formula; typed day may delay start (max).
    const override = normalizeRootEsOverride(act.esOverride, incoming.length > 0);
    if (override != null && override >= 0) {
      act.es = incoming.length === 0 ? override : Math.max(act.es ?? 0, override);
    }

    act.ef = act.es + act.duration;
  }

  // Project end from the main schedule only (activities that do not extend to end).
  const coreEnds = [...map.values()]
    .filter((a) => !a.extendToEnd)
    .map((a) => a.ef ?? 0);
  let projectEnd =
    coreEnds.length > 0
      ? Math.max(...coreEnds)
      : Math.max(...[...map.values()].map((a) => a.ef ?? 0), 0);

  for (const act of map.values()) {
    if (!act.extendToEnd) continue;
    const es = act.es ?? 0;
    act.duration = Math.max(1, projectEnd - es);
    act.ef = es + act.duration;
  }

  // If somehow only extending activities exist, keep a consistent project end.
  projectEnd = Math.max(projectEnd, ...[...map.values()].map((a) => a.ef ?? 0));

  for (const id of [...topo].reverse()) {
    const act = map.get(id)!;
    const outgoing = succs.get(id) ?? [];
    if (outgoing.length === 0) {
      act.lf = projectEnd;
      act.ls = projectEnd - act.duration;
    } else {
      act.ls = Math.min(
        ...outgoing.map((dep) => {
          const succ = map.get(dep.toId)!;
          return requiredPredecessorLs(
            dep.type,
            succ.ls ?? projectEnd,
            succ.lf ?? projectEnd,
            act.duration,
            lagOf(dep),
          );
        }),
      );
      act.lf = act.ls + act.duration;
    }
    // Critical when total float is zero: (LF − EF) = 0 and (LS − ES) = 0.
    const es = act.es ?? 0;
    const ef = act.ef ?? 0;
    const ls = act.ls ?? 0;
    const lf = act.lf ?? 0;
    // Extending-to-end branches are visualization of float fill — not on the critical path.
    act.isCritical = !act.extendToEnd && lf - ef === 0 && ls - es === 0;
  }

  normalizeScheduleOriginToZero(map);
  return [...map.values()];
}

/** Project start is always day 0 — shift if the whole network begins on day 1+ (legacy data). */
function normalizeScheduleOriginToZero(map: Map<string, PdmActivity>): void {
  const values = [...map.values()];
  if (values.length === 0) return;
  const minEs = Math.min(...values.map((a) => a.es ?? 0));
  if (minEs <= 0) return;
  for (const act of values) {
    act.es = (act.es ?? 0) - minEs;
    act.ef = (act.ef ?? 0) - minEs;
    act.ls = (act.ls ?? 0) - minEs;
    act.lf = (act.lf ?? 0) - minEs;
  }
}

export function topologicalSort(
  activities: PdmActivity[],
  dependencies: PdmDependency[],
): string[] | null {
  const inDegree = new Map(activities.map((a) => [a.id, 0]));
  const adj = new Map<string, string[]>();

  for (const a of activities) adj.set(a.id, []);
  for (const dep of dependencies) {
    adj.get(dep.fromId)?.push(dep.toId);
    inDegree.set(dep.toId, (inDegree.get(dep.toId) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const result: string[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  return result.length === activities.length ? result : null;
}

export function getCriticalPath(
  activities: PdmActivity[],
  dependencies: PdmDependency[] = [],
): PdmActivity[] {
  const projectEnd = Math.max(...activities.map((a) => a.ef ?? 0), 0);
  const byId = new Map(activities.map((a) => [a.id, a]));
  const preds = new Map<string, PdmDependency[]>();
  for (const dep of dependencies) {
    if (!preds.has(dep.toId)) preds.set(dep.toId, []);
    preds.get(dep.toId)!.push(dep);
  }

  const terminals = activities.filter(
    (a) => a.isCritical && (a.ef ?? 0) === projectEnd,
  );
  if (terminals.length === 0) {
    return activities.filter((a) => a.isCritical).sort((a, b) => (a.es ?? 0) - (b.es ?? 0));
  }

  let bestIds: string[] = [];
  for (const terminal of terminals) {
    const chain: string[] = [];
    let id = terminal.id;
    while (true) {
      chain.push(id);
      const criticalPreds = (preds.get(id) ?? []).filter((dep) => byId.get(dep.fromId)?.isCritical);
      if (criticalPreds.length === 0) break;
      criticalPreds.sort(
        (a, b) => (byId.get(b.fromId)?.ef ?? 0) - (byId.get(a.fromId)?.ef ?? 0),
      );
      id = criticalPreds[0].fromId;
    }
    const ordered = chain.reverse();
    if (ordered.length > bestIds.length) bestIds = ordered;
  }

  return bestIds.map((id) => byId.get(id)!).filter(Boolean);
}

export function hasPredecessors(activityId: string, dependencies: PdmDependency[]): boolean {
  return dependencies.some((d) => d.toId === activityId);
}

/** Independent = no incoming dependency. ES = 0 alone does not mean Independent. */
export function isIndependentActivity(activityId: string, dependencies: PdmDependency[]): boolean {
  return !hasPredecessors(activityId, dependencies);
}

export interface ActivityIncomingLink {
  type: DependencyType | 'Independent';
  /** Predecessor activity number, or Independent when none. */
  to: string;
  /** Predecessor activity id when not Independent. */
  fromId?: string;
  /** Lag days on the driving link (negative = lead). */
  lag?: number;
}

/** Driving incoming link for an activity (Type / TO columns). */
export function activityIncomingLink(
  activityId: string,
  activities: PdmActivity[],
  dependencies: PdmDependency[],
  scheduledActivities?: PdmActivity[],
): ActivityIncomingLink {
  return (
    activityIncomingLinksMap(activities, dependencies, scheduledActivities).get(activityId) ?? {
      type: 'Independent',
      to: 'Independent',
    }
  );
}

/**
 * Build Type/TO for every activity in one pass.
 * Runs the forward/backward schedule at most once (only when some activity has multiple predecessors).
 */
export function activityIncomingLinksMap(
  activities: PdmActivity[],
  dependencies: PdmDependency[],
  scheduledActivities?: PdmActivity[],
): Map<string, ActivityIncomingLink> {
  const incomingByTo = new Map<string, PdmDependency[]>();
  for (const dep of dependencies) {
    if (!incomingByTo.has(dep.toId)) incomingByTo.set(dep.toId, []);
    incomingByTo.get(dep.toId)!.push(dep);
  }

  const numberById = new Map(activities.map((a) => [a.id, a.number]));
  const needsSchedule = [...incomingByTo.values()].some((list) => list.length > 1);
  const scheduled =
    needsSchedule || scheduledActivities
      ? (scheduledActivities ?? calculatePdmSchedule(activities, dependencies))
      : null;
  const byId = scheduled ? new Map(scheduled.map((a) => [a.id, a])) : null;

  const map = new Map<string, ActivityIncomingLink>();
  for (const act of activities) {
    const incoming = incomingByTo.get(act.id) ?? [];
    if (incoming.length === 0) {
      map.set(act.id, { type: 'Independent', to: 'Independent' });
      continue;
    }
    if (incoming.length === 1) {
      const driving = incoming[0];
      map.set(act.id, {
        type: driving.type,
        to: numberById.get(driving.fromId) ?? '—',
        fromId: driving.fromId,
        lag: lagOf(driving),
      });
      continue;
    }

    const scheduledAct = byId?.get(act.id);
    let driving: PdmDependency | null = null;
    let bestConstraint = -Infinity;
    for (const dep of incoming) {
      const pred = byId?.get(dep.fromId);
      if (!pred) continue;
      const constraint = requiredSuccessorEs(
        dep.type,
        pred.es ?? 0,
        pred.ef ?? 0,
        scheduledAct?.duration ?? act.duration ?? 1,
        lagOf(dep),
      );
      if (constraint > bestConstraint) {
        bestConstraint = constraint;
        driving = dep;
      }
    }
    if (!driving) {
      map.set(act.id, { type: 'Independent', to: 'Independent' });
      continue;
    }
    map.set(act.id, {
      type: driving.type,
      to: numberById.get(driving.fromId) ?? '—',
      fromId: driving.fromId,
      lag: lagOf(driving),
    });
  }
  return map;
}

/**
 * Set Type / TO from the activities table.
 * Independent = remove all predecessors. Otherwise replace incoming links with one From→To link.
 */
export function setActivityPredecessor(
  activities: PdmActivity[],
  dependencies: PdmDependency[],
  activityId: string,
  type: DependencyType | 'Independent',
  predecessorId: string | null,
): PdmDependency[] {
  const existingIncoming = dependencies.filter((d) => d.toId === activityId);
  const withoutIncoming = dependencies.filter((d) => d.toId !== activityId);
  if (type === 'Independent' || !predecessorId || predecessorId === activityId) {
    return withoutIncoming;
  }
  if (!activities.some((a) => a.id === predecessorId)) {
    return withoutIncoming;
  }
  const preservedLag =
    existingIncoming.length === 1 && existingIncoming[0].fromId === predecessorId
      ? lagOf(existingIncoming[0])
      : 0;
  return [
    ...withoutIncoming,
    {
      id: `dep-${predecessorId}-${activityId}-${Date.now()}`,
      fromId: predecessorId,
      toId: activityId,
      type,
      lag: preservedLag,
    },
  ];
}

export const DEPENDENCY_LABELS: Record<DependencyType, string> = {
  FS: 'Finish-to-Start',
  SS: 'Start-to-Start',
  FF: 'Finish-to-Finish',
  SF: 'Start-to-Finish',
};

/** Display suffix: " +3" lag or " -3" lead. Empty when lag is 0. */
export function formatDependencyLag(lag: number | null | undefined): string {
  const n = lag ?? 0;
  if (n === 0) return '';
  return n > 0 ? ` +${n}` : ` ${n}`;
}

export function totalFloatOf(a: PdmActivity): number {
  if (a.ls == null || a.es == null) return 0;
  return Math.max(0, a.ls - a.es);
}

/** Free float for FS links: earliest successor ES − this EF (lag-adjusted). */
export function freeFloatOf(
  a: PdmActivity,
  activities: PdmActivity[],
  deps: PdmDependency[],
): number {
  const tf = totalFloatOf(a);
  const successors = deps.filter((d) => d.fromId === a.id);
  if (successors.length === 0) return tf;

  const ef = a.ef ?? 0;
  let minGap = Infinity;
  for (const d of successors) {
    const succ = activities.find((x) => x.id === d.toId);
    if (!succ || succ.es == null) continue;
    const lag = d.lag ?? 0;
    if (d.type === 'FS' || !d.type) {
      minGap = Math.min(minGap, succ.es - ef - lag);
    }
  }
  return Math.max(0, minGap === Infinity ? tf : minGap);
}

/** Suggest the next FS link to add (prefers missing driving links where EF = ES). */
export function suggestFsDependency(
  activities: PdmActivity[],
  dependencies: PdmDependency[],
): { fromId: string; toId: string } | null {
  if (activities.length < 2) return null;

  const scheduled = calculatePdmSchedule(activities, dependencies);
  if (scheduled.length !== activities.length) return null;
  const byId = new Map(scheduled.map((a) => [a.id, a]));

  const drivingFsEf = (toId: string): number =>
    Math.max(
      0,
      ...dependencies
        .filter((d) => d.toId === toId && (d.type === 'FS' || !d.type))
        .map((d) => byId.get(d.fromId)?.ef ?? 0),
    );

  let best: { fromId: string; toId: string; es: number } | null = null;
  for (const from of scheduled) {
    for (const to of scheduled) {
      if (from.id === to.id) continue;
      if (dependencies.some((d) => d.fromId === from.id && d.toId === to.id)) continue;
      if ((from.ef ?? 0) !== (to.es ?? 0)) continue;
      // Skip coincidental timing — successor already has a driving FS predecessor.
      if (drivingFsEf(to.id) === (to.es ?? 0) && (to.es ?? 0) > 0) continue;
      const es = to.es ?? 0;
      if (!best || es > best.es) best = { fromId: from.id, toId: to.id, es };
    }
  }
  if (best) return { fromId: best.fromId, toId: best.toId };

  for (const to of scheduled) {
    if (dependencies.some((d) => d.toId === to.id) || to.esOverride != null) continue;
    const toEs = to.es ?? 0;

    for (const from of scheduled) {
      if (from.id === to.id) continue;
      if (dependencies.some((d) => d.fromId === from.id && d.toId === to.id)) continue;
      const fromEf = from.ef ?? 0;
      if (fromEf <= toEs) continue;

      const candidate = [
        ...dependencies,
        { id: 'test', fromId: from.id, toId: to.id, type: 'FS' as const, lag: 0 },
      ];
      const after = calculatePdmSchedule(activities, candidate);
      const toAfter = after.find((a) => a.id === to.id);
      if (!toAfter || (toAfter.es ?? 0) !== fromEf) continue;
      if (!best || fromEf > best.es) best = { fromId: from.id, toId: to.id, es: fromEf };
    }
  }
  if (best) return { fromId: best.fromId, toId: best.toId };

  for (let i = 0; i < activities.length; i++) {
    for (let j = 0; j < activities.length; j++) {
      if (i === j) continue;
      const fromId = activities[i].id;
      const toId = activities[j].id;
      if (dependencies.some((d) => d.fromId === fromId && d.toId === toId)) continue;
      return { fromId, toId };
    }
  }
  return null;
}
