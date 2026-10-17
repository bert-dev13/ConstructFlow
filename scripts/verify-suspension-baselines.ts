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

const straddlingActivity: PdmActivity = {
  id: 'crossing',
  number: 'C',
  name: 'Active through suspension',
  duration: 20,
  es: suspStartDay - 5, // Starts 4 days before suspension
  ef: suspStartDay - 5 + 20, // Ends after suspension starts
};
const crossingRevised = revisedBarChartTasks([straddlingActivity], projectStart, suspension);
assert(crossingRevised.tasks.length === 1, 'straddling activity must produce exactly 1 task row');
const crossingTask = crossingRevised.tasks[0];
assert(crossingTask.segments?.length === 3, 'straddling activity must have 3 segments (active, suspended, resumed)');
assert(crossingTask.segments[0].type === 'active', 'segment 1 must be active');
assert(crossingTask.segments[1].type === 'suspended', 'segment 2 must be suspended');
assert(crossingTask.segments[2].type === 'resumed', 'segment 3 must be resumed');
assert(crossingTask.segments[1].startDay === suspStartDay, 'suspended segment starts at suspStartDay');
assert(crossingTask.segments[1].endDay === suspStartDay + suspLen - 1, 'suspended segment ends at suspEndDay');
assert(crossingTask.segments[2].startDay === suspStartDay + suspLen, 'resumed segment starts right after suspension');

// Verification for: Some tasks appear as separate/duplicate rows after suspension/resumption.
// These are NOT separate tasks. They are parts of ONE PDM activity.
const preSuspPart: PdmActivity = {
  id: 'earthworks',
  number: '100(1)',
  name: 'Clearing and Grubbing',
  duration: 15,
  es: 0,
  ef: 15,
  isCritical: true,
};
const resumedPart: PdmActivity = {
  id: 'earthworks-resumed',
  number: '100(1)',
  name: 'Clearing and Grubbing (Resumed)',
  duration: 15,
  es: suspStartDay - 1,
  ef: suspStartDay - 1 + 15,
  isCritical: false,
};
const separateTaskRevised = revisedBarChartTasks([preSuspPart, resumedPart], projectStart, suspension);
assert(
  separateTaskRevised.tasks.length === 1,
  `Separate pre and resumed parts must produce exactly 1 task row, got ${separateTaskRevised.tasks.length}`,
);
const unifiedTask = separateTaskRevised.tasks[0];
assert(unifiedTask.id === 'earthworks', `Unified task ID must be canonical 'earthworks', got ${unifiedTask.id}`);
assert(unifiedTask.itemNo === '100(1)', `Unified task Item No must be preserved as '100(1)', got ${unifiedTask.itemNo}`);
assert(unifiedTask.name === 'Clearing and Grubbing', `Unified task name must be clean description, got ${unifiedTask.name}`);
assert(unifiedTask.isCritical === true, 'Unified task critical status must be preserved');
assert(unifiedTask.segments?.length === 3, 'Unified task must have 3 segments: Active -> Suspended -> Resumed');
assert(unifiedTask.segments[0].type === 'active', 'Segment 1 must be active');
assert(unifiedTask.segments[1].type === 'suspended', 'Segment 2 must be suspended');
assert(unifiedTask.segments[2].type === 'resumed', 'Segment 3 must be resumed');
assert(unifiedTask.segments[1].startDay === suspStartDay, 'Suspension segment starts at suspStartDay');
assert(unifiedTask.segments[1].endDay === suspStartDay + suspLen - 1, 'Suspension segment ends at suspEndDay');
assert(unifiedTask.segments[2].startDay === suspStartDay + suspLen, 'Resumed segment continues right after suspension');
assert(unifiedTask.endDay === 84, `Revised finish must reflect continued task on revised schedule, got ${unifiedTask.endDay}`);

// Genuinely different PDM items must NOT be merged
const distinctItem: PdmActivity = {
  id: 'excavation',
  number: '102(1)',
  name: 'Roadway Excavation',
  duration: 10,
  es: suspStartDay + suspLen,
  ef: suspStartDay + suspLen + 10,
};
const mixedRevised = revisedBarChartTasks([preSuspPart, resumedPart, distinctItem], projectStart, suspension);
assert(mixedRevised.tasks.length === 2, `Distinct PDM items must not be merged. Expected 2, got ${mixedRevised.tasks.length}`);
assert(mixedRevised.tasks.some((t) => t.id === 'earthworks' && t.itemNo === '100(1)'), 'Must contain earthworks row');
assert(mixedRevised.tasks.some((t) => t.id === 'excavation' && t.itemNo === '102(1)'), 'Must contain excavation row');

console.log('SUSPENSION_BASELINE_OK');

