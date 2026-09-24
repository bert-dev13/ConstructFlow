import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

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

/** Render an HTML element (or iframe body) to a multi-page A4 PDF and download it. */
export async function downloadElementAsPdf(element: HTMLElement, fileName: string) {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
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
  const imgData = canvas.toDataURL('image/png');

  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(safeName);
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
