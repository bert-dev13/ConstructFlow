import { deriveBarChartFromPdm } from '../src/lib/scheduleSync';
import { computeSCurveCostSummary } from '../src/lib/sCurveItems';
import {
  buildSCurvePeriods,
  buildTheoreticalBarChartTasks,
  buildTheoreticalSCurvePeriods,
} from '../src/lib/sCurvePeriods';
import type { PdmActivity, PdmDependency } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

const activities: PdmActivity[] = [
  { id: 'a', number: '1.0', name: 'Mobilization', duration: 5 },
  { id: 'b', number: '2.0', name: 'Earthworks', duration: 12 },
  { id: 'c', number: '3.0', name: 'Pavement', duration: 30 },
];

const dependencies: PdmDependency[] = [
  { id: 'ab', fromId: 'a', toId: 'b', type: 'FS' },
  { id: 'bc', fromId: 'b', toId: 'c', type: 'FS' },
];

const derived = deriveBarChartFromPdm(activities, dependencies);

assert(derived.projectDuration === 47, `Expected project duration 47, got ${derived.projectDuration}`);
assert(
  JSON.stringify(
    derived.barChartTasks.map((task) => ({
      name: task.name,
      startDay: task.startDay,
      endDay: task.endDay,
    })),
  ) ===
    JSON.stringify([
      { name: 'Mobilization', startDay: 1, endDay: 5 },
      { name: 'Earthworks', startDay: 6, endDay: 17 },
      { name: 'Pavement', startDay: 18, endDay: 47 },
    ]),
  'PDM-derived bar chart span mismatch',
);

const costSummary = computeSCurveCostSummary([
  { activityId: 'a', itemNo: '1.0', description: 'Mobilization', quantity: 1, unitCost: 100000 },
  { activityId: 'b', itemNo: '2.0', description: 'Earthworks', quantity: 2, unitCost: 150000 },
  { activityId: 'c', itemNo: '3.0', description: 'Pavement', quantity: 4, unitCost: 400000 },
]);

assert(costSummary.totalContractAmount === 2000000, 'Total contract amount should be 2,000,000');
assert(round4(costSummary.totalWeightPct) === 100, 'Weight percentage should total 100%');

const periods10 = buildSCurvePeriods({
  startDate: '2026-01-01',
  projectDuration: derived.projectDuration,
  activities: derived.activities,
  costItems: costSummary.items,
  totalContractAmount: costSummary.totalContractAmount,
  reportingInterval: '10_day',
});

const periods30 = buildSCurvePeriods({
  startDate: '2026-01-01',
  projectDuration: derived.projectDuration,
  activities: derived.activities,
  costItems: costSummary.items,
  totalContractAmount: costSummary.totalContractAmount,
  reportingInterval: '30_day',
});

assert(periods10.length === 5, `Expected 5 ten-day periods, got ${periods10.length}`);
assert(periods30.length === 2, `Expected 2 monthly periods, got ${periods30.length}`);
assert(
  round4(periods10.reduce((sum, period) => sum + period.targetAccomplishmentPct, 0)) === 100,
  '10-day target accomplishment should total 100%',
);
assert(
  round4(periods30.reduce((sum, period) => sum + period.targetAccomplishmentPct, 0)) === 100,
  '30-day target accomplishment should total 100%',
);

const theoretical30 = buildTheoreticalSCurvePeriods({
  startDate: '2026-01-01',
  totalPeriods: 4,
  totalContractAmount: costSummary.totalContractAmount,
  reportingInterval: '30_day',
});

assert(theoretical30.length === 4, 'Expected 4 theoretical monthly periods');
assert(round4(theoretical30[0]?.cumulativePct ?? 0) === 14.6447, 'Unexpected first theoretical cumulative %');
assert(round4(theoretical30[3]?.cumulativePct ?? 0) === 100, 'Theoretical curve should finish at 100%');
assert(
  theoretical30.every((period, index, rows) =>
    index === 0 ? period.targetAccomplishmentPct > 0 : period.cumulativePct >= rows[index - 1]!.cumulativePct,
  ),
  'Theoretical cumulative percentages should be monotonic',
);

const theoreticalBar = buildTheoreticalBarChartTasks({
  totalPeriods: 4,
  reportingInterval: '10_day',
});

assert(theoreticalBar.totalDays === 40, `Expected 40 theoretical days, got ${theoreticalBar.totalDays}`);
assert(theoreticalBar.tasks.length === 4, 'Expected 4 theoretical bar tasks');
assert(
  JSON.stringify(theoreticalBar.tasks.map((task) => [task.startDay, task.endDay])) ===
    JSON.stringify([
      [1, 10],
      [11, 20],
      [21, 30],
      [31, 40],
    ]),
  'Theoretical bar chart task spans do not align with theoretical periods',
);

console.log('S-Curve and Bar Chart synchronization validation passed.');
