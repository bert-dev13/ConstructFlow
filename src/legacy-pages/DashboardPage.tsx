'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { DashboardHeader } from '../components/DashboardHeader';
import { EngineerIDashboard } from '../components/EngineerIDashboard';
import { KpiCards } from '../components/KpiCards';
import { ProgressChart } from '../components/ProgressChart';
import { ManagementAlerts } from '../components/ManagementAlerts';
import { RecentActivities } from '../components/RecentActivities';
import { ContractorDashboard } from '../components/ContractorDashboard';
import { getDashboardStats, type DashboardData } from '../lib/dashboardApi';

const isReviewerRole = (role: string) =>
  role === 'engineer_2' || role === 'engineer_3' || role === 'engineer_4';

export function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role === 'engineer_1') return;
    getDashboardStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [user?.role]);

  if (!user) return null;

  if (user.role === 'engineer_1') {
    return <EngineerIDashboard />;
  }
  if (user.role === 'contractor') {
    return <ContractorDashboard />;
  }

  const isReviewer = isReviewerRole(user.role);

  return (
    <main className="flex-1 overflow-y-auto">
      <DashboardHeader role={user.role} period={stats?.period} />
      <div className="space-y-6 px-8 pb-10">
        <KpiCards
          kpis={stats?.kpis}
          loading={loading}
          cards={
            isReviewer
                ? ['visibleProjects', 'pendingApprovals', 'delayedProjects', 'inputWarnings']
                : undefined
          }
        />
        {isReviewer ? (
          <>
            <div className="grid gap-6 xl:grid-cols-2">
              <ManagementAlerts role={user.role} />
              <RecentActivities />
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <ProgressChart />
              </div>
              <ManagementAlerts role={user.role} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
