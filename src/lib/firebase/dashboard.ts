import { collection, getDocs, query, where } from 'firebase/firestore';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { auth } from './config';
import { fetchUserProfile } from './auth';

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
  const projectsSnap = await getDocs(collection(db, COLLECTIONS.projects));
  const reportsSnap = await getDocs(collection(db, COLLECTIONS.reports));

  const uid = auth.currentUser?.uid;
  const profile = uid ? await fetchUserProfile(uid) : null;

  let drafts = 0;
  let my_drafts = 0;
  let my_rejected = 0;
  let approved = 0;
  let pendingApprovals = 0;

  for (const d of reportsSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    const status = String(data.status ?? '');
    const createdBy = data.createdBy != null ? String(data.createdBy) : '';
    if (status === 'draft') {
      drafts += 1;
      if (uid && createdBy === uid) my_drafts += 1;
    }
    if (status === 'rejected' && uid && createdBy === uid) my_rejected += 1;
    if (['approved', 'generated'].includes(status)) approved += 1;

    if (profile?.role === 'engineer_2' && status === 'pending_review') pendingApprovals += 1;
    if (profile?.role === 'engineer_3' && status === 'with_engineer_3') pendingApprovals += 1;
    if (profile?.role === 'engineer_4' && status === 'with_engineer_4') pendingApprovals += 1;
  }

  let delayedProjects = 0;
  const now = new Date().toISOString().slice(0, 10);
  for (const d of projectsSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    const end = data.plannedEndDate ? String(data.plannedEndDate) : '';
    const status = String(data.status ?? 'active');
    if (end && end < now && status === 'active') delayedProjects += 1;
  }

  return {
    kpis: {
      visibleProjects: { value: projectsSnap.size, label: 'Projects' },
      pendingApprovals: { value: pendingApprovals, label: 'Pending approvals' },
      delayedProjects: { value: delayedProjects, label: 'Delayed projects' },
      inputWarnings: { value: my_rejected, label: 'Revision requests' },
    },
    counts: { drafts, my_drafts, my_rejected, approved },
    period: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  };
}

export async function listUsersByRoleFs(role: string) {
  const q = query(collection(db, COLLECTIONS.users), where('role', '==', role));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}
