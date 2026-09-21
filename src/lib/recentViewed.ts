const VIEWED_KEY = 'sitetrack_recent_viewed_reports';
const MAX_VIEWED = 12;

export function getRecentlyViewedReportIds(): string[] {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((n) => String(n))
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

export function trackReportViewed(reportId: string): void {
  if (!reportId) return;
  const prev = getRecentlyViewedReportIds().filter((id) => id !== reportId);
  const next = [reportId, ...prev].slice(0, MAX_VIEWED);
  localStorage.setItem(VIEWED_KEY, JSON.stringify(next));
}
