import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import type { SCurvePoint } from '../../types';
import type {
  SCurveActivity,
  SCurveComparison,
  SCurveSnapshotSummary,
} from '../sCurveApi';
import {
  compareTargetVsActual,
  resolveTargetAndActual,
  statusDisplayLabel,
} from '../progressStatus';
import { COLLECTIONS, sCurveSnapshotsPath } from './collections';
import { db } from './config';
import { asId, nowIso } from './ids';
import { listApprovedProgressForProject } from './reportProgress';
import { getScheduleFs } from './schedules';
import { getProjectFs } from './projects';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build S-Curve points:
 * - Target Plan (originalPlan) locked from the first SWA/STEWA %
 * - Actual (actual) from each SWA/STEWA progress update over time
 */
export function buildProgressSCurvePoints(
  startDate: string,
  endDate: string,
  targetPct: number | null,
  firstDate: string | null,
  chronological: { date: string; percent: number; label: string }[],
): SCurvePoint[] {
  const points = new Map<string, SCurvePoint>();

  points.set(startDate, {
    date: startDate,
    pointDate: startDate,
    label: 'Project start',
    originalPlan: 0,
    currentPlan: 0,
    actual: null,
  });

  if (targetPct != null && firstDate) {
    // Target Plan holds the first approved progress % from firstDate through end
    const targetDates = new Set<string>([firstDate, endDate]);
    for (const d of targetDates) {
      const existing = points.get(d);
      if (existing) {
        existing.originalPlan = d === startDate ? 0 : targetPct;
        existing.currentPlan = d === startDate ? 0 : targetPct;
        if (d === firstDate) existing.label = 'Target Plan (first SWA/STEWA)';
      } else {
        points.set(d, {
          date: d,
          pointDate: d,
          label: d === firstDate ? 'Target Plan (first SWA/STEWA)' : 'Project end',
          originalPlan: targetPct,
          currentPlan: targetPct,
          actual: null,
        });
      }
    }
    // Ensure end has target
    const endPt = points.get(endDate);
    if (endPt) {
      endPt.originalPlan = targetPct;
      endPt.currentPlan = targetPct;
    }
  } else {
    points.set(endDate, {
      date: endDate,
      pointDate: endDate,
      label: 'Project end',
      originalPlan: 100,
      currentPlan: 100,
      actual: null,
    });
  }

  for (const entry of chronological) {
    const existing = points.get(entry.date);
    if (existing) {
      existing.actual = entry.percent;
      if (!existing.label || existing.label.startsWith('Target')) {
        existing.label = entry.label;
      }
      if (targetPct != null && existing.originalPlan == null) {
        existing.originalPlan = targetPct;
        existing.currentPlan = targetPct;
      }
    } else {
      points.set(entry.date, {
        date: entry.date,
        pointDate: entry.date,
        label: entry.label,
        originalPlan: targetPct,
        currentPlan: targetPct,
        actual: entry.percent,
      });
    }
  }

  if (!points.has(endDate)) {
    points.set(endDate, {
      date: endDate,
      pointDate: endDate,
      label: 'Project end',
      originalPlan: targetPct ?? 100,
      currentPlan: targetPct ?? 100,
      actual: null,
    });
  }

  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getSCurveFs(projectId: string | number, snapshotId?: string | number | null) {
  const id = asId(projectId);
  const { project } = await getProjectFs(id);
  const schedule = await getScheduleFs(id);
  const feed = await listApprovedProgressForProject(id);
  const { targetPct, actualPct, firstReport, chronological } = resolveTargetAndActual(feed);

  const start = project.start_date || nowIso().slice(0, 10);
  const duration = Math.max(1, schedule.projectDuration || 110);
  const end = project.planned_end_date || addDays(start, duration);

  let points = buildProgressSCurvePoints(
    start,
    end,
    targetPct,
    firstReport?.date ?? null,
    chronological.map((e) => ({ date: e.date, percent: e.percent, label: e.label })),
  );

  // Persist live curve so all clients stay in sync
  const curveRef = doc(db, COLLECTIONS.sCurves, id);
  const existingCurve = await getDoc(curveRef);
  const lockedTarget =
    (existingCurve.exists()
      ? (existingCurve.data() as Record<string, unknown>).targetPlanPct
      : null) ?? targetPct;

  // Prefer locked target if already set (first wins)
  const effectiveTarget =
    lockedTarget != null && !Number.isNaN(Number(lockedTarget))
      ? Number(lockedTarget)
      : targetPct;

  if (effectiveTarget !== targetPct && effectiveTarget != null) {
    points = buildProgressSCurvePoints(
      start,
      end,
      effectiveTarget,
      firstReport?.date ?? null,
      chronological.map((e) => ({ date: e.date, percent: e.percent, label: e.label })),
    );
  }

  if (snapshotId != null && asId(snapshotId)) {
    const snapDoc = await getDoc(doc(db, sCurveSnapshotsPath(id), asId(snapshotId)));
    if (snapDoc.exists()) {
      const data = snapDoc.data() as Record<string, unknown>;
      points = (data.points as SCurvePoint[]) ?? points;
    }
  } else {
    await setDoc(
      curveRef,
      {
        projectId: id,
        points,
        targetPlanPct: effectiveTarget,
        actualPlanPct: actualPct,
        baselineReportNumber: firstReport?.reportNumber ?? null,
        updatedAt: nowIso(),
      },
      { merge: true },
    );
  }

  const activities: SCurveActivity[] = schedule.activities.map((a) => ({
    number: a.number,
    name: a.name,
    duration: a.duration,
    es: a.es ?? 0,
    ef: a.ef ?? a.duration,
    finish_date: addDays(start, a.ef ?? a.duration),
    planned_pct: 0,
    is_critical: !!a.isCritical,
  }));

  const status = compareTargetVsActual(effectiveTarget, actualPct);

  const comparisonRows: SCurveComparison[] =
    chronological.length >= 2
      ? chronological.slice(1).map((e) => {
          const target = effectiveTarget ?? 0;
          const variance = Math.round((e.percent - target) * 100) / 100;
          const st =
            Math.abs(variance) < 0.05 ? 'on_schedule' : e.percent > target ? 'ahead' : 'behind';
          return {
            date: e.date,
            date_label: e.label,
            target_pct: target,
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
              target_pct: chronological[0].percent,
              actual_pct: chronological[0].percent,
              variance_pct: 0,
              status: 'on_schedule' as const,
              status_label: 'Target Plan set',
            },
          ]
        : [];

  const versionsSnap = await getDocs(collection(db, sCurveSnapshotsPath(id)));
  const versions: SCurveSnapshotSummary[] = versionsSnap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      captured_at: String(data.capturedAt ?? ''),
      trigger_type: String(data.triggerType ?? 'manual'),
      trigger_label: (data.triggerLabel as string | null) ?? null,
      schedule_status: (data.scheduleStatus as string | null) ?? null,
      slippage_pct: data.slippagePct != null ? Number(data.slippagePct) : null,
      planned_pct: data.plannedPct != null ? Number(data.plannedPct) : null,
      actual_pct: data.actualPct != null ? Number(data.actualPct) : null,
    };
  });
  versions.sort((a, b) => b.captured_at.localeCompare(a.captured_at));

  return {
    project_id: id,
    project_duration: duration,
    project_start_date: start,
    project_end_date: end,
    critical_path: schedule.criticalPath,
    points,
    activities,
    synced_from_pdm: schedule.activities.length > 0,
    has_actual_progress: chronological.length >= 2,
    has_revised_schedule: false,
    schedule_status: status,
    comparisons: comparisonRows,
    report_feed: feed,
    latest_report_percent: actualPct ?? targetPct,
    latest_report_date: chronological.length
      ? chronological[chronological.length - 1].date
      : null,
    target_plan_percent: effectiveTarget,
    actual_plan_percent: actualPct,
    versions,
    viewing_snapshot_id: snapshotId != null ? asId(snapshotId) : null,
    viewing_snapshot_label: null as string | null,
    viewing_snapshot_at: null as string | null,
  };
}

/** Rebuild and persist S-Curve after SWA/STEWA approve/update. */
export async function syncProgressCharts(projectId: string) {
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
  return ref.id;
}
