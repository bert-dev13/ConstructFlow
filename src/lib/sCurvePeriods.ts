import type { BarChartTask, PdmActivity } from '../types';
import type { SCurveCostItem } from './sCurveItems';

export type SCurveReportingInterval = '10_day' | '30_day';

export interface SCurvePeriodRow {
  periodIndex: number;
  label: string;
  startDate: string;
  endDate: string;
  targetAccomplishmentPct: number;
  targetAccomplishmentPhp: number;
  cumulativePct: number;
  cumulativePhp: number;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function intervalDays(interval: SCurveReportingInterval): number {
  return interval === '10_day' ? 10 : 30;
}

function periodLabel(interval: SCurveReportingInterval, periodIndex: number): string {
  return interval === '10_day' ? `10-Day ${periodIndex}` : `Month ${periodIndex}`;
}

export function periodIndexForDate(
  startDate: string,
  date: string,
  interval: SCurveReportingInterval = '30_day',
): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const current = new Date(`${date}T00:00:00Z`).getTime();
  const diffDays = Math.max(0, Math.floor((current - start) / 86400000));
  // Day 0 (project start) belongs to period 1; day 30 of a 30-day interval is still period 1.
  return Math.max(1, Math.floor(diffDays / intervalDays(interval)) + 1);
}

/** Inclusive 1-based schedule span — same mapping as bar chart (ES 0-based → startDay). */
export function activityDaySpan(activity: PdmActivity): { startDay: number; endDay: number } {
  const duration = Math.max(1, Math.floor(Number(activity.duration) || 1));
  const es = Math.max(0, Math.floor(Number(activity.es ?? 0) || 0));
  const startDay = es + 1;
  const ef =
    activity.ef != null && Number.isFinite(Number(activity.ef))
      ? Math.floor(Number(activity.ef))
      : es + duration;
  const endDay = Math.max(startDay, ef);
  return { startDay, endDay };
}

function overlapDays(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start + 1);
}

export function buildSCurvePeriods(input: {
  startDate: string;
  projectDuration: number;
  activities: PdmActivity[];
  costItems: SCurveCostItem[];
  totalContractAmount: number;
  reportingInterval?: SCurveReportingInterval;
}): SCurvePeriodRow[] {
  const reportingInterval = input.reportingInterval ?? '30_day';
  const daysPerPeriod = intervalDays(reportingInterval);
  const projectDuration = Math.max(1, Math.floor(input.projectDuration) || 1);
  const periodCount = Math.max(1, Math.ceil(projectDuration / daysPerPeriod));
  const wtByActivityId = new Map(
    input.costItems.map((item) => [item.activityId, item.weightPct]),
  );
  const targetPctByPeriod = new Map<number, number>();

  // Pro-rate each activity's weight across intervals by calendar overlap with
  // its PDM span (ES..EF). Do not dump the full weight into the finish period,
  // and do not count an activity in an interval it does not overlap.
  for (const activity of input.activities) {
    const wt = wtByActivityId.get(activity.id) ?? 0;
    if (wt <= 0) continue;
    const { startDay, endDay } = activityDaySpan(activity);
    const clampedStart = Math.min(projectDuration, startDay);
    const clampedEnd = Math.min(projectDuration, Math.max(clampedStart, endDay));
    const spanDays = clampedEnd - clampedStart + 1;
    if (spanDays <= 0) continue;

    for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
      const periodStartDay = (periodIndex - 1) * daysPerPeriod + 1;
      const periodEndDay = Math.min(projectDuration, periodIndex * daysPerPeriod);
      const overlap = overlapDays(clampedStart, clampedEnd, periodStartDay, periodEndDay);
      if (overlap <= 0) continue;
      const portion = (wt * overlap) / spanDays;
      targetPctByPeriod.set(periodIndex, (targetPctByPeriod.get(periodIndex) ?? 0) + portion);
    }
  }

  let runningCumulativePct = 0;
  const rows: SCurvePeriodRow[] = [];

  for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
    const periodStartDay = (periodIndex - 1) * daysPerPeriod + 1;
    const periodEndDay = Math.min(projectDuration, periodIndex * daysPerPeriod);
    let targetAccomplishmentPct = round4(targetPctByPeriod.get(periodIndex) ?? 0);
    // Snap the final period so cumulative % is exactly 100 (rounding residuals).
    if (periodIndex === periodCount) {
      targetAccomplishmentPct = round4(Math.max(0, 100 - runningCumulativePct));
    }
    runningCumulativePct = round4(runningCumulativePct + targetAccomplishmentPct);
    if (periodIndex === periodCount) runningCumulativePct = 100;
    const targetAccomplishmentPhp = round4(
      (targetAccomplishmentPct * input.totalContractAmount) / 100,
    );
    const cumulativePhp = round4((runningCumulativePct * input.totalContractAmount) / 100);

    rows.push({
      periodIndex,
      label: periodLabel(reportingInterval, periodIndex),
      // Day 1 = project start date; day N = start + (N - 1).
      startDate: addDays(input.startDate, periodStartDay - 1),
      endDate: addDays(input.startDate, periodEndDay - 1),
      targetAccomplishmentPct,
      targetAccomplishmentPhp,
      cumulativePct: runningCumulativePct,
      cumulativePhp,
    });
  }

  return rows;
}

function daysBetweenStartAndEnd(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.max(1, Math.round((end - start) / 86400000));
}

/**
 * Exact theoretical cumulative accomplishment (%):
 * 100 × (1 − cos(π × (Current Period / Total Duration))) / 2
 *
 * Current Period and Total Duration are both in days.
 */
export function theoreticalAccomplishmentPct(
  currentPeriodDays: number,
  totalDurationDays: number,
): number {
  const total = Math.max(1, totalDurationDays);
  const current = Math.max(0, Math.min(total, currentPeriodDays));
  if (current <= 0) return 0;
  if (current >= total) return 100;
  return round4((100 * (1 - Math.cos(Math.PI * (current / total)))) / 2);
}

/**
 * Theoretical S-Curve using the cosine formula over PDM/project duration.
 * Period checkpoints follow the selected 10-day or 30-day reporting interval.
 * Cumulative starts at 0% and reaches exactly 100% when Current Period = Total Duration.
 */
export function buildTheoreticalSCurvePeriods(input: {
  startDate: string;
  projectDuration: number;
  /** Optional Project Details planned end — used when later than PDM duration. */
  endDate?: string | null;
  /** Kept for call-site compatibility; theoretical % does not use activity WT. */
  activities?: PdmActivity[];
  costItems?: SCurveCostItem[];
  totalContractAmount: number;
  reportingInterval?: SCurveReportingInterval;
}): SCurvePeriodRow[] {
  const reportingInterval = input.reportingInterval ?? '30_day';
  const daysPerPeriod = intervalDays(reportingInterval);

  const durationFromEnd = input.endDate
    ? daysBetweenStartAndEnd(input.startDate, input.endDate)
    : 0;
  const totalDuration = Math.max(1, Math.floor(input.projectDuration) || 0, durationFromEnd);
  const periodCount = Math.max(1, Math.ceil(totalDuration / daysPerPeriod));
  const projectEndDate = input.endDate?.trim()
    ? input.endDate.trim()
    : addDays(input.startDate, totalDuration);

  const rows: SCurvePeriodRow[] = [];
  let previousCumulativePct = 0;

  for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
    const periodStartDay = (periodIndex - 1) * daysPerPeriod + 1;
    const periodEndDay = Math.min(totalDuration, periodIndex * daysPerPeriod);
    const isLast = periodIndex === periodCount;

    // Current Period = elapsed days at the end of this reporting interval.
    const currentPeriodDays = isLast ? totalDuration : periodEndDay;
    const cumulativePct = isLast
      ? 100
      : theoreticalAccomplishmentPct(currentPeriodDays, totalDuration);
    const targetAccomplishmentPct = round4(cumulativePct - previousCumulativePct);

    // Amount follows the same interval % as the cosine curve (not activity WT).
    // Cap cumulative peso at the contract amount on the final period.
    const cumulativePhp = isLast
      ? round4(input.totalContractAmount)
      : round4((cumulativePct * input.totalContractAmount) / 100);
    const previousCumulativePhp = round4(
      (previousCumulativePct * input.totalContractAmount) / 100,
    );
    const targetAccomplishmentPhp = round4(cumulativePhp - previousCumulativePhp);

    rows.push({
      periodIndex,
      label: periodLabel(reportingInterval, periodIndex),
      startDate: addDays(input.startDate, periodStartDay - 1),
      endDate: isLast ? projectEndDate : addDays(input.startDate, periodEndDay - 1),
      targetAccomplishmentPct,
      targetAccomplishmentPhp,
      cumulativePct,
      cumulativePhp,
    });
    previousCumulativePct = cumulativePct;
  }

  return rows;
}

export function buildTheoreticalBarChartTasks(input: {
  totalPeriods: number;
  reportingInterval?: SCurveReportingInterval;
}): { tasks: BarChartTask[]; totalDays: number } {
  const reportingInterval = input.reportingInterval ?? '30_day';
  const daysPerPeriod = intervalDays(reportingInterval);
  const totalPeriods = Math.max(1, input.totalPeriods);
  const tasks: BarChartTask[] = Array.from({ length: totalPeriods }, (_, index) => {
    const startDay = index * daysPerPeriod + 1;
    const endDay = startDay + daysPerPeriod - 1;
    return {
      id: `theoretical-${index + 1}`,
      index: index + 1,
      name: `${reportingInterval === '10_day' ? '10-Day' : 'Month'} ${index + 1}`,
      startDay,
      endDay,
      actualEndDay: null,
      isCritical: false,
    };
  });
  return {
    tasks,
    totalDays: totalPeriods * daysPerPeriod,
  };
}


