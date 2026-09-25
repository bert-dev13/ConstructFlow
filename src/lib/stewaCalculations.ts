/**
 * STEWA formulas copied from public/SWA-STEWA-RCBC.xlsx, sheet "STEWA (July 6-9)".
 * Printed values are column D. Column I is the input / working area.
 * Displayed planned % is D29 = I29 (sine, original duration). H36 does not change D29.
 */

const MS_DAY = 86_400_000;
/** Excel I29 uses this constant, not Math.PI. */
const EXCEL_PI = 3.14159265358979;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type DateParts = { y: number; m: number; d: number };

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

function dateParts(value: string): DateParts | null {
  const v = value.trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const parsed = parseFlexibleDate(v);
  if (!parsed) return null;
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}

function utcMs(parts: DateParts): number {
  return Date.UTC(parts.y, parts.m - 1, parts.d);
}

function fromUtc(ms: number): DateParts {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function toIso(parts: DateParts): string {
  return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}

/** Excel date + N days (D17 = D20+9, D21 = D17+D19). */
export function addCalendarDays(value: string, days: number): string | null {
  const parts = dateParts(value);
  if (!parts || !Number.isFinite(days)) return null;
  return toIso(fromUtc(utcMs(parts) + Math.trunc(days) * MS_DAY));
}

/** Excel serial subtraction (D18 − D17). */
export function excelDateDiff(later: string, earlier: string): number | null {
  const a = dateParts(later);
  const b = dateParts(earlier);
  if (!a || !b) return null;
  return Math.round((utcMs(a) - utcMs(b)) / MS_DAY);
}

/** "July 08, 2026" — day zero-padded, matching the workbook. */
export function formatExcelDate(value: string): string {
  const parts = dateParts(value);
  if (!parts) return value.trim();
  return `${MONTHS[parts.m - 1]} ${String(parts.d).padStart(2, '0')}, ${parts.y}`;
}

function optionalNumber(value: string | undefined): number | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '—') return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Blank Excel number cells act as 0 inside arithmetic. */
function excelNumber(value: string | undefined): number {
  return optionalNumber(value) ?? 0;
}

/**
 * I29 = (((SIN((((180*(D27/D19))-90)*(PI/180)))+1)*50)/100)
 * Returned in percentage points (1.33 means 1.33%), which is how Excel percent format displays the fraction.
 */
export function plannedSinePercent(elapsed: number, duration: number): number | null {
  if (!duration) return null;
  const radians = ((180 * (elapsed / duration) - 90) * EXCEL_PI) / 180;
  const fraction = ((Math.sin(radians) + 1) * 50) / 100;
  return fraction * 100;
}

function round2(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function stewaDash(value: string | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '—' || Number(raw) === 0) return '—';
  return raw;
}

export function stewaPercentText(value: string | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/%/g, ''));
  if (!Number.isFinite(n)) return raw;
  return n.toFixed(2);
}

export function applyStewaDerivedFields(data: Record<string, string>): Record<string, string> {
  const next = { ...data };
  const asOf = String(next.report_date ?? '').trim();
  const ntp = String(next.notice_to_proceed ?? '').trim();
  const durationInput = optionalNumber(next.contract_duration);
  const duration = durationInput ?? 0;
  const extension = excelNumber(next.approved_time_extension);
  const suspension = excelNumber(next.approved_time_suspension);

  // D17 = D20+9. D18 = as-of date (B9).
  const periodStart = ntp ? addCalendarDays(ntp, 9) : null;
  const periodEnd = asOf || null;
  next.period_start = periodStart ?? '';
  next.period_end = periodEnd ?? '';
  if (periodStart && periodEnd) {
    const covered = `${formatExcelDate(periodStart)} to ${formatExcelDate(periodEnd)}`;
    next.period_covered = covered;
    next.week_covered = covered;
  } else {
    next.period_covered = '';
    next.week_covered = '';
  }

  // D21 = D17+D19. Blank duration stays blank so an unfilled form does not print the period start as expiry.
  const expiry = periodStart && durationInput != null ? addCalendarDays(periodStart, duration) : null;
  next.expiry_date = expiry ?? '';

  // I24 = D22. I25 = IF(D22>0, D22+I19, 0). D25 = IF(I24>0, I25, 0).
  next.total_time_extension = String(extension);
  const revisedDuration = extension > 0 ? extension + duration : 0;
  next.revised_contract_duration = String(revisedDuration);

  // D26 = D21+D23+D22.
  next.revised_expiry_date = expiry
    ? addCalendarDays(expiry, suspension + extension) ?? ''
    : '';

  // D27 = D18-D17+1-D23.
  if (periodStart && periodEnd) {
    const span = excelDateDiff(periodEnd, periodStart);
    next.calendar_days_elapsed = span == null ? '' : String(span + 1 - suspension);
  } else {
    next.calendar_days_elapsed = '';
  }

  // D29 = I29. I30 (sine on revised duration) is not the printed planned %.
  const elapsed = optionalNumber(next.calendar_days_elapsed);
  const planned =
    elapsed != null && duration > 0 ? plannedSinePercent(elapsed, duration) : null;
  next.percent_planned = planned == null ? '' : round2(planned);

  // D30 = D28-D29, using the 2-decimal percent values the sheet displays.
  const actual = optionalNumber(next.percent_actual);
  if (actual != null && planned != null) {
    next.slippage = round2(Number(round2(actual)) - Number(next.percent_planned));
  } else {
    next.slippage = '';
  }

  return next;
}
