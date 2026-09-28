import { ROLE_LABELS, type Role } from '../types';
import type { ApprovalActorState, ContractorConfirmationState, ReportApprovalFlow } from './swaStewaApi';

export type SignatorySlot = 'engineer_1' | 'engineer_2' | 'engineer_3' | 'engineer_4' | 'contractor';

export type DocumentSignatory = {
  slot: SignatorySlot;
  label: string;
  officeTitle: string;
};

const SIGNATORIES: Record<'SWA' | 'STEWA' | 'IAR', DocumentSignatory[]> = {
  SWA: [
    { slot: 'engineer_1', label: 'Prepared by:', officeTitle: 'Engineer I' },
    { slot: 'engineer_2', label: 'Checked by:', officeTitle: 'Engineer II' },
    { slot: 'engineer_3', label: 'Recommending Approval:', officeTitle: 'Engineer III' },
    { slot: 'engineer_4', label: 'Approved:', officeTitle: 'Engineer IV' },
    { slot: 'contractor', label: 'Conforme:', officeTitle: "Contractor's Representative" },
  ],
  STEWA: [
    { slot: 'engineer_1', label: 'Submitted by:', officeTitle: 'Engineer I' },
    { slot: 'engineer_2', label: 'Checked by:', officeTitle: 'Engineer II' },
    { slot: 'engineer_3', label: 'Noted by:', officeTitle: 'Engineer III' },
    { slot: 'engineer_4', label: 'Approved:', officeTitle: 'Engineer IV' },
    { slot: 'contractor', label: 'Conforme:', officeTitle: "Contractor's Representative" },
  ],
  IAR: [
    { slot: 'engineer_1', label: 'Prepared by:', officeTitle: 'PEO Engineer I' },
    { slot: 'engineer_2', label: 'Checked by:', officeTitle: 'PEO Engineer II' },
    { slot: 'engineer_3', label: 'Noted by:', officeTitle: 'PEO Engineer III' },
    { slot: 'contractor', label: 'Conforme:', officeTitle: "Contractor's Representative" },
    { slot: 'engineer_4', label: 'Approved by:', officeTitle: 'PEO Engineer IV' },
  ],
};

export function documentSignatories(reportType: 'SWA' | 'STEWA' | 'IAR'): DocumentSignatory[] {
  return SIGNATORIES[reportType];
}

export function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part && part !== '-' && !part.startsWith('('));
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

export function designationForRole(role: Role, saved?: string | null): string {
  const custom = String(saved ?? '').trim();
  if (custom) return custom;
  return ROLE_LABELS[role];
}

/** Image signatures must be an image data URL or https URL saved on that user. */
export function safeSignatureSrc(value: string | null | undefined): string | null {
  const src = String(value ?? '').trim();
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+$/.test(src)) return src;
  if (/^https:\/\/[^\s"'<>]+$/.test(src)) return src;
  return null;
}

type SignedMark = {
  role: SignatorySlot;
  name: string;
  designation: string;
  initials: string;
  signature: string | null;
  approvedAt: string;
};

function actorMark(slot: SignatorySlot, actor: ApprovalActorState | null | undefined): SignedMark | null {
  if (!actor?.approved_by || actor.approved_role !== slot) return null;
  return {
    role: slot,
    name: String(actor.signatory_name ?? '').trim(),
    designation: String(actor.signatory_designation ?? '').trim() || designationForRole(slot as Role),
    initials: String(actor.signatory_initials ?? '').trim(),
    signature: safeSignatureSrc(actor.signatory_signature),
    approvedAt: String(actor.approved_at ?? ''),
  };
}

function contractorMark(state: ContractorConfirmationState | null | undefined): SignedMark | null {
  if (!state?.confirmed_by || state.confirmed_role !== 'contractor') return null;
  return {
    role: 'contractor',
    name: String(state.signatory_name ?? '').trim(),
    designation: String(state.signatory_designation ?? '').trim() || designationForRole('contractor'),
    initials: String(state.signatory_initials ?? '').trim(),
    signature: safeSignatureSrc(state.signatory_signature),
    approvedAt: String(state.confirmed_at ?? ''),
  };
}

export function signatoryForSlot(
  flow: ReportApprovalFlow | null | undefined,
  slot: SignatorySlot,
): SignedMark | null {
  if (!flow) return null;
  if (slot === 'contractor') return contractorMark(flow.contractor_confirmation);
  if (slot === 'engineer_1') return actorMark(slot, flow.engineer_1);
  if (slot === 'engineer_2') return actorMark(slot, flow.engineer_2);
  if (slot === 'engineer_3') return actorMark(slot, flow.engineer_3);
  return actorMark(slot, flow.engineer_4);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function savedSignatoryText(reportData: Record<string, unknown> | null | undefined, key: string): string {
  return String(reportData?.[key] ?? '').trim();
}

export function signatureSectionHtml(
  reportType: 'SWA' | 'STEWA' | 'IAR',
  flow: ReportApprovalFlow | null | undefined,
  reportData?: Record<string, unknown> | null,
): string {
  const cells = documentSignatories(reportType)
    .map((slot) => {
      const mark = signatoryForSlot(flow, slot.slot);
      const shownName = savedSignatoryText(reportData, `sig_${slot.slot}_name`) || mark?.name || '';
      const shownInitials =
        savedSignatoryText(reportData, `sig_${slot.slot}_initials`) || mark?.initials || '';
      const name = shownName ? escapeHtml(shownName) : '&nbsp;';
      const title = escapeHtml(slot.officeTitle);
      const markContent = mark?.signature
        ? `<img class="sig-image" src="${escapeHtml(mark.signature)}" alt="" />`
        : shownInitials
          ? `<div class="sig-initials">${escapeHtml(shownInitials)}</div>`
          : '';
      return `<div class="sig"><div>${escapeHtml(slot.label)}</div><div class="sig-mark">${markContent}</div><div class="sig-name">${name}</div><div class="sig-title">${title}</div></div>`;
    })
    .join('');
  return `<div class="signatures">${cells}</div>`;
}
