import { collection, getDocs, query, where } from 'firebase/firestore';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { auth } from './config';
import { fetchUserProfile } from './auth';
import { readListCache, writeListCache } from './listCache';
import { listProjectsFs } from './projects';
import { listReportsFs } from './reports';

export interface DashboardKpi {
  value: number;
  label: string;
}

export interface DashboardData {
  kpis: {
    visibleProjects: DashboardKpi;
    pendingApprovals: DashboardKpi;
    delayedProjects: DashboardKpi;
    inputWarnings: DashboardKpi;
  };
  counts: {
    drafts: number;
    my_drafts: number;
    my_rejected: number;
    approved: number;
  };
  period: string;
}

export async function getDashboardStatsFs(): Promise<DashboardData> {
  const uid = auth.currentUser?.uid ?? 'anon';
  const cacheKey = `dashboard:${uid}`;
  const cached = readListCache<DashboardData>(cacheKey);
  if (cached) return cached;

  const [projects, reportRes] = await Promise.all([listProjectsFs(), listReportsFs()]);
  const reports = reportRes.reports;

  const profile = uid !== 'anon' ? await fetchUserProfile(uid) : null;

  let drafts = 0;
  let my_drafts = 0;
  let my_rejected = 0;
  let approved = 0;
  let pendingApprovals = 0;

  for (const report of reports) {
    const status = String(report.status ?? '');
    const createdBy = report.created_by != null ? String(report.created_by) : '';
    if (status === 'draft') {
      drafts += 1;
      if (uid !== 'anon' && createdBy === uid) my_drafts += 1;
    }
    if (status === 'rejected' && uid !== 'anon' && createdBy === uid) my_rejected += 1;
    if (['approved', 'generated'].includes(status)) approved += 1;

    if (profile?.role === 'engineer_2' && (status === 'pending_review' || status === 'contractor_confirmed')) {
      pendingApprovals += 1;
    }
    if (profile?.role === 'engineer_3' && status === 'with_engineer_3') pendingApprovals += 1;
    if (profile?.role === 'engineer_4' && status === 'with_engineer_4') pendingApprovals += 1;
  }

  let delayedProjects = 0;
  const now = new Date().toISOString().slice(0, 10);
  for (const project of projects) {
    const end = project.planned_end_date ? String(project.planned_end_date) : '';
    const status = String(project.status ?? 'active');
    if (end && end < now && status === 'active') delayedProjects += 1;
  }

  const data: DashboardData = {
    kpis: {
      visibleProjects: { value: projects.length, label: 'Projects' },
      pendingApprovals: { value: pendingApprovals, label: 'Pending approvals' },
      delayedProjects: { value: delayedProjects, label: 'Delayed projects' },
      inputWarnings: { value: my_rejected, label: 'Revision requests' },
    },
    counts: { drafts, my_drafts, my_rejected, approved },
    period: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  };
  return writeListCache(cacheKey, data, 20_000);
}

export async function listUsersByRoleFs(role: string) {
  const q = query(collection(db, COLLECTIONS.users), where('role', '==', role));
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Record<string, unknown>),
  }));
}
