/** Helpers for opening HTML/PDF previews in PreviewModal iframes. */

const PRINT_BASE_CSS = `
  html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  h2 { font-size: 15px; margin: 16px 0 8px; }
  .muted, .text-text-muted { color: #64748b; font-size: 12px; margin-bottom: 8px; }
  .text-sm { font-size: 13px; }
  .text-xs { font-size: 11px; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  svg { max-width: 100%; height: auto; display: block; margin: 12px 0; }
  img { max-width: 100%; height: auto; }
  .bar { height: 12px; border-radius: 2px; background: #2563eb; }
  .bar-actual { background: #16a34a; }
  .critical { color: #b91c1c; font-weight: 600; }
  @media print {
    body { padding: 0; }
    a { color: inherit; text-decoration: none; }
  }
`;

export function printPreviewFrame(frameId: string) {
  const frame = document.getElementById(frameId) as HTMLIFrameElement | null;
  printPreviewIframe(frame);
}

/**
 * Print preview content in a dedicated window so the browser does not print
 * the surrounding app chrome. Prefer this over iframe.contentWindow.print().
 */
export function printPreviewIframe(frame: HTMLIFrameElement | null | undefined) {
  if (!frame) return;

  const srcDoc = frame.getAttribute('srcdoc') || frame.srcdoc;
  if (typeof srcDoc === 'string' && srcDoc.trim()) {
    openAndPrintHtml(srcDoc);
    return;
  }

  try {
    const doc = frame.contentDocument;
    if (doc?.documentElement) {
      openAndPrintHtml('<!DOCTYPE html>' + doc.documentElement.outerHTML);
      return;
    }
  } catch {
    // Cross-origin iframe (e.g. remote PDF URL) — fall through.
  }

  try {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  } catch {
    // Ignore; caller already has the preview on screen.
  }
}

/** Clone a DOM subtree into a print window (charts, tables, etc.). */
export function printHtmlElement(element: HTMLElement | null | undefined, title = 'Preview') {
  if (!element) return;

  const clone = element.cloneNode(true) as HTMLElement;

  // Canvas pixels do not survive cloneNode — replace with images.
  const sourceCanvases = element.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  sourceCanvases.forEach((canvas, index) => {
    const target = cloneCanvases[index];
    if (!target) return;
    try {
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.alt = title;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      target.replaceWith(img);
    } catch {
      // Tainted canvas — leave as-is.
    }
  });

  openAndPrintHtml(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(
      title,
    )}</title><style>${PRINT_BASE_CSS}</style></head><body>${clone.innerHTML}</body></html>`,
  );
}

export function openAndPrintHtml(html: string) {
  // Do not pass noopener — it makes window.open() return null in modern browsers.
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) {
    // Popup blocked: last-resort same-tab print via hidden iframe.
    printViaHiddenFrame(html);
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  const trigger = () => {
    try {
      win.focus();
      const closeLater = () => {
        window.setTimeout(() => {
          try {
            win.close();
          } catch {
            // ignore
          }
        }, 250);
      };
      win.addEventListener('afterprint', closeLater, { once: true });
      win.print();
      // Fallback if afterprint never fires (some browsers).
      window.setTimeout(closeLater, 60_000);
    } catch {
      try {
        win.close();
      } catch {
        // ignore
      }
    }
  };

  // Allow layout/images to settle before opening the dialog.
  if (win.document.readyState === 'complete') {
    window.setTimeout(trigger, 300);
  } else {
    win.addEventListener('load', () => window.setTimeout(trigger, 300), { once: true });
  }
}

function printViaHiddenFrame(html: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Print frame');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  window.setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 1000);
    }
  }, 300);
}

export function revokeObjectUrl(url: string | null | undefined) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Wrap official report HTML (or SVG fragment) for iframe srcDoc preview. */
export function wrapPreviewDocument(
  title: string,
  bodyHtml: string,
  extraCss = '',
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${PRINT_BASE_CSS}
${extraCss}</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

const PDM_PREVIEW_CSS = `
  body { padding: 12px 16px 20px; }
  h1 { font-size: 16px; margin: 0 0 4px; color: #0f1c2e; }
  .muted { margin-bottom: 12px; }
  .diagram-wrap {
    overflow: auto;
    border: 1px solid #d0dae6;
    border-radius: 12px;
    background: #f8fafb;
    background-image: radial-gradient(circle at 1px 1px, rgba(11, 58, 92, 0.06) 1px, transparent 0);
    background-size: 18px 18px;
    padding: 12px;
  }
  .diagram-wrap svg {
    margin: 0;
    max-width: none;
    height: auto;
    display: block;
  }
  .diagram-wrap .pdm-edge-draw,
  .diagram-wrap .pdm-node-in,
  .diagram-wrap .pdm-label-in {
    animation: none !important;
    opacity: 1 !important;
    filter: none !important;
    stroke-dasharray: none !important;
    stroke-dashoffset: 0 !important;
  }
  .diagram-wrap text.fill-text { fill: #0f1c2e; }
  .diagram-wrap text.fill-text-muted { fill: #5a6b7d; }
  .diagram-wrap text.fill-slate-700 { fill: #334155; }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 18px;
    margin-top: 14px;
    padding: 10px 12px;
    border: 1px solid #d0dae6;
    border-radius: 10px;
    background: #fff;
    font-size: 11px;
    color: #5a6b7d;
  }
  .legend-item { display: inline-flex; align-items: center; gap: 8px; }
  .swatch-line { display: inline-block; width: 22px; height: 3px; border-radius: 2px; }
  .swatch-box {
    display: inline-block;
    width: 28px;
    height: 16px;
    border-radius: 3px;
    background: #fff;
  }
  @media print {
    @page { size: landscape; margin: 10mm; }
    body { padding: 0; }
    .diagram-wrap { border: none; padding: 0; overflow: visible; }
    .legend { break-inside: avoid; }
  }
`;

/**
 * Clone the on-screen PDM network SVG into a self-contained markup string
 * suitable for PreviewModal / print (no activity table).
 */
export function serializePdmNetworkSvg(svg: SVGSVGElement | null | undefined): string {
  if (!svg) return '';
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  clone.style.animation = 'none';

  const viewBox = clone.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    const vbW = parts[2];
    const vbH = parts[3];
    if (vbW && vbH) {
      clone.setAttribute('width', String(Math.max(vbW, 640)));
      clone.setAttribute('height', String(Math.max(vbH, 300)));
    }
  }

  clone.querySelectorAll('path.pdm-edge-draw, path[class*="pdm-edge"]').forEach((path) => {
    path.removeAttribute('style');
    path.setAttribute('stroke-dasharray', 'none');
    path.setAttribute('stroke-dashoffset', '0');
    path.setAttribute('opacity', '1');
  });
  clone.querySelectorAll('[class*="pdm-node-in"], [class*="pdm-label-in"]').forEach((node) => {
    (node as SVGElement).style.opacity = '1';
    (node as SVGElement).style.filter = 'none';
    (node as SVGElement).style.animation = 'none';
  });

  return new XMLSerializer().serializeToString(clone);
}

/** Build the PDM Preview / Print document showing the network diagram only. */
export function buildPdmNetworkPreviewHtml(input: {
  projectLabel: string;
  projectDuration: number;
  criticalPath: string;
  svg: SVGSVGElement | null | undefined;
}): string {
  const svgHtml = serializePdmNetworkSvg(input.svg);
  const body = `
    <h1>Network Diagram — ${escapeHtml(input.projectLabel)}</h1>
    <p class="muted">Duration: ${input.projectDuration} days · Critical path: ${escapeHtml(input.criticalPath || '—')}</p>
    <div class="diagram-wrap">
      ${svgHtml || '<p class="muted">Network diagram is not available.</p>'}
    </div>
    <div class="legend">
      <span class="legend-item"><span class="swatch-line" style="background:#dc2626"></span> Critical path</span>
      <span class="legend-item"><span class="swatch-line" style="background:#5a6b7d"></span> Dependency</span>
      <span class="legend-item"><span class="swatch-box" style="border:2px solid #0b3a5c"></span> Start / end</span>
      <span class="legend-item"><span class="swatch-box" style="border:1px dashed #6b7c72;background:#f8faf8"></span> Until project end</span>
    </div>`;
  return wrapPreviewDocument('PDM Network Diagram', body, PDM_PREVIEW_CSS);
}

