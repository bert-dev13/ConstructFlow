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
  buildSCurvePeriods,
  buildTheoreticalSCurvePeriods,
  intervalDays,
  periodIndexForDate,
  type SCurveReportingInterval,
  type SCurvePeriodRow,
} from '../sCurvePeriods';
import {
  compareTargetVsActual,
  resolveTargetAndActual,
  statusDisplayLabel,
} from '../progressStatus';
import { COLLECTIONS, sCurveSnapshotsPath } from './collections';
import { db } from './config';
import { asId, nowIso } from './ids';
import {
  invalidateChartCaches,
  loadProjectChartContext,
  loadSCurveVersions,
} from './chartContext';
import { listProjectBoq } from './projectBoq';
import { normalizePayItemNo } from './payItems';

interface StoredSCurveCostItem {
  activityId: string;
  quantity: number;
  unitCost: number;
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
    const period = periodForDate(startDate, periods, entry.date, reportingInterval);
    const targetPct = period ? round2(period.cumulativePct) : null;
    const targetPhp = period ? round2(period.cumulativePhp) : null;
    const existing = points.get(entry.date);
    if (existing) {
      existing.actual = entry.percent;
      if (!existing.label || existing.label.startsWith('Month')) {
        existing.label = entry.label;
      }
      if (targetPct != null && existing.originalPlan == null) {
        existing.originalPlan = targetPct;
        existing.currentPlan = targetPct;
      }
      if (period) {
        existing.periodLabel = period.label;
        existing.targetAccomplishmentPct = round2(period.targetAccomplishmentPct);
        existing.targetAccomplishmentPhp = round2(period.targetAccomplishmentPhp);
        existing.cumulativePct = round2(period.cumulativePct);
        existing.cumulativePhp = round2(period.cumulativePhp);
      }
    } else {
      points.set(entry.date, {
        date: entry.date,
        pointDate: entry.date,
        label: entry.label,
        originalPlan: targetPct,
        currentPlan: targetPct,
        actual: entry.percent,
        periodLabel: period?.label ?? null,
        targetAccomplishmentPct: period ? round2(period.targetAccomplishmentPct) : null,
        targetAccomplishmentPhp: targetPhp,
        cumulativePct: targetPct,
        cumulativePhp: targetPhp,
      });
    }
  }

  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getSCurveFs(
  projectId: string | number,
  snapshotId?: string | number | null,
  reportingInterval?: SCurveReportingInterval,
) {
  const id = asId(projectId);

  // One shared context for the selected project + versions in parallel.
  const [ctx, versions, snapshotPoints] = await Promise.all([
    loadProjectChartContext(id),
    loadSCurveVersions(id),
    snapshotId != null && asId(snapshotId)
      ? getDoc(doc(db, sCurveSnapshotsPath(id), asId(snapshotId)))
          .then((snap) =>
            snap.exists()
              ? ((snap.data() as Record<string, unknown>).points as SCurvePoint[] | undefined) ??
                null
              : null,
          )
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const schedule = ctx.schedule;
  const feed = ctx.feed;
  const { actualPct, latestReport, chronological } = resolveTargetAndActual(feed);
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

  // Only hit BOQ when cost rows are missing for PDM activities (keeps full seeding intact).
  const needsBoq =
    schedule.activities.length > 0 &&
    schedule.activities.some((activity) => !storedCostByActivityId.has(activity.id));

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
        itemNo: activity.number,
        description: activity.name,
        quantity: Number(stored?.quantity ?? fromBoq?.programmedQty ?? 0),
        unitCost: Number(stored?.unitCost ?? fromBoq?.unitPrice ?? 0),
      };
    }),
  );
  const periods =
    settings.curveType === 'ideal_theoretical'
      ? buildTheoreticalSCurvePeriods({
          startDate: start,
          totalPeriods: settings.theoreticalTotalPeriods,
          totalContractAmount: costSummary.totalContractAmount,
          reportingInterval: settings.reportingInterval,
        })
      : buildSCurvePeriods({
          startDate: start,
          projectDuration: duration,
          activities: schedule.activities,
          costItems: costSummary.items,
          totalContractAmount: costSummary.totalContractAmount,
          reportingInterval: settings.reportingInterval,
        });
  const activities: SCurveActivity[] = schedule.activities.map((activity) => {
    const finishDate = addDays(start, activity.ef ?? activity.duration);
    const period = periodForDate(start, periods, finishDate, settings.reportingInterval);
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
    periods,
    chronological.map((e) => ({ date: e.date, percent: e.percent, label: e.label })),
    settings.reportingInterval,
  );
  const latestTargetPeriod = periodForDate(
    start,
    periods,
    latestReport?.date ?? nowIso().slice(0, 10),
    settings.reportingInterval,
  );
  const effectiveTarget = latestTargetPeriod ? round2(latestTargetPeriod.cumulativePct) : null;
  const effectiveTargetPhp = latestTargetPeriod ? round2(latestTargetPeriod.cumulativePhp) : null;

  if (snapshotPoints) {
    points = snapshotPoints;
  } else {
    // Persist in the background — do not block the page render on Firestore write.
    void setDoc(
      doc(db, COLLECTIONS.sCurves, id),
      {
        projectId: id,
        points,
        costItems: schedule.activities.map((activity) => ({
          activityId: activity.id,
          quantity: Number(storedCostByActivityId.get(activity.id)?.quantity ?? 0),
          unitCost: Number(storedCostByActivityId.get(activity.id)?.unitCost ?? 0),
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
      /* reviewers cannot write; ignore */
    });
  }

  const status = compareTargetVsActual(effectiveTarget, actualPct);

  const comparisonRows: SCurveComparison[] =
    chronological.length >= 2
      ? chronological.slice(1).map((e) => {
          const period = periodForDate(start, periods, e.date, settings.reportingInterval);
          const target = period ? round2(period.cumulativePct) : 0;
          const targetPhp = period ? round2(period.cumulativePhp) : 0;
          const variance = Math.round((e.percent - target) * 100) / 100;
          const st =
            Math.abs(variance) < 0.05 ? 'on_schedule' : e.percent > target ? 'ahead' : 'behind';
          return {
            date: e.date,
            date_label: e.label,
            target_pct: target,
            target_php: targetPhp,
            actual_pct: e.percent,
            variance_pct: variance,
            status: st as 'on_schedule' | 'ahead' | 'behind',
            status_label: statusDisplayLabel(st),
          };
        })
      : chronological.length === 1
        ? [
            {
              date: chronological[0].date,
              date_label: chronological[0].label,
              target_pct: effectiveTarget ?? chronological[0].percent,
              target_php: effectiveTargetPhp ?? 0,
              actual_pct: chronological[0].percent,
              variance_pct: round2(
                chronological[0].percent - (effectiveTarget ?? chronological[0].percent),
              ),
              status:
                Math.abs(
                  chronological[0].percent - (effectiveTarget ?? chronological[0].percent),
                ) < 0.05
                  ? ('on_schedule' as const)
                  : chronological[0].percent > (effectiveTarget ?? chronological[0].percent)
                    ? ('ahead' as const)
                    : ('behind' as const),
              status_label:
                Math.abs(
                  chronological[0].percent - (effectiveTarget ?? chronological[0].percent),
                ) < 0.05
                  ? 'On Track'
                  : chronological[0].percent > (effectiveTarget ?? chronological[0].percent)
                    ? 'Ahead'
                    : 'Behind',
            },
          ]
        : [];

  const projectEndDate =
    ctx.projectPlannedEnd || periods[periods.length - 1]?.endDate || addDays(start, duration);

  return {
    project_id: id,
    project_duration: duration,
    project_start_date: start,
    project_end_date: projectEndDate,
    critical_path: schedule.criticalPath,
    points,
    activities,
    cost_items: costSummary.items,
    periods,
    total_contract_amount: costSummary.totalContractAmount,
    total_weight_pct: costSummary.totalWeightPct,
    synced_from_pdm: schedule.activities.length > 0,
    has_actual_progress: chronological.length >= 2,
    has_revised_schedule: false,
    schedule_status: status,
    comparisons: comparisonRows,
    report_feed: feed,
    latest_report_percent: actualPct ?? effectiveTarget,
    latest_report_date: chronological.length
      ? chronological[chronological.length - 1].date
      : null,
    reporting_interval: settings.reportingInterval,
    curve_type: settings.curveType,
    theoretical_total_periods: settings.theoreticalTotalPeriods,
    theoretical_duration_days: settings.theoreticalDurationDays,
    target_plan_percent: effectiveTarget,
    target_plan_php: effectiveTargetPhp,
    actual_plan_percent: actualPct,
    versions: versions as SCurveSnapshotSummary[],
    viewing_snapshot_id: snapshotId != null ? asId(snapshotId) : null,
    viewing_snapshot_label: null as string | null,
    viewing_snapshot_at: null as string | null,
  };
}

/** Rebuild and persist S-Curve after SWA/STEWA approve/update. */
export async function syncProgressCharts(projectId: string) {
  invalidateChartCaches(projectId);
  const curve = await getSCurveFs(projectId);
  const ref = doc(collection(db, sCurveSnapshotsPath(projectId)));
  await setDoc(ref, {
    points: curve.points,
    capturedAt: nowIso(),
    triggerType: 'swa_stewa_progress',
    triggerLabel: curve.latest_report_date ?? 'progress',
    scheduleStatus: curve.schedule_status.status,
    slippagePct: curve.schedule_status.slippage_pct,
    plannedPct: curve.schedule_status.planned_pct,
    actualPct: curve.schedule_status.actual_pct,
  });
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

export async function saveSCurveCostItemsFs(payload: {
  project_id: string | number;
  items: Array<{ activityId: string; quantity: number; unitCost: number }>;
}) {
  const id = asId(payload.project_id);
  const ctx = await loadProjectChartContext(id);
  const schedule = ctx.schedule;
  const incomingByActivityId = new Map(payload.items.map((item) => [item.activityId, item]));
  const summary = computeSCurveCostSummary(
    schedule.activities.map(
      (activity): SCurveCostItemInput => ({
        activityId: activity.id,
        itemNo: activity.number,
        description: activity.name,
        quantity: Number(incomingByActivityId.get(activity.id)?.quantity ?? 0),
        unitCost: Number(incomingByActivityId.get(activity.id)?.unitCost ?? 0),
      }),
    ),
  );

  await setDoc(
    doc(db, COLLECTIONS.sCurves, id),
    {
      projectId: id,
      costItems: summary.items.map((item) => ({
        activityId: item.activityId,
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

export async function saveSCurveSettingsFs(payload: {
  project_id: string | number;
  curve_type: SCurveType;
  reporting_interval: SCurveReportingInterval;
  theoretical_total_periods?: number;
}) {
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
