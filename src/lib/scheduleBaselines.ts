import type { BarChartTask, PdmActivity, SCurvePoint } from '../types';
import {
  activityDaySpan,
  buildSCurvePeriods,
  type SCurvePeriodRow,
  type SCurveReportingInterval,
} from './sCurvePeriods';
import type { SCurveCostItem } from './sCurveItems';

export type ProjectBaselineMode = 'active' | 'prior_suspension';

export interface SuspensionWindow {
  start: string;
  end: string;
  revisedCompletion: string;
}

function addCalendarDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function revisedSegments(startDay: number, endDay: number, suspStartDay: number, suspLen: number) {
  if (endDay < suspStartDay) return [{ start: startDay, end: endDay }];
  if (startDay >= suspStartDay) {
    return [{ start: startDay + suspLen, end: endDay + suspLen }];
  }
  return [
    { start: startDay, end: suspStartDay - 1 },
    { start: suspStartDay + suspLen, end: endDay + suspLen },
  ];
}

/** Revised cumulative on a calendar day. Suspension days stay at the pre-suspension value. */
export function revisedCumulativeOnDay(input: {
  projectStart: string;
  activities: PdmActivity[];
  costItems: SCurveCostItem[];
  suspension: SuspensionWindow;
  date: string;
}): number {
  const day = inclusiveDayCount(input.projectStart, input.date);
  const suspStartDay = inclusiveDayCount(input.projectStart, input.suspension.start);
  const suspLen = inclusiveDayCount(input.suspension.start, input.suspension.end);
  const suspEndDay = suspStartDay + suspLen - 1;
  const asOf = day >= suspStartDay && day <= suspEndDay ? suspStartDay - 1 : day;
  const weightById = new Map(input.costItems.map((item) => [item.activityId, item.weightPct]));
  let total = 0;
  for (const activity of input.activities) {
    const weight = weightById.get(activity.id) ?? 0;
    if (weight <= 0) continue;
    const { startDay, endDay } = activityDaySpan(activity);
    const segments = revisedSegments(startDay, endDay, suspStartDay, suspLen);
    const workingDays = segments.reduce((sum, segment) => sum + (segment.end - segment.start + 1), 0);
    if (workingDays <= 0) continue;
    let elapsed = 0;
    for (const segment of segments) {
      if (asOf < segment.start) continue;
      elapsed += Math.max(0, Math.min(segment.end, asOf) - segment.start + 1);
    }
    total += (weight * elapsed) / workingDays;
  }
  return Math.min(100, Math.round(total * 100) / 100);
}

/**
 * Chart points follow period ends, so a period that straddles the suspension
 * would slope through the gap. Pin the cumulative on the suspension boundaries.
 */
export function flattenSuspensionPoints(
  points: SCurvePoint[],
  originalPeriods: SCurvePeriodRow[],
  projectStart: string,
  activities: PdmActivity[],
  costItems: SCurveCostItem[],
  suspension: SuspensionWindow,
): SCurvePoint[] {
  const frozen = revisedCumulativeOnDay({
    projectStart,
    activities,
    costItems,
    suspension,
    date: addCalendarDays(suspension.start, -1),
  });
  const next = points.map((point) =>
    point.date >= suspension.start && point.date <= suspension.end
      ? { ...point, currentPlan: frozen }
      : point,
  );
  for (const date of [suspension.start, suspension.end]) {
    if (next.some((point) => point.date === date)) continue;
    next.push({
      date,
      originalPlan: Math.round(cumulativeAtDate(originalPeriods, date) * 100) / 100,
      currentPlan: frozen,
      actual: null,
    });
  }
  next.sort((a, b) => a.date.localeCompare(b.date));
  return next;
}

/** Inclusive calendar day count. Day 1 is `start`. */
export function inclusiveDayCount(start: string, end: string): number {
  const s = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 1;
  return Math.round((e - s) / 86_400_000) + 1;
}

export function readSuspensionWindow(input: {
  baselineMode?: string | null;
  suspensionStart?: string | null;
  suspensionEnd?: string | null;
  revisedCompletion?: string | null;
}): SuspensionWindow | null {
  if (input.baselineMode !== 'prior_suspension') return null;
  const start = input.suspensionStart?.slice(0, 10) ?? '';
  const end = input.suspensionEnd?.slice(0, 10) ?? '';
  const revisedCompletion = input.revisedCompletion?.slice(0, 10) ?? '';
  if (!start || !end || !revisedCompletion || end < start) return null;
  return { start, end, revisedCompletion };
}

/**
 * Revised baseline periods.
 * Original PDM days are kept. The suspension is a gap with no accomplishment.
 * Work that has not started by the suspension shifts forward by the suspension
 * length. Work that crosses the gap is split so no weight falls inside it.
 * The curve ends on the revised completion date.
 */
export function buildRevisedBaselinePeriods(input: {
  projectStart: string;
  activities: PdmActivity[];
  costItems: SCurveCostItem[];
  totalContractAmount: number;
  reportingInterval: SCurveReportingInterval;
  suspension: SuspensionWindow;
}): SCurvePeriodRow[] {
  const suspStartDay = inclusiveDayCount(input.projectStart, input.suspension.start);
  const suspLen = inclusiveDayCount(input.suspension.start, input.suspension.end);
  const revisedSpan = inclusiveDayCount(input.projectStart, input.suspension.revisedCompletion);
  const weightById = new Map(input.costItems.map((item) => [item.activityId, item]));
  const activities: PdmActivity[] = [];
  const costItems: SCurveCostItem[] = [];

  for (const activity of input.activities) {
    const source = weightById.get(activity.id);
    const weight = source?.weightPct ?? 0;
    const { startDay, endDay } = activityDaySpan(activity);
    const baseItem = source ?? {
      activityId: activity.id,
      itemNo: activity.number,
      description: activity.name,
      quantity: 0,
      unitCost: 0,
      amount: 0,
      weightPct: 0,
    };

    const push = (id: string, spanStart: number, spanEnd: number, portion: number) => {
      const clampedEnd = Math.max(spanStart, Math.min(revisedSpan, spanEnd));
      if (clampedEnd < spanStart || spanStart > revisedSpan) return;
      activities.push({
        ...activity,
        id,
        es: spanStart - 1,
        ef: clampedEnd,
        duration: clampedEnd - spanStart + 1,
      });
      costItems.push({
        ...baseItem,
        activityId: id,
        weightPct: portion,
      });
    };

    if (endDay < suspStartDay) {
      push(activity.id, startDay, endDay, weight);
      continue;
    }
    if (startDay >= suspStartDay) {
      push(activity.id, startDay + suspLen, endDay + suspLen, weight);
      continue;
    }

    const beforeDays = suspStartDay - startDay;
    const afterDays = endDay - suspStartDay + 1;
    const working = Math.max(1, beforeDays + afterDays);
    const beforeWeight = (weight * beforeDays) / working;
    push(`${activity.id}:pre`, startDay, suspStartDay - 1, beforeWeight);
    push(`${activity.id}:post`, suspStartDay + suspLen, endDay + suspLen, weight - beforeWeight);
  }

  return buildSCurvePeriods({
    startDate: input.projectStart,
    projectDuration: Math.max(1, revisedSpan),
    activities,
    costItems,
    totalContractAmount: input.totalContractAmount,
    reportingInterval: input.reportingInterval,
  });
}

/** Last planned cumulative at `date`. A date inside the suspension keeps the pre-suspension value. */
export function cumulativeAtDate(periods: SCurvePeriodRow[], date: string): number {
  if (!periods.length || date < periods[0].startDate) return 0;
  let last = 0;
  for (const period of periods) {
    if (period.endDate <= date) last = period.cumulativePct;
    if (period.startDate <= date && date <= period.endDate) return period.cumulativePct;
  }
  return last;
}

/** Keep the revised curve as currentPlan and stamp the unshifted PDM curve as originalPlan. */
export function stampOriginalPlan(
  points: SCurvePoint[],
  originalPeriods: SCurvePeriodRow[],
  revisedPeriods: SCurvePeriodRow[],
): SCurvePoint[] {
  const stamped = points.map((point) => ({
    ...point,
    currentPlan: point.originalPlan,
    originalPlan: Math.round(cumulativeAtDate(originalPeriods, point.date) * 100) / 100,
  }));
  const seen = new Set(stamped.map((point) => point.date));
  for (const period of originalPeriods) {
    if (seen.has(period.endDate)) continue;
    stamped.push({
      date: period.endDate,
      originalPlan: Math.round(period.cumulativePct * 100) / 100,
      currentPlan: Math.round(cumulativeAtDate(revisedPeriods, period.endDate) * 100) / 100,
      actual: null,
    });
  }
  stamped.sort((a, b) => a.date.localeCompare(b.date));
  return stamped;
}

/** Original PDM bars with actuals cleared. The baseline does not follow SWA/STEWA. */
export function originalBarChartTasks(activities: PdmActivity[]): BarChartTask[] {
  return activities.map((activity, index) => {
    const { startDay, endDay } = activityDaySpan(activity);
    return {
      id: activity.id,
      index: index + 1,
      name: activity.name,
      startDay,
      endDay,
      actualEndDay: null,
      isCritical: !!activity.isCritical,
    };
  });
}

/**
 * Revised bars. Durations stay the same. Work at or after the suspension
 * shifts by the suspension length. A bar that crosses the gap is split so
 * the suspension days stay empty.
 */
export function revisedBarChartTasks(
  activities: PdmActivity[],
  projectStart: string,
  suspension: SuspensionWindow,
): { tasks: BarChartTask[]; totalDays: number } {
  const suspStartDay = inclusiveDayCount(projectStart, suspension.start);
  const suspLen = inclusiveDayCount(suspension.start, suspension.end);
  const totalDays = inclusiveDayCount(projectStart, suspension.revisedCompletion);
  const tasks: BarChartTask[] = [];

  const push = (id: string, name: string, startDay: number, endDay: number, isCritical: boolean) => {
    const start = Math.max(1, Math.min(totalDays, startDay));
    const end = Math.max(start, Math.min(totalDays, endDay));
    tasks.push({
      id,
      index: tasks.length + 1,
      name,
      startDay: start,
      endDay: end,
      actualEndDay: null,
      isCritical,
    });
  };

  for (const activity of activities) {
    const { startDay, endDay } = activityDaySpan(activity);
    if (endDay < suspStartDay) {
      push(activity.id, activity.name, startDay, endDay, !!activity.isCritical);
    } else if (startDay >= suspStartDay) {
      push(activity.id, activity.name, startDay + suspLen, endDay + suspLen, !!activity.isCritical);
    } else {
      push(`${activity.id}:pre`, activity.name, startDay, suspStartDay - 1, !!activity.isCritical);
      push(
        `${activity.id}:post`,
        activity.name,
        suspStartDay + suspLen,
        endDay + suspLen,
        !!activity.isCritical,
      );
    }
  }

  return { tasks, totalDays: Math.max(1, totalDays) };
}

/** `S-Curve - August 2026` on the 1st; otherwise `S-Curve - As of September 15, 2026`. */
export function sCurveRecordLabel(asOfDate: string): string {
  const date = new Date(`${asOfDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'S-Curve';
  const month = date.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = date.getUTCFullYear();
  if (date.getUTCDate() === 1) return `S-Curve - ${month} ${year}`;
  const pretty = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `S-Curve - As of ${pretty}`;
}

/** `SWA – As of July 6–10, 2026`, with a revision only after an intentional regenerate. */
export function sCurveSourceVersionLabel(
  reportType: string,
  asOfText: string,
  revision = 1,
): string {
  const type = reportType === 'STEWA' ? 'STEWA' : reportType === 'SWA' ? 'SWA' : reportType;
  const period = asOfText.trim() || 'undated';
  const base = `${type} – As of ${period}`;
  const rev = Math.max(1, Math.floor(revision) || 1);
  return rev > 1 ? `${base} (rev ${rev})` : base;
}

const LABEL_MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function isoFromParts(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** End date of a stored or legacy version label, used to sort history. */
export function reportingDateFromSCurveLabel(label: string): string | null {
  const text = label
    .replace(/\s*\(rev\s+\d+\)\s*$/i, '')
    .replace(/^S-Curve\s*-\s*/i, '')
    .replace(/^(SWA|STEWA)\s*[–-]\s*/i, '')
    .replace(/^As of\s+/i, '')
    .trim();
  if (!text) return null;

  const crossYear = text.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (crossYear) {
    const month = LABEL_MONTHS[crossYear[4].toLowerCase()];
    return isoFromParts(Number(crossYear[6]), month, Number(crossYear[5]));
  }

  const crossMonth = text.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (crossMonth) {
    const month = LABEL_MONTHS[crossMonth[3].toLowerCase()];
    return isoFromParts(Number(crossMonth[5]), month, Number(crossMonth[4]));
  }

  const sameMonth = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*(\d{1,2}),?\s+(\d{4})$/);
  if (sameMonth) {
    const month = LABEL_MONTHS[sameMonth[1].toLowerCase()];
    return isoFromParts(Number(sameMonth[4]), month, Number(sameMonth[3]));
  }

  const single = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (single) {
    const month = LABEL_MONTHS[single[1].toLowerCase()];
    return isoFromParts(Number(single[3]), month, Number(single[2]));
  }

  const monthYear = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const month = LABEL_MONTHS[monthYear[1].toLowerCase()];
    return isoFromParts(Number(monthYear[2]), month, 1);
  }
  return null;
}

export interface SCurveVersionIdentity {
  id: string;
  captured_at: string;
  trigger_label: string | null;
  as_of_date: string;
  source_report_id: string | null;
}

/** One row per source report. Legacy snapshots with the same label or date collapse to the newest. */
export function dedupeAndSortSCurveVersions<T extends SCurveVersionIdentity>(versions: T[]): T[] {
  const newestByKey = new Map<string, T>();
  for (const version of versions) {
    const key = version.source_report_id
      ? `report:${version.source_report_id}`
      : `legacy:${version.as_of_date || (version.trigger_label ?? version.id).trim().toLowerCase()}`;
    const current = newestByKey.get(key);
    if (!current || version.captured_at > current.captured_at) newestByKey.set(key, version);
  }

  const sourcedDates = new Set(
    [...newestByKey.values()]
      .filter((version) => version.source_report_id && version.as_of_date)
      .map((version) => version.as_of_date),
  );

  return [...newestByKey.values()]
    .filter(
      (version) =>
        Boolean(version.source_report_id) || !version.as_of_date || !sourcedDates.has(version.as_of_date),
    )
    .sort((a, b) => {
      const byDate = (b.as_of_date || b.captured_at).localeCompare(a.as_of_date || a.captured_at);
      return byDate !== 0 ? byDate : b.captured_at.localeCompare(a.captured_at);
    });
}
