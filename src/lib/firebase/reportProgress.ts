import { collection, getDocs, query, where } from 'firebase/firestore';
import type { ReportProgressEntry } from '../../components/ReportProgressFeed';
import { computeWorkItems, type WorkItem } from '../workItems';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { asId } from './ids';

function percentFromReportData(
  reportData: Record<string, unknown>,
  lineItems: unknown,
  reportType: string,
): number | null {
  const pctRaw =
    reportData.percent_actual ??
    reportData.percent_complete ??
    reportData.accomplishment ??
    null;
  if (pctRaw != null && !Number.isNaN(Number(pctRaw))) {
    return Math.round(Number(pctRaw) * 1000) / 1000;
  }

  if (reportType === 'SWA' && Array.isArray(lineItems) && lineItems.length > 0) {
    try {
      const { totals } = computeWorkItems(lineItems as WorkItem[]);
      return Math.round(totals.totalToDateWeightPct * 1000) / 1000;
    } catch {
      return null;
    }
  }
  return null;
}

function mapProgressDocs(
  docs: { id: string; data: () => Record<string, unknown> }[],
): ReportProgressEntry[] {
  const entries: ReportProgressEntry[] = [];

  for (const d of docs) {
    const data = d.data();
    const status = String(data.status ?? '');
    if (!['approved', 'generated'].includes(status)) continue;

    const reportType = String(data.reportType ?? '');
    if (!['SWA', 'STEWA', 'IAR'].includes(reportType)) continue;

    const reportData = (data.reportData as Record<string, unknown>) ?? {};
    const pct = percentFromReportData(reportData, data.lineItems, reportType);
    if (pct == null) continue;

    const date = String(
      reportData.report_date ?? reportData.period_end ?? data.generatedAt ?? data.updatedAt ?? '',
    ).slice(0, 10);
    if (!date) continue;

    const reportNumber = String(data.reportNumber ?? d.id);
    entries.push({
      reportNumber,
      reportType,
      date,
      percent: pct,
      label: `${reportType} ${reportNumber}`,
      status,
    });
  }

  entries.sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    return d !== 0 ? d : b.reportNumber.localeCompare(a.reportNumber);
  });
  return entries;
}

/** Approved/generated SWA, STEWA, and IAR progress for a project (newest first). */
export async function listApprovedProgressForProject(
  projectId: string | number,
): Promise<ReportProgressEntry[]> {
  const id = asId(projectId);

  // Prefer status-constrained query so rules can authorize public finalized reads.
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTIONS.reports),
        where('projectId', '==', id),
        where('status', 'in', ['approved', 'generated']),
      ),
    );
    return mapProgressDocs(snap.docs);
  } catch {
    /* fall through */
  }

  // Staff with project access can list all project reports, then filter client-side.
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.reports), where('projectId', '==', id)),
    );
    return mapProgressDocs(snap.docs);
  } catch {
    return [];
  }
}
