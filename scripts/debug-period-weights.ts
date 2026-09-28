import { deriveBarChartFromPdm } from '../src/lib/scheduleSync';
import { computeSCurveCostSummary } from '../src/lib/sCurveItems';
import { buildSCurvePeriods } from '../src/lib/sCurvePeriods';
import type { PdmActivity, PdmDependency } from '../src/types';

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
console.log(
  'acts',
  derived.activities.map((a) => ({ id: a.id, es: a.es, ef: a.ef, dur: a.duration })),
);
console.log('duration', derived.projectDuration);
const costSummary = computeSCurveCostSummary([
  { activityId: 'a', itemNo: '1.0', description: 'Mobilization', quantity: 1, unitCost: 100000 },
  { activityId: 'b', itemNo: '2.0', description: 'Earthworks', quantity: 2, unitCost: 150000 },
  { activityId: 'c', itemNo: '3.0', description: 'Pavement', quantity: 4, unitCost: 400000 },
]);
console.log(
  'weights',
  costSummary.items.map((i) => ({ id: i.activityId, wt: i.weightPct })),
  'total',
  costSummary.totalWeightPct,
);
const periods10 = buildSCurvePeriods({
  startDate: '2026-01-01',
  projectDuration: derived.projectDuration,
  activities: derived.activities,
  costItems: costSummary.items,
  totalContractAmount: costSummary.totalContractAmount,
  reportingInterval: '10_day',
});
console.log(
  periods10.map((p) => ({ i: p.periodIndex, pct: p.targetAccomplishmentPct, cum: p.cumulativePct })),
);
console.log(
  'sum',
  periods10.reduce((s, p) => s + p.targetAccomplishmentPct, 0),
  'lastCum',
  periods10[periods10.length - 1]?.cumulativePct,
);
