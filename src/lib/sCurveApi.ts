import { apiFetch } from './http';
import { apiUrl } from './paths';
import type { ReportProgressEntry } from '../components/ReportProgressFeed';
import type { SCurvePoint } from '../types';

export interface SCurveActivity {
  number: string;
  name: string;
  duration: number;
  es: number;
  ef: number;
  finish_date: string;
  planned_pct: number;
  is_critical: boolean;
}

export type ScheduleStatusCode = 'target_only' | 'on_schedule' | 'ahead' | 'behind' | 'unknown';

export interface ScheduleStatus {
  status: ScheduleStatusCode;
  slippage_pct: number | null;
  planned_pct: number | null;
  actual_pct: number | null;
  label: string;
}

export interface SCurveSnapshotSummary {
  id: number;
  captured_at: string;
  trigger_type: string;
  trigger_label: string | null;
  schedule_status: string | null;
  slippage_pct: number | null;
  planned_pct: number | null;
  actual_pct: number | null;
}

export interface SCurveComparison {
  date: string;
  date_label: string;
  target_pct: number;
  actual_pct: number;
  variance_pct: number;
  status: 'on_schedule' | 'ahead' | 'behind';
  status_label: string;
}

export function getSCurve(projectId = 1, snapshotId?: number | null) {
  const params = new URLSearchParams({ project_id: String(projectId) });
  if (snapshotId != null && snapshotId > 0) {
    params.set('snapshot_id', String(snapshotId));
  }
  return apiFetch<{
    project_id: number;
    project_duration: number;
    project_start_date: string;
    project_end_date: string;
    critical_path: string[];
    points: SCurvePoint[];
    activities: SCurveActivity[];
    synced_from_pdm: boolean;
    has_actual_progress: boolean;
    has_revised_schedule: boolean;
    schedule_status: ScheduleStatus;
    comparisons: SCurveComparison[];
    report_feed: ReportProgressEntry[];
    latest_report_percent: number | null;
    latest_report_date: string | null;
    versions: SCurveSnapshotSummary[];
    viewing_snapshot_id: number | null;
    viewing_snapshot_label: string | null;
    viewing_snapshot_at: string | null;
  }>(apiUrl('s_curve.php', params.toString()));
}
