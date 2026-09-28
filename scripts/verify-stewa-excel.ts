import { applyStewaDerivedFields } from '../src/lib/stewaCalculations';

function check(label: string, actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const july6 = applyStewaDerivedFields({
  report_date: '2026-07-08',
  notice_to_proceed: '2025-12-26',
  contract_duration: '95',
  approved_time_extension: '',
  approved_time_suspension: '179',
  percent_actual: '2.57',
});

check('period start', july6.period_start, '2026-01-04');
check('period covered', july6.period_covered, 'January 04, 2026 to July 08, 2026');
check('week covered', july6.week_covered, july6.period_covered);
check('expiry', july6.expiry_date, '2026-04-09');
check('revised expiry', july6.revised_expiry_date, '2026-10-05');
check('elapsed', july6.calendar_days_elapsed, '7');
check('extension', july6.total_time_extension, '0');
check('revised duration', july6.revised_contract_duration, '0');
check('planned', july6.percent_planned, '1.33');
check('slippage', july6.slippage, '1.24');

const july13 = applyStewaDerivedFields({
  report_date: '2026-07-17',
  notice_to_proceed: '2025-12-26',
  contract_duration: '95',
  approved_time_suspension: '179',
  percent_actual: '43.38',
});
check('elapsed Jul 17', july13.calendar_days_elapsed, '16');
check('planned Jul 17', july13.percent_planned, '6.84');
check('slippage Jul 17', july13.slippage, '36.54');

const july20 = applyStewaDerivedFields({
  report_date: '2026-07-24',
  notice_to_proceed: '2025-12-26',
  contract_duration: '95',
  approved_time_suspension: '179',
  percent_actual: '43.38',
});
check('elapsed Jul 24', july20.calendar_days_elapsed, '23');
check('planned Jul 24', july20.percent_planned, '13.78');
check('slippage Jul 24', july20.slippage, '29.60');

const withExtension = applyStewaDerivedFields({
  report_date: '2026-07-08',
  notice_to_proceed: '2025-12-26',
  contract_duration: '95',
  approved_time_extension: '10',
  approved_time_suspension: '179',
  percent_actual: '2.57',
});
check('total extension', withExtension.total_time_extension, '10');
check('revised duration with extension', withExtension.revised_contract_duration, '105');
check('revised expiry with extension', withExtension.revised_expiry_date, '2026-10-15');
check('planned stays on original duration', withExtension.percent_planned, '1.33');

console.log('STEWA Excel formulas match the July 6-9, July 13-17, and July 20-24 sheets.');
