'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { printHtmlElement, printPreviewIframe } from '../../lib/previewHelpers';
import { Button } from './Button';

export function PreviewModal({
  title,
  open,
  onClose,
  onDownload,
  onPrint,
  downloading = false,
  downloadLabel = 'Download PDF',
  children,
  iframeSrc,
  iframeSrcDoc,
  iframeTitle = 'Preview',
  wide = false,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onDownload?: () => void;
  /** Override default print. Prefer omitting this so the modal prints the preview itself. */
  onPrint?: () => void;
  downloading?: boolean;
  downloadLabel?: string;
  children?: ReactNode;
  /** PDF or document URL for iframe preview */
  iframeSrc?: string;
  /** HTML document for iframe preview */
  iframeSrcDoc?: string;
  iframeTitle?: string;
  wide?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const useIframe = Boolean(iframeSrc || iframeSrcDoc);

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
      return;
    }
    if (useIframe) {
      printPreviewIframe(iframeRef.current);
      return;
    }
    printHtmlElement(contentRef.current, title);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${
          wide ? 'max-w-6xl' : 'max-w-4xl'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted/50 px-5 py-4">
          <h3 className="font-semibold text-text">{title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {onDownload ? (
              <Button
                type="button"
                variant="ghost"
                disabled={downloading}
                onClick={() => onDownload()}
              >
                {downloading ? 'Preparing…' : downloadLabel}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={handlePrint}>
              Print
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        {useIframe ? (
          <iframe
            ref={iframeRef}
            title={iframeTitle}
            src={iframeSrc}
            srcDoc={iframeSrcDoc}
            className="min-h-[65vh] flex-1 w-full border-0 bg-white"
          />
        ) : (
          <div ref={contentRef} className="min-h-[50vh] flex-1 overflow-auto bg-white p-4 sm:p-6">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
