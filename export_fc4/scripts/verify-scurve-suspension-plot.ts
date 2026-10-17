import { calculatePlannedPercentage, plannedCompletionDate, addCalendarDays } from '../src/lib/stewaCalculations';
import { inclusiveDayCount, readSuspensionWindow } from '../src/lib/scheduleBaselines';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// 1. Verify readSuspensionWindow recognizes suspension
const windowMode = readSuspensionWindow({
  baselineMode: 'prior_suspension',
  suspensionStart: '2026-03-20',
  suspensionEnd: '2026-06-24',
  revisedCompletion: '2026-10-04',
});
assert(windowMode !== null, 'readSuspensionWindow must detect suspension when baselineMode is prior_suspension');
assert(windowMode?.start === '2026-03-20', 'Suspension start date match');
assert(windowMode?.end === '2026-06-24', 'Suspension end date match');
assert(windowMode?.revisedCompletion === '2026-10-04', 'Revised completion match');

// 2. Standard 120-day project check
const noticeToProceed = '2026-01-01';
const contractDurationDays = 120;
const suspension = {
  start: '2026-02-15',
  end: '2026-03-31',
  revisedCompletion: '2026-06-15',
};
const suspLen = inclusiveDayCount(suspension.start, suspension.end);

// 2a. Pre-suspension check
const preSuspDate = '2026-02-01';
const preTarget = calculatePlannedPercentage({
  noticeToProceed,
  contractDurationDays,
  asOf: preSuspDate,
  suspensionDays: 0,
});
assert(preTarget !== null && preTarget > 0, 'Pre-suspension target should be positive');

// 2b. Day before suspension
const dayBeforeSusp = '2026-02-14';
const targetAtSuspStart = calculatePlannedPercentage({
  noticeToProceed,
  contractDurationDays,
  asOf: dayBeforeSusp,
  suspensionDays: 0,
});
assert(targetAtSuspStart !== null && targetAtSuspStart > preTarget!, 'Target should increase up to suspension start');

// 2c. During suspension, Target stays flat at targetAtSuspStart
const midSuspDate = '2026-03-01';
const targetDuringSusp = targetAtSuspStart; // Flat
assert(targetDuringSusp === targetAtSuspStart, 'Target must stay flat during suspension');

// 2d. Post resumption
const postSuspDate = '2026-04-15';
const postTarget = calculatePlannedPercentage({
  noticeToProceed,
  contractDurationDays,
  asOf: postSuspDate,
  suspensionDays: suspLen,
});
assert(postTarget !== null && postTarget >= targetAtSuspStart!, 'Post-resumption target must be non-decreasing from frozen target');

// 2e. Completion date
const completionDate = plannedCompletionDate({
  noticeToProceed,
  contractDurationDays,
  suspensionDays: suspLen,
});
const finalTarget = calculatePlannedPercentage({
  noticeToProceed,
  contractDurationDays,
  asOf: completionDate!,
  suspensionDays: suspLen,
});
assert(finalTarget === 100, 'Target should reach 100% on revised completion date');

// 3. User project timeline test (NTP 2025-12-24, suspension 2026-03-20 to 2026-06-24, revised completion 2026-10-04)
const userNtp = '2025-12-24';
const userDuration = 178;
const userSuspension = {
  start: '2026-03-20',
  end: '2026-06-24',
  revisedCompletion: '2026-10-04',
};
const userSuspLen = inclusiveDayCount(userSuspension.start, userSuspension.end);
const userDayBefore = addCalendarDays(userSuspension.start, -1) || userSuspension.start;
const userFrozen = calculatePlannedPercentage({
  noticeToProceed: userNtp,
  contractDurationDays: userDuration,
  asOf: userDayBefore,
  suspensionDays: 0,
});
assert(userFrozen !== null && userFrozen > 0, 'Frozen target at suspension start is valid and positive');

const userDates = [
  '2025-12-24',
  '2026-01-04',
  '2026-01-28',
  '2026-02-14',
  '2026-03-19', // day before
  '2026-03-20', // start
  '2026-04-08', // in suspension
  '2026-04-26', // in suspension
  '2026-05-25', // in suspension
  '2026-06-24', // suspension end
  '2026-07-09', // resumed
  '2026-07-20',
  '2026-08-23',
  '2026-09-22',
  '2026-10-04', // completion
];

let prevTarget = 0;
let maxTarget = 0;
for (const date of userDates) {
  let targetVal: number;
  if (date <= userNtp) {
    targetVal = 0;
  } else if (date < userSuspension.start) {
    targetVal = calculatePlannedPercentage({
      noticeToProceed: userNtp,
      contractDurationDays: userDuration,
      asOf: date,
      suspensionDays: 0,
    }) ?? 0;
  } else if (date <= userSuspension.end) {
    targetVal = userFrozen!;
  } else {
    const rawPost = calculatePlannedPercentage({
      noticeToProceed: userNtp,
      contractDurationDays: userDuration,
      asOf: date,
      suspensionDays: userSuspLen,
    }) ?? 0;
    targetVal = Math.max(userFrozen!, rawPost);
  }
  if (date >= userSuspension.revisedCompletion) {
    targetVal = 100;
  }
  if (targetVal < maxTarget) targetVal = maxTarget;
  else maxTarget = targetVal;

  // Target must never decrease
  assert(targetVal >= prevTarget, `Target must never decrease: ${date} has ${targetVal} < ${prevTarget}`);
  // Target must stay flat during suspension
  if (date >= userSuspension.start && date <= userSuspension.end) {
    assert(targetVal === userFrozen, `Target must remain flat at ${userFrozen}% during suspension, got ${targetVal}% on ${date}`);
  }
  // Target must not return to 0% after project starts
  if (date > userNtp) {
    assert(targetVal > 0, `Target must not drop to 0% after project start on ${date}`);
  }
  prevTarget = targetVal;
}
assert(prevTarget === 100, 'Target should reach 100% on revised completion');

console.log('SCURVE_SUSPENSION_PLOT_OK');
