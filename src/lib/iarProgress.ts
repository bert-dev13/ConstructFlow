import { computeWorkItems, type WorkItem } from './workItems';
import type { SwaStewaReport } from './swaStewaApi';

/** SWA total weight % accomplished. Line items are the source; the stored percent is the fallback. */
export function swaPhysicalAccomplishmentPct(
  report: Pick<SwaStewaReport, 'report_data' | 'line_items'>,
): number | null {
  if (report.line_items?.length) {
    const { totals } = computeWorkItems(report.line_items as WorkItem[]);
    if (Number.isFinite(totals.totalToDateWeightPct)) {
      return Math.round(totals.totalToDateWeightPct * 1000) / 1000;
    }
  }
  const totals = report.report_data.computed_totals;
  const storedTotals =
    totals && typeof totals === 'object' ? (totals as Record<string, unknown>) : undefined;
  const raw =
    report.report_data.percent_actual
    ?? report.report_data.percent_complete
    ?? storedTotals?.totalToDateWeightPct;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function sameReportDay(report: SwaStewaReport, reportDate: string): boolean {
  const target = reportDate.slice(0, 10).trim();
  if (!target) return false;
  const data = report.report_data ?? {};
  const stored = String(data.report_date ?? '').slice(0, 10);
  if (stored && stored === target) return true;
  const start = String(data.as_of_start ?? data.period_start ?? '').slice(0, 10);
  const end = String(data.as_of_end ?? data.period_end ?? '').slice(0, 10);
  if (end && end === target) return true;
  if (start && start === target) return true;
  if (start && end && target >= start && target <= end) return true;
  return false;
}

/**
 * Parse a percentage string or number to a rounded 2-decimal number.
 * e.g. "1.33%", "1.33", 1.33 -> 1.33
 */
export function parsePercentValue(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val).trim().replace(/,/g, '').replace(/%/g, '');
  if (!s || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Extract the saved "Percentage of Work Accomplished – Planned" from a STEWA.
 * Does not re-calculate via separate formula; reads the STEWA document's saved value directly.
 */
export function stewaPlannedPct(
  report: Pick<SwaStewaReport, 'report_data'> | null | undefined,
): number | null {
  if (!report?.report_data) return null;
  const data = report.report_data;
  return (
    parsePercentValue(data.percent_planned) ??
    parsePercentValue(data.planned) ??
    parsePercentValue(data.rev_target) ??
    parsePercentValue(data.orig_target)
  );
}

/**
 * The SWA for this IAR. A report on the same date wins. Otherwise the newest SWA
 * on the project is used, including drafts.
 */
export function pickProjectSwa(
  reports: SwaStewaReport[],
  reportDate?: string,
): SwaStewaReport | null {
  const swas = reports.filter((report) => report.report_type === 'SWA');
  const dated = reportDate ? swas.filter((report) => sameReportDay(report, reportDate)) : [];
  const pool = dated.length ? dated : swas;
  pool.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return pool[0] ?? null;
}

/**
 * Finds the corresponding STEWA for the same project and reporting period.
 * Does NOT grab a STEWA from an unrelated reporting period.
 */
export function pickProjectStewa(
  reports: SwaStewaReport[],
  reportDate?: string,
  matchingSwa?: SwaStewaReport | null,
  iarData?: Record<string, unknown> | null,
): SwaStewaReport | null {
  const stewas = reports.filter((report) => report.report_type === 'STEWA');
  if (!stewas.length) return null;

  const targetDate = String(reportDate ?? '').slice(0, 10).trim();
  const linkedStewaId = String(iarData?.stewa_source_report ?? '').trim();
  const linkedSwaNo = String(
    matchingSwa?.report_number ?? iarData?.swa_source_report ?? '',
  ).trim();

  // 1. Direct reference by report_number or id
  if (linkedStewaId) {
    const direct = stewas.find(
      (r) => r.report_number === linkedStewaId || String(r.id) === linkedStewaId,
    );
    if (direct) return direct;
  }

  // 2. Linked via same SWA source
  if (linkedSwaNo) {
    const viaSwa = stewas.filter(
      (r) => String(r.report_data?.swa_source_report ?? '').trim() === linkedSwaNo,
    );
    if (viaSwa.length) {
      viaSwa.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return viaSwa[0];
    }
  }

  // 3. Same reporting date or period matching
  if (targetDate) {
    const swaStart = String(matchingSwa?.report_data?.as_of_start ?? '').slice(0, 10);
    const swaEnd = String(
      matchingSwa?.report_data?.as_of_end ?? matchingSwa?.report_data?.report_date ?? '',
    ).slice(0, 10);

    const periodMatches = stewas.filter((r) => {
      const data = r.report_data ?? {};
      const sReportDate = String(data.report_date ?? '').slice(0, 10);
      const sPeriodEnd = String(data.period_end ?? '').slice(0, 10);
      const sPeriodStart = String(data.period_start ?? '').slice(0, 10);

      // Matches report_date directly
      if (sReportDate && sReportDate === targetDate) return true;
      // Matches period_end
      if (sPeriodEnd && sPeriodEnd === targetDate) return true;
      // Matches period_start
      if (sPeriodStart && sPeriodStart === targetDate) return true;

      // If targetDate falls between period_start and period_end
      if (sPeriodStart && sPeriodEnd && targetDate >= sPeriodStart && targetDate <= sPeriodEnd) {
        return true;
      }

      // If matching SWA has as_of_end matching this STEWA's report_date or period_end
      if (swaEnd && (sReportDate === swaEnd || sPeriodEnd === swaEnd)) {
        return true;
      }

      // If matching SWA has as_of_start matching this STEWA's period_start
      if (swaStart && sPeriodStart === swaStart) {
        return true;
      }

      return false;
    });

    if (periodMatches.length) {
      // Prioritize approved/generated, then newest created
      periodMatches.sort((a, b) => {
        const aApproved = ['approved', 'generated'].includes(a.status) ? 1 : 0;
        const bApproved = ['approved', 'generated'].includes(b.status) ? 1 : 0;
        if (aApproved !== bApproved) return bApproved - aApproved;
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      return periodMatches[0];
    }
  }

  // 4. If only 1 STEWA exists on this project and no targetDate is specified
  if (!targetDate && stewas.length === 1) {
    return stewas[0];
  }

  // Strictly avoid pulling from an unrelated STEWA
  return null;
}
