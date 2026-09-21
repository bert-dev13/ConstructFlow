import { jsPDF } from 'jspdf';
import type { SCurvePoint } from '../types';
import type { BarChartTask } from '../types';
import type { ScheduleStatus, SCurveComparison } from './sCurveApi';

function addHeader(doc: jsPDF, title: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ConstructFlow', 14, 18);
  doc.setFontSize(12);
  doc.text(title, 14, 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 32);
  doc.setTextColor(0);
}

function addStatusBlock(doc: jsPDF, status: ScheduleStatus | null, y: number): number {
  if (!status) return y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Status: ${status.label}`, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const lines: string[] = [];
  if (status.planned_pct != null) lines.push(`Target Plan: ${status.planned_pct}%`);
  if (status.actual_pct != null) lines.push(`Actual Plan: ${status.actual_pct}%`);
  if (status.slippage_pct != null) lines.push(`Variance: ${status.slippage_pct}%`);
  doc.text(lines.join('   ·   '), 14, y + 7);
  return y + 16;
}

export function exportSCurvePdf(input: {
  projectLabel?: string;
  points: SCurvePoint[];
  comparisons: SCurveComparison[];
  status: ScheduleStatus | null;
  targetPlanPercent?: number | null;
  actualPlanPercent?: number | null;
}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  addHeader(doc, `S-Curve Progress — ${input.projectLabel ?? 'Project'}`);
  let y = addStatusBlock(doc, input.status, 40);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Target Plan vs Actual Plan (by date)', 14, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const headers = ['Date', 'Label', 'Target Plan %', 'Actual Plan %', 'Variance', 'Status'];
  const cols = [14, 40, 100, 130, 160, 190];
  headers.forEach((h, i) => doc.text(h, cols[i], y));
  y += 5;
  doc.setFont('helvetica', 'normal');

  const rows =
    input.comparisons.length > 0
      ? input.comparisons.map((c) => [
          c.date,
          c.date_label,
          String(c.target_pct),
          String(c.actual_pct),
          String(c.variance_pct),
          c.status_label,
        ])
      : input.points
          .filter((p) => p.originalPlan != null || p.actual != null)
          .map((p) => [
            p.date,
            p.label ?? '',
            p.originalPlan != null ? String(p.originalPlan) : '—',
            p.actual != null ? String(p.actual) : '—',
            p.originalPlan != null && p.actual != null
              ? String(Math.round((Number(p.actual) - Number(p.originalPlan)) * 100) / 100)
              : '—',
            '',
          ]);

  for (const row of rows) {
    if (y > 190) {
      doc.addPage();
      y = 20;
    }
    row.forEach((cell, i) => doc.text(String(cell).slice(0, 28), cols[i], y));
    y += 5;
  }

  doc.save(`s-curve-${Date.now()}.pdf`);
}

export function exportBarChartPdf(input: {
  projectLabel?: string;
  tasks: BarChartTask[];
  totalDays: number;
  timeNow: number;
  status: ScheduleStatus | null;
  targetPlanPercent?: number | null;
  actualPlanPercent?: number | null;
}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  addHeader(doc, `Bar Chart Schedule — ${input.projectLabel ?? 'Project'}`);
  let y = addStatusBlock(doc, input.status, 40);

  doc.setFontSize(9);
  doc.text(
    `Total days: ${input.totalDays}   ·   Time Now: ${input.timeNow || '— (Target Plan only)'}`,
    14,
    y,
  );
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const cols = [14, 28, 120, 145, 170, 195];
  ['#', 'Task', 'Start', 'End', 'Actual end', 'Critical'].forEach((h, i) =>
    doc.text(h, cols[i], y),
  );
  y += 5;
  doc.setFont('helvetica', 'normal');

  for (const task of input.tasks) {
    if (y > 190) {
      doc.addPage();
      y = 20;
    }
    const row = [
      String(task.index),
      task.name.slice(0, 40),
      String(task.startDay),
      String(task.endDay),
      task.actualEndDay != null ? String(task.actualEndDay) : '—',
      task.isCritical ? 'Yes' : '',
    ];
    row.forEach((cell, i) => doc.text(cell, cols[i], y));
    y += 5;
  }

  doc.save(`bar-chart-${Date.now()}.pdf`);
}
