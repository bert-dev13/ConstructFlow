import { fetchTemplatesFs, uploadTemplateFs } from './firebase/templates';

/** Report templates (SWA/STEWA/IAR/PROGRESS). */
export function fetchTemplates(type: string) {
  return fetchTemplatesFs(type);
}

export async function generateReport(payload: Record<string, unknown>) {
  // Legacy progress-report generator — redirect callers to SWA/STEWA save path.
  return {
    preview_url: '',
    id: String(payload.id ?? ''),
    message: 'Use SWA/STEWA editor to generate reports on Firebase.',
  };
}

export function uploadTemplate(type: string, file: File) {
  return uploadTemplateFs(type, file);
}
