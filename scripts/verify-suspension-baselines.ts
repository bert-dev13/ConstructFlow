import { buildSCurvePeriods } from '../src/lib/sCurvePeriods';
import {
  buildRevisedBaselinePeriods,
  cumulativeAtDate,
  inclusiveDayCount,
  revisedCumulativeOnDay,
  originalBarChartTasks,
  readSuspensionWindow,
  revisedBarChartTasks,
  sCurveRecordLabel,
} from '../src/lib/scheduleBaselines';
import type { PdmActivity } from '../src/types';
import type { SCurveCostItem } from '../src/lib/sCurveItems';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const projectStart = '2026-01-01';
const suspension = {
  start: '2026-03-01',
  end: '2026-03-10',
  revisedCompletion: '2026-06-01',
};
const suspStartDay = inclusiveDayCount(projectStart, suspension.start);
const suspLen = inclusiveDayCount(suspension.start, suspension.end);

const early: PdmActivity = {
  id: 'early',
  number: 'A',
  name: 'Early work',
  duration: 30,
  es: 0,
  ef: 30,
};
const delayed: PdmActivity = {
  id: 'delayed',
  number: 'B',
  name: 'After suspension',
  duration: 31,
  es: suspStartDay - 1,
  ef: suspStartDay - 1 + 31,
};
const activities = [early, delayed];
const costItems: SCurveCostItem[] = [
  {
    activityId: 'early',
    itemNo: 'A',
    description: 'Early work',
    quantity: 1,
    unitCost: 40,
    amount: 40,
    weightPct: 40,
  },
  {
    activityId: 'delayed',
    itemNo: 'B',
    description: 'After suspension',
    quantity: 1,
    unitCost: 60,
    amount: 60,
    weightPct: 60,
  },
];

assert(readSuspensionWindow({ baselineMode: 'active' }) === null, 'active project has no suspension window');
assert(
  readSuspensionWindow({
    baselineMode: 'active',
    suspensionStart: suspension.start,
    suspensionEnd: suspension.end,
    revisedCompletion: suspension.revisedCompletion,
  }) === null,
  'dates are ignored unless the project has a prior suspension',
);

const originalDuration = Math.max(...activities.map((activity) => activity.ef ?? 0));
const originalPeriods = buildSCurvePeriods({
  startDate: projectStart,
  projectDuration: originalDuration,
  activities,
  costItems,
  totalContractAmount: 100,
  reportingInterval: '30_day',
});
const revisedPeriods = buildRevisedBaselinePeriods({
  projectStart,
  activities,
  costItems,
  totalContractAmount: 100,
  reportingInterval: '30_day',
  suspension,
});

const lastRevised = revisedPeriods[revisedPeriods.length - 1];
assert(lastRevised.endDate === suspension.revisedCompletion, `revised curve ends on ${lastRevised.endDate}`);
assert(lastRevised.cumulativePct === 100, 'revised curve reaches 100');
assert(originalPeriods[originalPeriods.length - 1].cumulativePct === 100, 'original curve reaches 100');

const beforeGap = '2026-02-28';
const insideGap = '2026-03-05';
const dailyInput = {
  projectStart,
  activities,
  costItems,
  suspension,
};
const revisedBefore = revisedCumulativeOnDay({ ...dailyInput, date: beforeGap });
const revisedInside = revisedCumulativeOnDay({ ...dailyInput, date: insideGap });
assert(
  revisedInside === revisedBefore,
  `revised curve moved during suspension (${revisedBefore} -> ${revisedInside})`,
);

const originalInside = cumulativeAtDate(originalPeriods, insideGap);
assert(
  originalInside > revisedInside,
  `original curve should ignore the suspension (${originalInside} vs revised ${revisedInside})`,
);

const originalBars = originalBarChartTasks(activities);
const revisedBars = revisedBarChartTasks(activities, projectStart, suspension);
const originalDelayed = originalBars.find((task) => task.id === 'delayed');
const revisedDelayed = revisedBars.tasks.find((task) => task.id === 'delayed');
assert(originalDelayed?.startDay === suspStartDay, 'original bar keeps the unshifted start');
assert(
  revisedDelayed?.startDay === suspStartDay + suspLen,
  `revised bar should shift by ${suspLen} days, got ${revisedDelayed?.startDay}`,
);
assert(
  (revisedDelayed?.endDay ?? 0) - (revisedDelayed?.startDay ?? 0) ===
    (originalDelayed?.endDay ?? 0) - (originalDelayed?.startDay ?? 0),
  'revised bar keeps the original duration',
);
assert(revisedBars.totalDays === inclusiveDayCount(projectStart, suspension.revisedCompletion), 'revised chart spans to the revised completion');
assert(originalBars.every((task) => task.actualEndDay == null), 'original baseline has no SWA actuals');
assert(revisedBars.tasks.every((task) => task.actualEndDay == null), 'revised baseline has no SWA actuals');

assert(sCurveRecordLabel('2026-08-01') === 'S-Curve - August 2026', sCurveRecordLabel('2026-08-01'));
assert(
  sCurveRecordLabel('2026-09-15') === 'S-Curve - As of September 15, 2026',
  sCurveRecordLabel('2026-09-15'),
);

console.log('SUSPENSION_BASELINE_OK');
