import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { buildOfficialReportHtml } from './officialReportHtml';
import type { SwaStewaReport } from './swaStewaApi';

function triggerAnchorDownload(href: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Download an existing PDF URL (Storage / CDN). */
export async function downloadPdfFromUrl(url: string, fileName: string) {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not fetch PDF');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerAnchorDownload(objectUrl, safeName);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    // Cross-origin Storage URLs may block fetch; open in a new tab instead.
    triggerAnchorDownload(url, safeName);
  }
}

/** Same A4 capture used by report download. */
export async function elementToPdfBlob(element: HTMLElement, format: 'PNG' | 'JPEG' = 'PNG'): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: '#ffffff',
  });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;
  const imgData = format === 'JPEG' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');

  pdf.addImage(imgData, format, 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, format, 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  return pdf.output('blob');
}

/** Render an HTML element (or iframe body) to a multi-page A4 PDF and download it. */
export async function downloadElementAsPdf(element: HTMLElement, fileName: string) {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const blob = await elementToPdfBlob(element);
  const objectUrl = URL.createObjectURL(blob);
  triggerAnchorDownload(objectUrl, safeName);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the approved PDF.'));
    reader.readAsDataURL(blob);
  });
}

/** Official approved report, rendered the same way as Download PDF. */
export async function officialReportPdfBase64(report: SwaStewaReport): Promise<string> {
  const html = buildOfficialReportHtml(report);
  if (!html) throw new Error('This report has no approved document.');

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;left:-12000px;top:0;width:900px;height:1200px;border:0;background:#fff;';
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = html;
    });
    const body = iframe.contentDocument?.body;
    if (!body) throw new Error('Could not render the approved report.');
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    iframe.style.height = `${Math.max(body.scrollHeight, body.offsetHeight, 1200)}px`;
    const blob = await elementToPdfBlob(body, 'JPEG');
    return blobToBase64(blob);
  } finally {
    iframe.remove();
  }
}

/** Prefer a stored PDF URL; otherwise capture the iframe/document body. */
export async function downloadReportPreviewPdf(options: {
  fileName: string;
  pdfUrl?: string | null;
  frame?: HTMLIFrameElement | null;
  element?: HTMLElement | null;
}) {
  const { fileName, pdfUrl, frame, element } = options;
  if (pdfUrl) {
    await downloadPdfFromUrl(pdfUrl, fileName);
    return;
  }

  const target =
    element ??
    frame?.contentDocument?.body ??
    frame?.contentDocument?.documentElement ??
    null;

  if (!target) {
    throw new Error('Preview content is not ready to download.');
  }

  await downloadElementAsPdf(target as HTMLElement, fileName);
}
