import type { ReportProgressEntry } from '../components/ReportProgressFeed';
import type { ScheduleStatus, ScheduleStatusCode } from './sCurveApi';

/** Compare Actual Plan % vs Target Plan %. */
export function compareTargetVsActual(
  targetPct: number | null,
  actualPct: number | null,
): ScheduleStatus {
  if (targetPct == null && actualPct == null) {
    return {
      status: 'unknown',
      slippage_pct: null,
      planned_pct: null,
      actual_pct: null,
      label: 'No progress data',
    };
  }
  if (targetPct != null && actualPct == null) {
    return {
      status: 'target_only',
      slippage_pct: null,
      planned_pct: targetPct,
      actual_pct: null,
      label: 'Target Plan only',
    };
  }
  if (targetPct == null && actualPct != null) {
    return {
      status: 'unknown',
      slippage_pct: null,
      planned_pct: null,
      actual_pct: actualPct,
      label: 'Actual recorded (no Target Plan yet)',
    };
  }

  const target = Number(targetPct);
  const actual = Number(actualPct);
  const slip = Math.round((actual - target) * 100) / 100;

  if (Math.abs(slip) < 0.05) {
    return {
      status: 'on_schedule',
      slippage_pct: slip,
      planned_pct: target,
      actual_pct: actual,
      label: 'On Track',
    };
  }
  if (actual > target) {
    return {
      status: 'ahead',
      slippage_pct: slip,
      planned_pct: target,
      actual_pct: actual,
      label: 'Ahead',
    };
  }
  return {
    status: 'behind',
    slippage_pct: slip,
    planned_pct: target,
    actual_pct: actual,
    label: 'Behind',
  };
}

export function statusDisplayLabel(code: ScheduleStatusCode | string): string {
  switch (code) {
    case 'ahead':
      return 'Ahead';
    case 'behind':
      return 'Behind';
    case 'on_schedule':
      return 'On Track';
    case 'target_only':
      return 'Target Plan only';
    default:
      return 'Status unknown';
  }
}

/** Chronological ascending SWA/STEWA entries with progress %. */
export function swaStewaChronological(feed: ReportProgressEntry[]): ReportProgressEntry[] {
  return feed
    .filter((e) => e.reportType === 'SWA' || e.reportType === 'STEWA')
    .slice()
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      return d !== 0 ? d : a.reportNumber.localeCompare(b.reportNumber);
    });
}

/**
 * First SWA/STEWA progress = Target Plan.
 * Latest SWA/STEWA progress = Actual Plan.
 */
export function resolveTargetAndActual(feed: ReportProgressEntry[]): {
  targetPct: number | null;
  actualPct: number | null;
  firstReport: ReportProgressEntry | null;
  latestReport: ReportProgressEntry | null;
  chronological: ReportProgressEntry[];
} {
  const chronological = swaStewaChronological(feed);
  const firstReport = chronological[0] ?? null;
  const latestReport = chronological.length ? chronological[chronological.length - 1] : null;
  const targetPct = firstReport != null ? firstReport.percent : null;
  // Actual Plan comes from succeeding updates (2nd+ SWA/STEWA).
  const actualPct = chronological.length >= 2 ? latestReport!.percent : null;

  return { targetPct, actualPct, firstReport, latestReport, chronological };
}
