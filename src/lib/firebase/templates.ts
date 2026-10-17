import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { COLLECTIONS } from './collections';
import { db, storage } from './config';
import { nowIso } from './ids';

const DEFAULT_CONFIG: Record<
  string,
  { label: string; description: string; fields: Array<Record<string, unknown>> }
> = {
  SWA: {
    label: 'Statement of Work Accomplished',
    description: 'Weekly accomplishment statement',
    fields: [],
  },
  STEWA: {
    label: 'Statement of Time Extension / Work Accomplished',
    description: 'Slippage and time extension report',
    fields: [],
  },
  IAR: {
    label: 'Inspection Acceptance Report',
    description: 'Contractor inspection acceptance',
    fields: [],
  },
  PROGRESS: {
    label: 'Progress Report',
    description: 'Legacy progress report',
    fields: [],
  },
};

export async function fetchTemplatesFs(type: string) {
  const snap = await getDoc(doc(db, COLLECTIONS.reportTemplates, type));
  if (snap.exists()) {
    const data = snap.data() as Record<string, unknown>;
    return {
      config: {
        label: String(data.label ?? type),
        description: String(data.description ?? ''),
        fields: (data.fields as Array<Record<string, unknown>>) ?? [],
      },
      storagePath: (data.storagePath as string | undefined) ?? undefined,
      downloadUrl: (data.downloadUrl as string | undefined) ?? undefined,
      fileName: (data.fileName as string | undefined) ?? undefined,
      updatedAt: (data.updatedAt as string | undefined) ?? undefined,
    };
  }
  return { config: DEFAULT_CONFIG[type] ?? DEFAULT_CONFIG.PROGRESS };
}

export async function uploadTemplateFs(type: string, file: File) {
  const path = `templates/${type}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  await setDoc(
    doc(db, COLLECTIONS.reportTemplates, type),
    {
      label: DEFAULT_CONFIG[type]?.label ?? type,
      description: DEFAULT_CONFIG[type]?.description ?? '',
      fields: DEFAULT_CONFIG[type]?.fields ?? [],
      storagePath: path,
      downloadUrl: url,
      fileName: file.name,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  return { message: 'Template uploaded', url };
}
