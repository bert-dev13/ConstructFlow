import {
  collection,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import type { SCurvePoint } from '../../types';
import type {
  SCurveActivity,
  SCurveComparison,
  SCurveSnapshotSummary,
  SCurveType,
} from '../sCurveApi';
import {
  computeSCurveCostSummary,
  type SCurveCostItem,
  type SCurveCostItemInput,
} from '../sCurveItems';
import {
  applySCurvePeriodEdits,
  buildSCurvePeriods,
  buildTheoreticalSCurvePeriods,
  intervalDays,
  periodIndexForDate,
  readSCurvePeriodEdits,
  readStoredSCurvePeriods,
  sampleBaselinePeriods,
  type SCurvePeriodEdit,
  type SCurveReportingInterval,
  type SCurvePeriodRow,
} from '../sCurvePeriods';
import {
  compareTargetVsActual,
  resolveTargetAndActual,
  statusDisplayLabel,
} from '../progressStatus';
import type { ReportProgressEntry } from '../../components/ReportProgressFeed';
import {
  addCalendarDays,
  calculatePlannedPercentage,
  formatExcelDate,
  plannedCompletionDate,
} from '../stewaCalculations';
import {
  buildRevisedBaselinePeriods,
  flattenSuspensionPoints,
  inclusiveDayCount,
  readSuspensionWindow,
  reportingDateFromSCurveLabel,
  sCurveSourceVersionLabel,
  stampOriginalPlan,
  type SuspensionWindow,
} from '../scheduleBaselines';
import { COLLECTIONS, sCurveSnapshotsPath } from './collections';
import { db } from './config';
import { asId, nowIso } from './ids';
import { getAccessContext } from './access';
import {
  invalidateChartCaches,
  loadProjectChartContext,
  loadSCurveVersions,
} from './chartContext';
import { listProjectBoq } from './projectBoq';
import { normalizePayItemNo } from './payItems';
import { canEditProjectCharts, canEditSCurvePeriods } from '../chartPermissions';

async function assertCanEditProjectCharts() {
  const access = await getAccessContext();
  if (!canEditProjectCharts(access?.role)) {
    throw new Error('You have view-only access to PDM / S-Curve / Bar Chart for this project.');
  }
}

interface StoredSCurveCostItem {
  activityId: string;
  itemNo?: string;
  description?: string;
  quantity: number;
  unitCost: number;
}

function plannedOnDate(
  noticeToProceed: string,
  contractDurationDays: number,
  asOf: string,
  suspensionDays: number,
): number | null {
  return calculatePlannedPercentage({
    noticeToProceed,
    contractDurationDays,
    asOf,
    suspensionDays,
  });
}

function computePdmTargetOnDate(args: {
  noticeToProceed: string;
  duration: number;
  asOf: string;
  suspensionDays: number;
  suspension?: SuspensionWindow | null;
  targetFull?: string | null;
}): number | null {
  const { noticeToProceed, duration, asOf, suspensionDays, suspension, targetFull } = args;
  if (asOf <= noticeToProceed) return 0;
  if (targetFull && asOf >= targetFull) return 100;
  if (!suspension || suspensionDays === 0) {
    const raw = plannedOnDate(noticeToProceed, duration, asOf, 0);
    return raw != null ? Math.min(100, Math.max(0, raw)) : null;
  }
  if (asOf < suspension.start) {
    const raw = plannedOnDate(noticeToProceed, duration, asOf, 0);
    return raw != null ? Math.min(100, Math.max(0, raw)) : null;
  }
  const dayBefore = addCalendarDays(suspension.start, -1) || suspension.start;
  const rawFrozen =
    plannedOnDate(noticeToProceed, duration, dayBefore, 0) ??
    plannedOnDate(noticeToProceed, duration, suspension.start, 0);
  const frozen = rawFrozen != null ? Math.min(100, Math.max(0, rawFrozen)) : 0;
  if (asOf <= suspension.end) {
    return frozen;
  }
  const rawPost = plannedOnDate(noticeToProceed, duration, asOf, suspensionDays);
  if (rawPost == null) return frozen;
  return Math.min(100, Math.max(frozen, rawPost));
}

/** Formula inputs shared with STEWA. Prefer the STEWA header values, then the project schedule. */
function resolvePlanBasis(
  feed: ReportProgressEntry[],
  fallback: { noticeToProceed: string; contractDurationDays: number; suspensionDays: number },
): { noticeToProceed: string; contractDurationDays: number; suspensionDays: number } {
  const sourced = feed
    .filter(
      (entry) =>
        entry.reportType === 'STEWA' &&
        entry.planNoticeToProceed &&
        entry.planContractDuration != null &&
        entry.planContractDuration > 0,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = sourced[0];
  if (!latest?.planNoticeToProceed || latest.planContractDuration == null) return fallback;
  return {
    noticeToProceed: latest.planNoticeToProceed,
    contractDurationDays: latest.planContractDuration,
    suspensionDays: latest.planSuspensionDays ?? 0,
  };
}

function hideSeriesAfter(
  points: SCurvePoint[],
  key: 'originalPlan' | 'currentPlan',
  endDate: string | null,
): SCurvePoint[] {
  if (!endDate) return points;
  return points.map((point) => (point.date > endDate ? { ...point, [key]: null } : point));
}

function endSeriesAtFirstFull(
  points: SCurvePoint[],
  key: 'originalPlan' | 'currentPlan' | 'actual',
): SCurvePoint[] {
  let ended = false;
  return points.map((point) => {
    if (ended) return { ...point, [key]: null };
    const value = point[key];
    if (value == null || !Number.isFinite(value)) return point;
    const capped = Math.min(100, value);
    if (capped >= 100) {
      ended = true;
      return { ...point, [key]: 100 };
    }
    return { ...point, [key]: capped };
  });
}

/**
 * PDM-based Original and Target use the STEWA planned sine on the schedule itself.
 * - Original: strictly follows the original baseline schedule without suspension.
 * - Target: follows original progress up to suspension, stays flat (at last Target %)
 *   throughout the suspension period, and resumes increasing smoothly towards 100%.
 * Interval dates are calculated even when no STEWA report exists for that date.
 * Each series stops on the first date it reaches 100%.
 * Actual values already on the points are left unchanged except for the 100% cap.
 */
function applyStewaPlanCurves(
  points: SCurvePoint[],
  input: {
    noticeToProceed: string;
    contractDurationDays: number;
    suspensionDays: number;
    intervalDays: number;
    suspension?: SuspensionWindow | null;
  },
): SCurvePoint[] {
  const duration = input.contractDurationDays > 0 ? input.contractDurationDays : 1;
  const suspension = input.suspension;
  const suspensionDays = Math.max(
    0,
    input.suspensionDays || (suspension ? inclusiveDayCount(suspension.start, suspension.end) : 0),
  );
  const originalFull = plannedCompletionDate({
    noticeToProceed: input.noticeToProceed,
    contractDurationDays: duration,
    suspensionDays: 0,
  });
  const targetFull =
    plannedCompletionDate({
      noticeToProceed: input.noticeToProceed,
      contractDurationDays: duration,
      suspensionDays,
    }) || suspension?.revisedCompletion || null;

  const horizon =
    [originalFull, targetFull, suspension?.revisedCompletion]
      .filter((date): date is string => !!date)
      .sort()
      .at(-1) ?? input.noticeToProceed;

  const dates = new Set<string>([input.noticeToProceed.slice(0, 10)]);
  const step = Math.max(1, Math.floor(input.intervalDays) || 1);
  let cursor = input.noticeToProceed.slice(0, 10);
  for (let guard = 0; cursor < horizon && guard < 500; guard += 1) {
    const next = addCalendarDays(cursor, step);
    if (!next || next > horizon) break;
    dates.add(next);
    cursor = next;
  }
  if (originalFull) dates.add(originalFull);
  if (targetFull) dates.add(targetFull);
  if (suspension && suspension.start && suspension.end) {
    dates.add(suspension.start);
    dates.add(suspension.end);
    const dayBeforeSusp = addCalendarDays(suspension.start, -1);
    if (dayBeforeSusp) dates.add(dayBeforeSusp);
    const dayAfterSusp = addCalendarDays(suspension.end, 1);
    if (dayAfterSusp) dates.add(dayAfterSusp);
    if (suspension.revisedCompletion) dates.add(suspension.revisedCompletion);
  }

  const priorByDate = new Map(points.map((point) => [point.date.slice(0, 10), point]));
  for (const point of points) {
    dates.add(point.date.slice(0, 10));
  }

  let shaped = [...dates].sort().map((date): SCurvePoint => {
    const prior = priorByDate.get(date);
    let origPlan = plannedOnDate(input.noticeToProceed, duration, date, 0);
    if (origPlan != null) {
      origPlan = Math.min(100, Math.max(0, origPlan));
    }

    const currPlan = computePdmTargetOnDate({
      noticeToProceed: input.noticeToProceed,
      duration,
      asOf: date,
      suspensionDays,
      suspension,
      targetFull,
    });

    return {
      date,
      pointDate: date,
      label: prior?.label || date,
      periodLabel: prior?.periodLabel ?? null,
      originalPlan: origPlan,
      currentPlan: currPlan,
      actual: prior?.actual ?? null,
      variance: prior?.variance ?? null,
      targetAccomplishmentPct: null,
      targetAccomplishmentPhp: null,
      cumulativePct: null,
      cumulativePhp: null,
    };
  });

  // Ensure Target curve is strictly cumulative (never decreases, once 100% stays at 100%)
  let maxCurr = 0;
  let currFull = false;
  shaped = shaped.map((pt) => {
    if (pt.currentPlan != null) {
      let val = pt.currentPlan;
      if (currFull || (targetFull && pt.date >= targetFull)) {
        val = 100;
        currFull = true;
      } else if (val >= 100) {
        val = 100;
        currFull = true;
      } else if (val < maxCurr) {
        val = maxCurr;
      } else {
        maxCurr = val;
      }
      return { ...pt, currentPlan: Math.round((val + Number.EPSILON) * 100) / 100 };
    }
    return pt;
  });

  // Ensure Original curve is strictly cumulative (never decreases, reaches 100% on original completion)
  let maxOrig = 0;
  let origFull = false;
  shaped = shaped.map((pt) => {
    if (pt.originalPlan != null) {
      let val = pt.originalPlan;
      if (origFull || (originalFull && pt.date >= originalFull)) {
        val = 100;
        origFull = true;
      } else if (val >= 100) {
        val = 100;
        origFull = true;
      } else if (val < maxOrig) {
        val = maxOrig;
      } else {
        maxOrig = val;
      }
      return { ...pt, originalPlan: Math.round((val + Number.EPSILON) * 100) / 100 };
    }
    return pt;
  });

  shaped = hideSeriesAfter(shaped, 'originalPlan', originalFull);
  shaped = hideSeriesAfter(shaped, 'currentPlan', targetFull);
  shaped = endSeriesAtFirstFull(shaped, 'actual');
  return shaped.filter(
    (point) => point.originalPlan != null || point.currentPlan != null || point.actual != null,
  );
}

interface SCurveSettingsState {
  curveType: SCurveType;
  reportingInterval: SCurveReportingInterval;
  theoreticalTotalPeriods: number;
  theoreticalDurationDays: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeSCurveSettings(
  raw: Record<string, unknown> | null,
  projectDuration: number,
): SCurveSettingsState {
  const reportingInterval =
    raw?.reportingInterval === '10_day' || raw?.reportingInterval === '30_day'
      ? (raw.reportingInterval as SCurveReportingInterval)
      : '30_day';
  const curveType =
    raw?.activeCurveType === 'ideal_theoretical'
      ? ('ideal_theoretical' as const)
      : ('pdm_based' as const);
  const fallbackPeriods = Math.max(1, Math.ceil(Math.max(1, projectDuration) / intervalDays(reportingInterval)));
  const theoreticalTotalPeriods = Math.max(
    1,
    Number(raw?.theoreticalTotalPeriods ?? fallbackPeriods),
  );
  return {
    curveType,
    reportingInterval,
    theoreticalTotalPeriods,
    theoreticalDurationDays: theoreticalTotalPeriods * intervalDays(reportingInterval),
  };
}

/** Actual accomplishment is 0 at the project start, then follows reported values only. */
function anchorActualSeriesAtStart(points: SCurvePoint[]): SCurvePoint[] {
  if (!points.some((point) => point.actual != null)) return points;
  const start = [...points].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!start || start.actual != null) return points;
  return points.map((point) => (point.date === start.date ? { ...point, actual: 0 } : point));
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function periodForDate(
  startDate: string,
  periods: SCurvePeriodRow[],
  date: string,
  reportingInterval: SCurveReportingInterval,
): SCurvePeriodRow | null {
  if (periods.length === 0) return null;
  const index = Math.min(periods.length, periodIndexForDate(startDate, date, reportingInterval));
  return periods.find((period) => period.periodIndex === index) ?? periods[periods.length - 1];
}

/**
 * Build S-Curve points:
 * - Target Plan from PDM schedule + WT% grouped into 30-day monthly periods
 * - Actual from approved SWA/STEWA progress updates over time
 */
export function buildProgressSCurvePoints(
  startDate: string,
  periods: SCurvePeriodRow[],
  chronological: { date: string; percent: number; label: string }[],
  reportingInterval: SCurveReportingInterval,
): SCurvePoint[] {
  const points = new Map<string, SCurvePoint>();

  points.set(startDate, {
    date: startDate,
    pointDate: startDate,
    label: 'Project start',
    periodLabel: periods[0]?.label ?? 'Month 1',
    originalPlan: 0,
    currentPlan: 0,
    actual: null,
    targetAccomplishmentPct: 0,
    targetAccomplishmentPhp: 0,
    cumulativePct: 0,
    cumulativePhp: 0,
  });

  for (const period of periods) {
    points.set(period.endDate, {
      date: period.endDate,
      pointDate: period.endDate,
      label: period.label,
      periodLabel: period.label,
      originalPlan: round2(period.cumulativePct),
      currentPlan: round2(period.cumulativePct),
      actual: null,
      targetAccomplishmentPct: round2(period.targetAccomplishmentPct),
      targetAccomplishmentPhp: round2(period.targetAccomplishmentPhp),
      cumulativePct: round2(period.cumulativePct),
      cumulativePhp: round2(period.cumulativePhp),
    });
  }

  for (const entry of chronological) {
    const existing = points.get(entry.date);
    if (existing) {
      existing.actual = entry.percent;
      if (!existing.label || existing.label.startsWith('Month') || existing.label.startsWith('10-Day')) {
        existing.label = entry.label;
      }
      continue;
    }
    const period = periodForDate(startDate, periods, entry.date, reportingInterval);
    points.set(entry.date, {
      date: entry.date,
      pointDate: entry.date,
      label: entry.label,
      periodLabel: period?.label ?? null,
      originalPlan: null,
      currentPlan: null,
      actual: entry.percent,
      targetAccomplishmentPct: null,
      targetAccomplishmentPhp: null,
      cumulativePct: null,
      cumulativePhp: null,
    });
  }

  return anchorActualSeriesAtStart([...points.values()].sort((a, b) => a.date.localeCompare(b.date)));
}

function presentSCurveVersions(
  versions: SCurveSnapshotSummary[],
  feed: ReportProgressEntry[],
): SCurveSnapshotSummary[] {
  const sources = feed.filter(
    (entry) => (entry.reportType === 'SWA' || entry.reportType === 'STEWA') && entry.date,
  );
  return versions.map((version) => {
    const label = version.trigger_label?.trim() ?? '';
    if (label.startsWith('SWA') || label.startsWith('STEWA')) return version;
    const matches = sources.filter((entry) => entry.date === version.as_of_date);
    if (matches.length !== 1) return version;
    const entry = matches[0];
    const asOfLabel = entry.asOfLabel?.trim() || formatExcelDate(entry.date);
    const status = compareTargetVsActual(version.planned_pct, entry.percent);
    return {
      ...version,
      trigger_label: sCurveSourceVersionLabel(entry.reportType, asOfLabel, version.revision ?? 1),
      as_of_label: asOfLabel,
      source_report_type: entry.reportType,
      actual_pct: entry.percent,
      slippage_pct: status.slippage_pct,
      schedule_status: status.status,
    };
  });
}

function retargetPdmVersions(
  versions: SCurveSnapshotSummary[],
  input: {
    noticeToProceed: string;
    duration: number;
    suspensionDays: number;
    suspension?: SuspensionWindow | null;
    targetFull?: string | null;
  },
): SCurveSnapshotSummary[] {
  return versions.map((version) => {
    const asOf = version.as_of_date || reportingDateFromSCurveLabel(version.trigger_label ?? '') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return version;
    const target = computePdmTargetOnDate({
      noticeToProceed: input.noticeToProceed,
      duration: input.duration,
      asOf,
      suspensionDays: input.suspensionDays,
      suspension: input.suspension,
      targetFull: input.targetFull,
    });
    const status = compareTargetVsActual(target, version.actual_pct);
    return {
      ...version,
      planned_pct: target,
      slippage_pct: status.slippage_pct,
      schedule_status: status.status,
    };
  });
}

function chronologicalThroughReport(
  chronological: ReportProgressEntry[],
  reportId: string,
): { entries: ReportProgressEntry[]; selected: ReportProgressEntry } | null {
  const selected = chronological.find((entry) => entry.id === reportId);
  if (!selected) return null;
  return {
    selected,
    entries: chronological.filter((entry) => entry.date < selected.date || entry.id === selected.id),
  };
}

export async function getSCurveFs(
  projectId: string | number,
  snapshotId?: string | number | null,
  reportingInterval?: SCurveReportingInterval,
  options?: { throughReportId?: string },
) {
  const id = asId(projectId);

  // One shared context for the selected project + versions in parallel.
  const [ctx, versions, snapshotData] = await Promise.all([
    loadProjectChartContext(id),
    loadSCurveVersions(id),
    snapshotId != null && asId(snapshotId)
      ? getDoc(doc(db, sCurveSnapshotsPath(id), asId(snapshotId)))
          .then((snap) => (snap.exists() ? (snap.data() as Record<string, unknown>) : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const snapshotPoints = (snapshotData?.points as SCurvePoint[] | undefined) ?? null;
  const snapshotAsOf = String(snapshotData?.asOfDate ?? '').slice(0, 10);
  const snapshotReportingDate =
    /^\d{4}-\d{2}-\d{2}$/.test(snapshotAsOf)
      ? snapshotAsOf
      : reportingDateFromSCurveLabel(String(snapshotData?.triggerLabel ?? '')) ?? '';
  const snapshotActual = snapshotData?.actualPct != null ? Number(snapshotData.actualPct) : null;
  const snapshotLabel = (snapshotData?.triggerLabel as string | null) ?? null;

  const schedule = ctx.schedule;
  const feed = ctx.feed;
  let { actualPct, latestReport, chronological } = resolveTargetAndActual(feed);
  const allChronological = chronological;
  let viewingMatchedReport = false;
  if (options?.throughReportId) {
    const through = chronologicalThroughReport(chronological, options.throughReportId);
    if (!through) {
      throw new Error('Choose an SWA or STEWA that belongs to this project.');
    }
    chronological = through.entries;
    actualPct = through.selected.percent;
    latestReport = through.selected;
  }
  if (snapshotData) {
    const sourceId = snapshotData.sourceReportId ? String(snapshotData.sourceReportId) : '';
    const dated = snapshotReportingDate
      ? allChronological.filter((entry) => entry.date === snapshotReportingDate && entry.id)
      : [];
    const through =
      (sourceId ? chronologicalThroughReport(allChronological, sourceId) : null) ??
      (dated.length === 1 ? chronologicalThroughReport(allChronological, dated[0].id ?? '') : null);
    if (through) {
      chronological = through.entries;
      actualPct = through.selected.percent;
      latestReport = through.selected;
      viewingMatchedReport = true;
    } else if (snapshotReportingDate) {
      chronological = allChronological.filter((entry) => entry.date <= snapshotReportingDate);
      latestReport = chronological[chronological.length - 1] ?? null;
      if (latestReport) actualPct = latestReport.percent;
    }
    if (!viewingMatchedReport && snapshotActual != null && Number.isFinite(snapshotActual)) {
      actualPct = snapshotActual;
    }
  }
  const start = ctx.projectStart;
  const duration = Math.max(1, schedule.projectDuration || 110);

  const settingsBase: SCurveSettingsState = {
    curveType: ctx.settings.curveType,
    reportingInterval: ctx.settings.reportingInterval,
    theoreticalTotalPeriods: ctx.settings.theoreticalTotalPeriods,
    theoreticalDurationDays: ctx.settings.theoreticalDurationDays,
  };
  const settings =
    reportingInterval == null
      ? settingsBase
      : {
          ...settingsBase,
          reportingInterval,
          theoreticalDurationDays:
            settingsBase.theoreticalTotalPeriods * intervalDays(reportingInterval),
        };

  const storedCostItems = ctx.settings.costItems as StoredSCurveCostItem[];
  const storedCostByActivityId = new Map(storedCostItems.map((item) => [item.activityId, item]));

  // Only hit BOQ when stored cost rows have no amounts. A previous save of all-zero
  // rows must not replace the original weight baseline.
  const storedHasAmount = [...storedCostByActivityId.values()].some(
    (item) => Number(item.quantity) > 0 && Number(item.unitCost) > 0,
  );
  const needsBoq = schedule.activities.length > 0 && !storedHasAmount;

  let boqByPayItemId = new Map<string, { programmedQty: number; unitPrice: number }>();
  let boqByItemNo = new Map<string, { programmedQty: number; unitPrice: number }>();
  if (needsBoq) {
    try {
      const boqRows = await listProjectBoq(id);
      for (const row of boqRows) {
        if (!row.active) continue;
        const qty =
          row.revisedQty != null && row.revisedQty > 0 ? row.revisedQty : row.programmedQty;
        const values = { programmedQty: qty, unitPrice: row.unitPrice };
        if (row.payItemId) boqByPayItemId.set(row.payItemId, values);
        if (row.itemNo) boqByItemNo.set(normalizePayItemNo(row.itemNo), values);
      }
    } catch {
      /* leave empty maps */
    }
  }

  const costSummary = computeSCurveCostSummary(
    schedule.activities.map((activity): SCurveCostItemInput => {
      const stored = storedCostByActivityId.get(activity.id);
      const fromBoq =
        (activity.payItemId ? boqByPayItemId.get(activity.payItemId) : undefined) ??
        boqByItemNo.get(normalizePayItemNo(activity.number));
      return {
        activityId: activity.id,
        itemNo: stored && stored.itemNo != null ? String(stored.itemNo) : activity.number,
        description: stored && stored.description != null ? String(stored.description) : activity.name,
        quantity: Number(stored?.quantity ?? fromBoq?.programmedQty ?? 0),
        unitCost: Number(stored?.unitCost ?? fromBoq?.unitPrice ?? 0),
      };
    }),
  );
  // Amounts must track theoretical / PDM interval % against a real contract total.
  // When cost rows are empty, fall back to the project's contract amount.
  const totalContractAmount =
    costSummary.totalContractAmount > 0
      ? costSummary.totalContractAmount
      : Math.max(0, Number(ctx.projectContractAmount) || 0);
  const periods =
    settings.curveType === 'ideal_theoretical'
      ? buildTheoreticalSCurvePeriods({
          startDate: start,
          projectDuration: duration,
          endDate: ctx.projectPlannedEnd,
          activities: schedule.activities,
          costItems: costSummary.items,
          totalContractAmount,
          reportingInterval: settings.reportingInterval,
        })
      : buildSCurvePeriods({
          startDate: start,
          projectDuration: duration,
          activities: schedule.activities,
          costItems: costSummary.items,
          totalContractAmount,
          reportingInterval: settings.reportingInterval,
        });
  const suspension = readSuspensionWindow({
    baselineMode:
      ctx.baselineMode === 'prior_suspension' ||
      (ctx.suspensionStartDate && ctx.suspensionEndDate)
        ? 'prior_suspension'
        : ctx.baselineMode,
    suspensionStart: ctx.suspensionStartDate,
    suspensionEnd: ctx.suspensionEndDate,
    revisedCompletion: ctx.revisedCompletionDate,
    plannedEndDate: ctx.projectPlannedEnd,
    projectStart: ctx.projectStart,
  });
  const planBasis = resolvePlanBasis(feed, {
    noticeToProceed: start,
    contractDurationDays: duration,
    suspensionDays: suspension ? inclusiveDayCount(suspension.start, suspension.end) : 0,
  });
  const targetFull =
    plannedCompletionDate({
      noticeToProceed: planBasis.noticeToProceed,
      contractDurationDays: planBasis.contractDurationDays,
      suspensionDays: planBasis.suspensionDays,
    }) || suspension?.revisedCompletion || null;
  const revisedPeriods = suspension
    ? buildRevisedBaselinePeriods({
        projectStart: start,
        activities: schedule.activities,
        costItems: costSummary.items,
        totalContractAmount,
        reportingInterval: settings.reportingInterval,
        suspension,
      })
    : null;
  const rawCurve = ctx.settings.rawCurveData;
  const periodsCustomized = rawCurve?.periodsCustomized === true;
  const periodCountCustomized = rawCurve?.periodCountCustomized === true;
  const storedBaseline = readStoredSCurvePeriods(rawCurve?.baselinePeriods);
  const periodEdits = readSCurvePeriodEdits(rawCurve?.periodEdits);
  // Original Target Plan stays on the formula, or on the baseline locked at the first period edit.
  const targetPeriods = periodsCustomized && storedBaseline.length > 0 ? storedBaseline : periods;
  if (periodsCustomized && storedBaseline.length === 0) {
    const access = await getAccessContext();
    if (canEditSCurvePeriods(access?.role)) {
      void setDoc(
        doc(db, COLLECTIONS.sCurves, id),
        {
          projectId: id,
          baselinePeriods: periods,
          periodsCustomized: true,
          updatedAt: nowIso(),
        },
        { merge: true },
      ).catch(() => {
        /* period editors lock the baseline once; ignore a denied write */
      });
    }
  }
  let displayPeriods = targetPeriods.map((row) => ({ ...row }));
  if (periodCountCustomized && settings.curveType === 'ideal_theoretical' && !revisedPeriods) {
    displayPeriods = sampleBaselinePeriods({
      baseline: targetPeriods,
      periodCount: settings.theoreticalTotalPeriods,
      reportingInterval: settings.reportingInterval,
    });
  }
  displayPeriods = applySCurvePeriodEdits(displayPeriods, periodEdits, totalContractAmount);
  const monitoringPeriods = revisedPeriods ?? displayPeriods;
  const activities: SCurveActivity[] = schedule.activities.map((activity) => {
    const finishDate = addDays(start, activity.ef ?? activity.duration);
    const period = periodForDate(start, targetPeriods, finishDate, settings.reportingInterval);
    return {
      id: activity.id,
      number: activity.number,
      name: activity.name,
      duration: activity.duration,
      es: activity.es ?? 0,
      ef: activity.ef ?? activity.duration,
      finish_date: finishDate,
      planned_pct: period ? round2(period.cumulativePct) : 0,
      is_critical: !!activity.isCritical,
    };
  });
  let points = buildProgressSCurvePoints(
    start,
    monitoringPeriods,
    chronological.map((e) => ({ date: e.date, percent: e.percent, label: e.label })),
    settings.reportingInterval,
  );
  if (settings.curveType === 'pdm_based') {
    points = applyStewaPlanCurves(points, {
      noticeToProceed: planBasis.noticeToProceed,
      contractDurationDays: planBasis.contractDurationDays,
      suspensionDays: planBasis.suspensionDays,
      intervalDays: intervalDays(settings.reportingInterval),
      suspension,
    });
  } else if (revisedPeriods && suspension) {
    points = stampOriginalPlan(points, targetPeriods, revisedPeriods);
    points = flattenSuspensionPoints(
      points,
      targetPeriods,
      start,
      schedule.activities,
      costSummary.items,
      suspension,
    );
  }
  const asOfDate = snapshotReportingDate || latestReport?.date || nowIso().slice(0, 10);
  const originalTargetPeriod = periodForDate(start, targetPeriods, asOfDate, settings.reportingInterval);
  const sineTarget =
    settings.curveType === 'pdm_based'
      ? computePdmTargetOnDate({
          noticeToProceed: planBasis.noticeToProceed,
          duration: planBasis.contractDurationDays,
          asOf: asOfDate,
          suspensionDays: planBasis.suspensionDays,
          suspension,
          targetFull,
        })
      : null;
  const effectiveTarget =
    sineTarget != null
      ? sineTarget
      : originalTargetPeriod
        ? round2(originalTargetPeriod.cumulativePct)
        : null;
  const effectiveTargetPhp =
    sineTarget != null
      ? round2((sineTarget * totalContractAmount) / 100)
      : originalTargetPeriod
        ? round2(originalTargetPeriod.cumulativePhp)
        : null;

    if (snapshotPoints && !viewingMatchedReport) {
    points = snapshotPoints;
    if (settings.curveType === 'pdm_based') {
      points = applyStewaPlanCurves(points, {
        noticeToProceed: planBasis.noticeToProceed,
        contractDurationDays: planBasis.contractDurationDays,
        suspensionDays: planBasis.suspensionDays,
        intervalDays: intervalDays(settings.reportingInterval),
        suspension,
      });
    }
  } else if (!options?.throughReportId && !snapshotData) {
    // Persist in the background — do not block the page render on Firestore write.
    // Skip entirely for view-only roles (Engineer II–IV) to avoid permission-denied noise.
    const access = await getAccessContext();
    if (canEditProjectCharts(access?.role)) {
      void setDoc(
        doc(db, COLLECTIONS.sCurves, id),
        {
          projectId: id,
          points,
          costItems: costSummary.items.map((item) => ({
            activityId: item.activityId,
            itemNo: item.itemNo,
            description: item.description,
            quantity: Number(item.quantity) || 0,
            unitCost: Number(item.unitCost) || 0,
          })),
          activeCurveType: settings.curveType,
          reportingInterval: settings.reportingInterval,
          theoreticalTotalPeriods: settings.theoreticalTotalPeriods,
          targetPlanPct: effectiveTarget,
          targetPlanPhp: effectiveTargetPhp,
          actualPlanPct: actualPct,
          baselineReportNumber: latestReport?.reportNumber ?? null,
          updatedAt: nowIso(),
        },
        { merge: true },
      ).catch(() => {
        /* ignore transient write failures */
      });
    }
  }

  points = anchorActualSeriesAtStart(points);

  const status = compareTargetVsActual(effectiveTarget, actualPct);

  const comparisonRows: SCurveComparison[] = chronological.map((entry) => {
    const period = periodForDate(start, targetPeriods, entry.date, settings.reportingInterval);
    const target =
      settings.curveType === 'pdm_based'
        ? (computePdmTargetOnDate({
            noticeToProceed: planBasis.noticeToProceed,
            duration: planBasis.contractDurationDays,
            asOf: entry.date,
            suspensionDays: planBasis.suspensionDays,
            suspension,
            targetFull,
          }) ?? 0)
        : period
          ? round2(period.cumulativePct)
          : 0;
    const targetPhp =
      settings.curveType === 'pdm_based'
        ? round2((target * totalContractAmount) / 100)
        : period
          ? round2(period.cumulativePhp)
          : 0;
    const variance = Math.round((entry.percent - target) * 100) / 100;
    const st = Math.abs(variance) < 0.05 ? 'on_schedule' : entry.percent > target ? 'ahead' : 'behind';
    return {
      date: entry.date,
      date_label: entry.label,
      target_pct: target,
      target_php: targetPhp,
      actual_pct: entry.percent,
      variance_pct: variance,
      status: st as 'on_schedule' | 'ahead' | 'behind',
      status_label: statusDisplayLabel(st),
    };
  });

  const projectEndDate = revisedPeriods
    ? suspension?.revisedCompletion ||
      revisedPeriods[revisedPeriods.length - 1]?.endDate ||
      addDays(start, duration)
    : ctx.projectPlannedEnd || displayPeriods[displayPeriods.length - 1]?.endDate || addDays(start, duration);

  return {
    project_id: id,
    project_duration: duration,
    project_start_date: start,
    project_end_date: projectEndDate,
    critical_path: schedule.criticalPath,
    points,
    activities,
    cost_items: costSummary.items,
    periods: displayPeriods,
    period_edits: periodEdits,
    total_contract_amount: costSummary.totalContractAmount,
    total_weight_pct: costSummary.totalWeightPct,
    synced_from_pdm: schedule.activities.length > 0,
    has_actual_progress: chronological.length >= 1,
    has_revised_schedule: settings.curveType === 'pdm_based' || revisedPeriods != null,
    schedule_status: status,
    comparisons: comparisonRows,
    report_feed: feed,
    latest_report_percent: actualPct ?? effectiveTarget,
    latest_report_date:
      snapshotReportingDate ||
      latestReport?.date ||
      (chronological.length ? chronological[chronological.length - 1].date : null),
    reporting_interval: settings.reportingInterval,
    curve_type: settings.curveType,
    theoretical_total_periods: periodCountCustomized
      ? settings.theoreticalTotalPeriods
      : Math.max(1, displayPeriods.length),
    theoretical_duration_days: periodCountCustomized
      ? settings.theoreticalTotalPeriods * intervalDays(settings.reportingInterval)
      : settings.curveType === 'ideal_theoretical'
        ? Math.max(1, displayPeriods.length) * intervalDays(settings.reportingInterval)
        : settings.theoreticalDurationDays,
    target_plan_percent: effectiveTarget,
    target_plan_php: effectiveTargetPhp,
    actual_plan_percent: actualPct,
    versions:
      settings.curveType === 'pdm_based'
        ? retargetPdmVersions(presentSCurveVersions(versions as SCurveSnapshotSummary[], feed), {
            noticeToProceed: planBasis.noticeToProceed,
            duration: planBasis.contractDurationDays,
            suspensionDays: planBasis.suspensionDays,
            suspension,
            targetFull,
          })
        : presentSCurveVersions(versions as SCurveSnapshotSummary[], feed),
    viewing_snapshot_id: snapshotId != null ? asId(snapshotId) : null,
    viewing_snapshot_label:
      (snapshotId != null
        ? presentSCurveVersions(versions as SCurveSnapshotSummary[], feed).find(
            (version) => version.id === asId(snapshotId),
          )?.trigger_label
        : null) ?? snapshotLabel,
    viewing_snapshot_at: snapshotData?.capturedAt != null ? String(snapshotData.capturedAt) : null,
  };
}

function sourceSnapshotId(reportId: string): string {
  return `src_${reportId}`;
}

/** One snapshot document per SWA/STEWA. A later explicit generate updates that same version. */
async function writeReportSCurveSnapshot(args: {
  projectId: string;
  report: ReportProgressEntry;
  curve: Awaited<ReturnType<typeof getSCurveFs>>;
  bumpRevision: boolean;
}) {
  if (!args.report.id) {
    throw new Error('Choose an SWA or STEWA reporting period.');
  }
  const ref = doc(db, sCurveSnapshotsPath(args.projectId), sourceSnapshotId(args.report.id));
  const existing = await getDoc(ref);
  const previousRevision = existing.exists() ? Number(existing.data().revision ?? 1) || 1 : 0;
  const previousTrigger = existing.exists() ? String(existing.data().triggerType ?? '') : '';
  let revision = 1;
  if (existing.exists()) {
    revision =
      args.bumpRevision && previousTrigger === 'swa_stewa'
        ? previousRevision + 1
        : Math.max(1, previousRevision);
  }
  const asOfLabel = args.report.asOfLabel?.trim() || formatExcelDate(args.report.date);
  const label = sCurveSourceVersionLabel(args.report.reportType, asOfLabel, revision);
  await setDoc(ref, {
    points: args.curve.points,
    capturedAt: nowIso(),
    triggerType: args.bumpRevision || previousTrigger === 'swa_stewa' ? 'swa_stewa' : 'swa_stewa_progress',
    triggerLabel: label,
    asOfDate: args.report.date,
    asOfLabel,
    sourceReportId: args.report.id,
    sourceReportType: args.report.reportType,
    sourceReportNumber: args.report.reportNumber,
    revision,
    basis: args.curve.has_revised_schedule ? 'revised' : 'pdm',
    scheduleStatus: args.curve.schedule_status.status,
    slippagePct: args.curve.schedule_status.slippage_pct,
    plannedPct: args.curve.schedule_status.planned_pct,
    actualPct: args.curve.schedule_status.actual_pct,
  });
  return { id: ref.id, label, asOfDate: args.report.date, asOfLabel, revision };
}

/** Rebuild and persist S-Curve after SWA/STEWA approve/update. */
export async function syncProgressCharts(projectId: string) {
  invalidateChartCaches(projectId);
  const curve = await getSCurveFs(projectId);
  const latest = curve.report_feed.find(
    (entry) => (entry.reportType === 'SWA' || entry.reportType === 'STEWA') && entry.id,
  );
  if (latest?.id) {
    await writeReportSCurveSnapshot({
      projectId,
      report: latest,
      curve,
      bumpRevision: false,
    });
  }
  invalidateChartCaches(projectId);
  return curve;
}

export async function recordSCurveSnapshot(
  projectId: string,
  meta: {
    triggerType: string;
    triggerLabel?: string;
    scheduleStatus?: string;
    slippagePct?: number | null;
    plannedPct?: number | null;
    actualPct?: number | null;
  },
) {
  const curve = await getSCurveFs(projectId);
  const ref = doc(collection(db, sCurveSnapshotsPath(projectId)));
  await setDoc(ref, {
    points: curve.points,
    capturedAt: nowIso(),
    triggerType: meta.triggerType,
    triggerLabel: meta.triggerLabel ?? null,
    scheduleStatus: meta.scheduleStatus ?? curve.schedule_status.status,
    slippagePct: meta.slippagePct ?? curve.schedule_status.slippage_pct,
    plannedPct: meta.plannedPct ?? curve.schedule_status.planned_pct,
    actualPct: meta.actualPct ?? curve.schedule_status.actual_pct,
  });
  invalidateChartCaches(projectId);
  return ref.id;
}

/** Store the S-Curve for one SWA/STEWA. Its reporting date comes from that report. */
export async function generateSwaStewaSCurveFs(projectId: string | number, reportId: string) {
  const id = asId(projectId);
  if (!reportId) {
    throw new Error('Choose an SWA or STEWA reporting period.');
  }
  const curve = await getSCurveFs(id, null, undefined, { throughReportId: reportId });
  const report = curve.report_feed.find((entry) => entry.id === reportId);
  if (!report?.id || (report.reportType !== 'SWA' && report.reportType !== 'STEWA')) {
    throw new Error('Choose an SWA or STEWA that belongs to this project.');
  }
  const saved = await writeReportSCurveSnapshot({
    projectId: id,
    report,
    curve,
    bumpRevision: true,
  });
  invalidateChartCaches(id);
  return saved;
}

export async function saveSCurveCostItemsFs(payload: {
  project_id: string | number;
  items: Array<{ activityId: string; itemNo?: string; description?: string; quantity: number; unitCost: number }>;
}) {
  await assertCanEditProjectCharts();
  const id = asId(payload.project_id);
  const ctx = await loadProjectChartContext(id);
  const schedule = ctx.schedule;
  const incomingByActivityId = new Map(payload.items.map((item) => [item.activityId, item]));
  const summary = computeSCurveCostSummary(
    schedule.activities.map((activity): SCurveCostItemInput => {
      const incoming = incomingByActivityId.get(activity.id);
      return {
        activityId: activity.id,
        itemNo: incoming && incoming.itemNo != null ? String(incoming.itemNo) : activity.number,
        description: incoming && incoming.description != null ? String(incoming.description) : activity.name,
        quantity: Number(incoming?.quantity ?? 0),
        unitCost: Number(incoming?.unitCost ?? 0),
      };
    }),
  );

  await setDoc(
    doc(db, COLLECTIONS.sCurves, id),
    {
      projectId: id,
      costItems: summary.items.map((item) => ({
        activityId: item.activityId,
        itemNo: item.itemNo,
        description: item.description,
        quantity: item.quantity,
        unitCost: item.unitCost,
      })),
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  invalidateChartCaches(id);

  return {
    cost_items: summary.items as SCurveCostItem[],
    total_contract_amount: summary.totalContractAmount,
    total_weight_pct: summary.totalWeightPct,
  };
}

export async function saveSCurvePeriodsFs(payload: {
  project_id: string | number;
  theoretical_total_periods?: number;
  period_edits?: Record<string, SCurvePeriodEdit>;
}) {
  const access = await getAccessContext();
  if (!canEditSCurvePeriods(access?.role)) {
    throw new Error('You cannot edit S-Curve periods for this project.');
  }
  const id = asId(payload.project_id);
  const patch: Record<string, unknown> = {
    projectId: id,
    periodsCustomized: true,
    updatedAt: nowIso(),
  };
  if (payload.theoretical_total_periods != null) {
    patch.theoreticalTotalPeriods = Math.max(1, Math.floor(Number(payload.theoretical_total_periods) || 1));
    patch.periodCountCustomized = true;
  }
  if (payload.period_edits) {
    patch.periodEdits = payload.period_edits;
  }
  await setDoc(doc(db, COLLECTIONS.sCurves, id), patch, { merge: true });
  invalidateChartCaches(id);
  return {
    theoretical_total_periods:
      payload.theoretical_total_periods != null
        ? Math.max(1, Math.floor(Number(payload.theoretical_total_periods) || 1))
        : null,
    period_edits: payload.period_edits ?? null,
  };
}

export async function saveSCurveSettingsFs(payload: {
  project_id: string | number;
  curve_type: SCurveType;
  reporting_interval: SCurveReportingInterval;
  theoretical_total_periods?: number;
}) {
  await assertCanEditProjectCharts();
  const id = asId(payload.project_id);
  const ctx = await loadProjectChartContext(id);
  const schedule = ctx.schedule;
  const normalized = normalizeSCurveSettings(
    {
      activeCurveType: payload.curve_type,
      reportingInterval: payload.reporting_interval,
      theoreticalTotalPeriods:
        payload.theoretical_total_periods ??
        Math.max(
          1,
          Math.ceil(Math.max(1, schedule.projectDuration) / intervalDays(payload.reporting_interval)),
        ),
    },
    schedule.projectDuration,
  );

  await setDoc(
    doc(db, COLLECTIONS.sCurves, id),
    {
      projectId: id,
      activeCurveType: normalized.curveType,
      reportingInterval: normalized.reportingInterval,
      theoreticalTotalPeriods: normalized.theoreticalTotalPeriods,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  invalidateChartCaches(id);

  return {
    curve_type: normalized.curveType,
    reporting_interval: normalized.reportingInterval,
    theoretical_total_periods: normalized.theoreticalTotalPeriods,
    theoretical_duration_days: normalized.theoreticalDurationDays,
  };
}
