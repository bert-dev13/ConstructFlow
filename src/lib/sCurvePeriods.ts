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

function periodIndexForFinishDay(day: number, interval: SCurveReportingInterval): number {
  const normalized = Math.max(1, day);
  return Math.max(1, Math.ceil(normalized / intervalDays(interval)));
}

export function periodIndexForDate(
  startDate: string,
  date: string,
  interval: SCurveReportingInterval = '30_day',
): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const current = new Date(`${date}T00:00:00Z`).getTime();
  const diffDays = Math.max(0, Math.floor((current - start) / 86400000));
  return Math.max(1, Math.ceil(diffDays / intervalDays(interval)));
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
  const periodCount = Math.max(1, Math.ceil(Math.max(1, input.projectDuration) / daysPerPeriod));
  const wtByActivityId = new Map(
    input.costItems.map((item) => [item.activityId, item.weightPct]),
  );
  const targetPctByPeriod = new Map<number, number>();

  for (const activity of input.activities) {
    const finishDay = activity.ef ?? activity.duration ?? 0;
    const wt = wtByActivityId.get(activity.id) ?? 0;
    if (wt <= 0) continue;
    const periodIndex = Math.min(
      periodCount,
      periodIndexForFinishDay(finishDay, reportingInterval),
    );
    targetPctByPeriod.set(periodIndex, (targetPctByPeriod.get(periodIndex) ?? 0) + wt);
  }

  let runningCumulativePct = 0;
  const rows: SCurvePeriodRow[] = [];

  for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
    const periodStartDay =
      periodIndex === 1 ? 0 : (periodIndex - 1) * daysPerPeriod + 1;
    const periodEndDay = Math.min(input.projectDuration, periodIndex * daysPerPeriod);
    const targetAccomplishmentPct = round4(targetPctByPeriod.get(periodIndex) ?? 0);
    runningCumulativePct = round4(runningCumulativePct + targetAccomplishmentPct);
    const targetAccomplishmentPhp = round4(
      (targetAccomplishmentPct * input.totalContractAmount) / 100,
    );
    const cumulativePhp = round4((runningCumulativePct * input.totalContractAmount) / 100);

    rows.push({
      periodIndex,
      label: periodLabel(reportingInterval, periodIndex),
      startDate: addDays(input.startDate, periodStartDay),
      endDate: addDays(input.startDate, periodEndDay),
      targetAccomplishmentPct,
      targetAccomplishmentPhp,
      cumulativePct: runningCumulativePct,
      cumulativePhp,
    });
  }

  return rows;
}

export function buildTheoreticalSCurvePeriods(input: {
  startDate: string;
  totalPeriods: number;
  totalContractAmount: number;
  reportingInterval?: SCurveReportingInterval;
}): SCurvePeriodRow[] {
  const reportingInterval = input.reportingInterval ?? '30_day';
  const daysPerPeriod = intervalDays(reportingInterval);
  const periodCount = Math.max(1, input.totalPeriods);
  const rows: SCurvePeriodRow[] = [];
  let previousCumulativePct = 0;

  for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
    const cumulativePct = round4(
      (100 * (1 - Math.cos(Math.PI * (periodIndex / periodCount)))) / 2,
    );
    const targetAccomplishmentPct = round4(cumulativePct - previousCumulativePct);
    const periodStartDay =
      periodIndex === 1 ? 0 : (periodIndex - 1) * daysPerPeriod + 1;
    const periodEndDay = periodIndex * daysPerPeriod;
    const targetAccomplishmentPhp = round4(
      (targetAccomplishmentPct * input.totalContractAmount) / 100,
    );
    const cumulativePhp = round4((cumulativePct * input.totalContractAmount) / 100);

    rows.push({
      periodIndex,
      label: periodLabel(reportingInterval, periodIndex),
      startDate: addDays(input.startDate, periodStartDay),
      endDate: addDays(input.startDate, periodEndDay),
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
