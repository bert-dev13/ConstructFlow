/** Parse yyyy-mm-dd (date input) or MM/DD/YYYY text. */
export function parseFlexibleDate(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const mdy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const d = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]), 12);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Inclusive calendar days between two date strings. */
export function inclusiveCalendarDays(start: string, end: string): number | null {
  const a = parseFlexibleDate(start);
  const b = parseFlexibleDate(end);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  if (ms < 0) return null;
  return Math.floor(ms / 86_400_000) + 1;
}

/**
 * Days in the reporting period: report date through period covered end date.
 */
export function computeContractDurationDays(data: Record<string, string>): number | null {
  const { report_date, period_covered } = data;
  if (!report_date || !period_covered) return null;
  return inclusiveCalendarDays(report_date, period_covered);
}

/** Calendar days from notice to proceed through report date. */
export function computeCalendarDaysElapsed(data: Record<string, string>): number | null {
  const { notice_to_proceed, report_date } = data;
  if (!notice_to_proceed || !report_date) return null;
  return inclusiveCalendarDays(notice_to_proceed, report_date);
}

export function applyStewaDerivedFields(data: Record<string, string>): Record<string, string> {
  const next = { ...data };
  const duration = computeContractDurationDays(next);
  if (duration !== null) next.contract_duration = String(duration);
  const elapsed = computeCalendarDaysElapsed(next);
  if (elapsed !== null) next.calendar_days_elapsed = String(elapsed);
  return next;
}
