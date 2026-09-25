import { jsPDF } from 'jspdf';
import type { SCurvePoint } from '../types';
import type { BarChartTask } from '../types';
import type { ScheduleStatus, SCurveComparison } from './sCurveApi';
import type { SCurvePeriodRow } from './sCurvePeriods';

function formatMoney(value: number): string {
  return value.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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

export type SCurvePdfInput = {
  projectLabel?: string;
  points: SCurvePoint[];
  comparisons: SCurveComparison[];
  periods: SCurvePeriodRow[];
  status: ScheduleStatus | null;
  targetPlanPercent?: number | null;
  targetPlanPhp?: number | null;
  actualPlanPercent?: number | null;
};

export type BarChartPdfInput = {
  projectLabel?: string;
  tasks: BarChartTask[];
  totalDays: number;
  timeNow: number;
  status: ScheduleStatus | null;
  targetPlanPercent?: number | null;
  actualPlanPercent?: number | null;
};

/** Build the S-Curve PDF from the same synchronized page data used on screen. */
export function buildSCurvePdf(input: SCurvePdfInput): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  addHeader(doc, `S-Curve Progress — ${input.projectLabel ?? 'Project'}`);
  let y = addStatusBlock(doc, input.status, 40);

  if (input.targetPlanPercent != null || input.targetPlanPhp != null) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Current cumulative target: ${
        input.targetPlanPercent != null ? `${input.targetPlanPercent}%` : '—'
      }   ·   ${
        input.targetPlanPhp != null ? `P ${formatMoney(input.targetPlanPhp)}` : '—'
      }`,
      14,
      y,
    );
    y += 8;
  }

  if (input.periods.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Monthly Target Accomplishment Baseline', 14, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const baselineHeaders = ['Period', 'Date range', 'Target %', 'Target PHP', 'Cumulative %', 'Cumulative PHP'];
    const baselineCols = [14, 36, 98, 126, 162, 190];
    baselineHeaders.forEach((header, index) => doc.text(header, baselineCols[index]!, y));
    y += 5;
    doc.setFont('helvetica', 'normal');

    for (const period of input.periods) {
      if (y > 185) {
        doc.addPage();
        y = 20;
      }
      const row = [
        period.label,
        `${period.startDate} to ${period.endDate}`,
        `${period.targetAccomplishmentPct.toFixed(2)}%`,
        `P ${formatMoney(period.targetAccomplishmentPhp)}`,
        `${period.cumulativePct.toFixed(2)}%`,
        `P ${formatMoney(period.cumulativePhp)}`,
      ];
      row.forEach((cell, index) => doc.text(String(cell).slice(0, 30), baselineCols[index]!, y));
      y += 5;
    }
    y += 4;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Target Plan vs Actual Plan (by date)', 14, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const headers = ['Date', 'Label', 'Target Plan %', 'Target PHP', 'Actual Plan %', 'Variance', 'Status'];
  const cols = [14, 38, 92, 120, 150, 176, 204];
  headers.forEach((h, i) => doc.text(h, cols[i]!, y));
  y += 5;
  doc.setFont('helvetica', 'normal');

  const rows =
    input.comparisons.length > 0
      ? input.comparisons.map((c) => [
          c.date,
          c.date_label,
          String(c.target_pct),
          `P ${formatMoney(c.target_php)}`,
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
            p.cumulativePhp != null ? `P ${formatMoney(p.cumulativePhp)}` : '—',
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
    row.forEach((cell, i) => doc.text(String(cell).slice(0, 28), cols[i]!, y));
    y += 5;
  }

  return doc;
}

/** Build the Bar Chart PDF from the same synchronized page data used on screen. */
export function buildBarChartPdf(input: BarChartPdfInput): jsPDF {
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
    doc.text(h, cols[i]!, y),
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
    row.forEach((cell, i) => doc.text(cell, cols[i]!, y));
    y += 5;
  }

  return doc;
}

export function sCurvePdfObjectUrl(input: SCurvePdfInput): string {
  return URL.createObjectURL(buildSCurvePdf(input).output('blob'));
}

export function barChartPdfObjectUrl(input: BarChartPdfInput): string {
  return URL.createObjectURL(buildBarChartPdf(input).output('blob'));
}

export function exportSCurvePdf(input: SCurvePdfInput) {
  buildSCurvePdf(input).save(`s-curve-${Date.now()}.pdf`);
}

export function exportBarChartPdf(input: BarChartPdfInput) {
  buildBarChartPdf(input).save(`bar-chart-${Date.now()}.pdf`);
}
