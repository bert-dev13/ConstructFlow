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
  const stored = String(report.report_data.report_date ?? '').slice(0, 10);
  return stored !== '' && stored === reportDate.slice(0, 10);
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
