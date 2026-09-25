'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, usePathname, useSearchParams } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { IarAccomplishmentTable } from '../components/IarAccomplishmentTable';
import { IarResourceTable } from '../components/IarResourceTable';
import { IarVariationTable } from '../components/IarVariationTable';
import { ProjectSelect } from '../components/ProjectSelect';
import { WorkItemsTable } from '../components/WorkItemsTable';
import { newIarItem, newManpowerRow, newVariationItem, type IarAccomplishmentItem, type IarManpowerRow, type IarVariationItem } from '../lib/iarItems';
import { computeStewaSlippage, computeWorkItems, newWorkItem, type WorkItem } from '../lib/workItems';
import { applyStewaDerivedFields, stewaDash, stewaPercentText } from '../lib/stewaCalculations';
import { buildOfficialReportHtml } from '../lib/officialReportHtml';
import { getProject, listProjects } from '../lib/projectsApi';
import { type ProjectBoqItem } from '../lib/projectBoqApi';
import { resolveItemUnit } from '../lib/boqLookup';
import { listProjectItemOptions } from '../lib/projectBoqSync';
import { buildReferenceWorkItems } from '../data/roadProjectReference';
import {
  approveReport,
  contractorConfirm,
  getReport,
  getIarProgress,
  getStewaFromSwa,
  listReportRevisions,
  markReportViewed,
  rejectReport,
  retryApprovalEmail,
  saveReport,
  sendToContractor,
  submitReport,
  type ContractorChange,
  type SwaStewaReport,
  type SwaStewaStatus,
} from '../lib/swaStewaApi';
import { trackReportViewed } from '../lib/recentViewed';
import { downloadReportPreviewPdf } from '../lib/downloadReportPdf';
import { EmailNoticeStatus } from '../components/EmailNoticeStatus';
import { Button, ButtonLink } from '../components/ui/Button';
import { FormField, TextArea, TextInput } from '../components/ui/FormField';
import { FormSection } from '../components/ui/FormSection';
import { PageHeader } from '../components/ui/PageHeader';
import { PreviewModal } from '../components/ui/PreviewModal';
import { ReportTypeBadge } from '../components/ui/StatusBadge';
import { SubmissionSuccessSign } from '../components/ui/SubmissionSuccessSign';
import { UndoRedoToolbar } from '../components/ui/UndoRedoToolbar';
import { useUndoRedo, useUndoRedoKeyboard } from '../hooks/useUndoRedo';
import {
  canEditReport,
  reportIsViewOnly,
  statusLabel,
  type SwaStewaReportKind,
} from '../lib/reportPermissions';

type ReportEditorSnapshot = {
  projectId: string;
  data: Record<string, string>;
  lineItems: WorkItem[];
  iarItems: IarAccomplishmentItem[];
  variationItems: IarVariationItem[];
  manpower: IarManpowerRow[];
  equipment: IarManpowerRow[];
  activitiesText: string;
  fieldInstructionsText: string;
};

function createInitialSnapshot(isContractor: boolean, userName: string): ReportEditorSnapshot {
  return {
    projectId: '',
    data: {
      report_date: new Date().toISOString().slice(0, 10),
      project_name: '',
      location: '',
      contract_amount: '',
      contractor: '',
      submitted_by_name: userName,
      submitted_by_title: isContractor ? 'Contractor Representative' : 'Engineer II',
      inspected_by_name: userName,
      inspected_by_title: isContractor ? 'Contractor Representative' : 'Engineer II',
      acceptance_status: 'Accepted',
      noted_by_name: 'KATHLEEN MEI P. BAGASIN',
      noted_by_title: 'Engineer IV (Chief-Construction Division)',
      prepared_by_name: userName,
      prepared_by_title: isContractor ? 'Contractor Representative' : 'Engineer I',
      checked_by_name: 'KATHLEEN MEI P. BAGASIN',
      checked_by_title: 'Chief of Construction Division',
      recommending_name: 'KINGSTON JAMES S. DELA CRUZ',
      recommending_title: 'Provincial Engineer',
      approved_by_name: 'GEN. EDGAR B. AGLIPAY (RET.)',
      approved_by_title: 'Governor',
      less_reason: 'Advance Payment',
      less_amount: '359431.86',
      contract_number: 'B011 - 2023',
      project_title: '',
      municipality: 'Tuao',
      week_covered: '',
      problems_remarks: '',
      orig_target: '',
      rev_target: '',
      actual_progress: '',
      variance: '',
      progress_remarks: 'On-going',
      contractor_representative: isContractor ? userName : '',
    },
    lineItems: [newWorkItem()],
    iarItems: [newIarItem()],
    variationItems: [newVariationItem()],
    manpower: [newManpowerRow()],
    equipment: [newManpowerRow()],
    activitiesText: '',
    fieldInstructionsText: '',
  };
}

const STEWA_DERIVE_KEYS = new Set([
  'report_date',
  'contract_duration',
  'notice_to_proceed',
  'approved_time_extension',
  'approved_time_suspension',
  'percent_actual',
]);

const STEWA_FIELDS = [
  { key: 'report_date', label: 'As of', type: 'date', hint: 'Excel as-of date (I9). The period ends on this date.' },
  {
    key: 'period_covered',
    label: '1. Period Covered / Week Covered',
    type: 'text',
    computed: true,
    span2: true,
    hint: 'Start = notice to proceed + 9 days. End = as-of date. Shown as “date to date”.',
  },
  {
    key: 'contract_duration',
    label: '2. Contract Duration (days)',
    type: 'number',
    hint: 'Enter the contract duration in days.',
  },
  {
    key: 'notice_to_proceed',
    label: '3. Date of Receipt of Notice to Proceed',
    type: 'date',
    hint: 'Filled from the project start date when that date is the NTP.',
  },
  { key: 'expiry_date', label: '4. Expiry Date', type: 'date', computed: true, hint: 'Period start + contract duration.' },
  {
    key: 'approved_time_extension',
    label: '5. Approved Time Extension (days)',
    type: 'number',
    hint: 'Leave blank when there is no approved extension.',
  },
  { key: 'approved_time_suspension', label: '6. Approved Time Suspension (days)', type: 'number' },
  {
    key: 'total_time_extension',
    label: '7. Total Time Extension',
    type: 'text',
    computed: true,
    blankWhenZero: true,
    hint: 'Equals the approved time extension.',
  },
  {
    key: 'revised_contract_duration',
    label: '8. Revised Contract Duration',
    type: 'text',
    computed: true,
    blankWhenZero: true,
    hint: 'Extension + original duration when the extension is greater than 0. Otherwise blank.',
  },
  {
    key: 'revised_expiry_date',
    label: '9. Revised Expiry Date',
    type: 'date',
    computed: true,
    hint: 'Expiry date + suspension days + extension days.',
  },
  {
    key: 'calendar_days_elapsed',
    label: '10. Total Calendar days Elapsed to Date',
    type: 'text',
    computed: true,
    hint: 'As-of date − period start + 1 − approved suspension.',
  },
  {
    key: 'percent_actual',
    label: '11. Percentage of work accomplished - Actual',
    type: 'text',
    computed: true,
    percent: true,
    hint: 'From the SWA for this as-of date (total weight % accomplished).',
  },
  {
    key: 'percent_planned',
    label: '12. Percentage of work accomplished - Planned',
    type: 'text',
    computed: true,
    percent: true,
    hint: 'Sine formula on elapsed days and the original contract duration.',
  },
  {
    key: 'slippage',
    label: '13. Slippage',
    type: 'text',
    computed: true,
    percent: true,
    hint: 'Actual minus planned.',
  },
  { key: 'remarks', label: '14. Remarks', type: 'textarea', span2: true },
  { key: 'submitted_by_name', label: 'Submitted by (name)', type: 'text' },
  { key: 'submitted_by_title', label: 'Submitted by (title)', type: 'text' },
  { key: 'noted_by_name', label: 'Noted by (name)', type: 'text' },
  { key: 'noted_by_title', label: 'Noted by (title)', type: 'text' },
] as const;

export function SwaStewaEditorPage() {
  const { type: typeParam, id: routeId } = useParams<{ type?: string; id?: string }>();
  const pathname = usePathname();
  const [searchParams] = useSearchParams();
  const idParam =
    routeId
    || searchParams.get('id')
    || pathname.match(/\/swa-stewa\/edit\/([^/]+)/)?.[1];
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projectId: selectedProjectId, setProjectId: setSelectedProjectId } = useSelectedProject();
  const initialProjectRef = useRef(selectedProjectId);

  const isContractor = user?.role === 'contractor';
  const routeType =
    typeParam === 'SWA' || typeParam === 'STEWA' || typeParam === 'IAR' ? typeParam : null;
  const [reportType, setReportType] = useState<SwaStewaReportKind>(routeType ?? 'IAR');
  const [reportId, setReportId] = useState<string | undefined>(idParam || undefined);
  const savedReportIdRef = useRef<string | undefined>(idParam || undefined);
  const loadedProjectIdRef = useRef<string>(idParam ? 'pending' : '');
  const {
    state: editor,
    set: setEditor,
    replace: replaceEditor,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo<ReportEditorSnapshot>({
    ...createInitialSnapshot(isContractor, user?.name ?? ''),
    projectId: initialProjectRef.current,
  });
  const {
    projectId,
    data,
    lineItems,
    iarItems,
    variationItems,
    manpower,
    equipment,
    activitiesText,
    fieldInstructionsText,
  } = editor;
  const [status, setStatus] = useState('draft');
  const [emailNotice, setEmailNotice] = useState<{
    email_status?: SwaStewaReport['email_status'];
    email_sent_at?: string | null;
    email_error?: string | null;
    email_claimed_at?: string | null;
    email_recipients?: string[];
  }>({});
  const [reportNumber, setReportNumber] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [iarSourceRefresh, setIarSourceRefresh] = useState(0);
  const iarProgressRequest = useRef(0);
  const [downloadingPreview, setDownloadingPreview] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [contractorChanges, setContractorChanges] = useState<ContractorChange[]>([]);
  const [activeCommentField, setActiveCommentField] = useState<string | null>(null);
  const [revisionCount, setRevisionCount] = useState(0);
  const [editableUserIds, setEditableUserIds] = useState<string[]>([]);
  const [projectBoqItems, setProjectBoqItems] = useState<ProjectBoqItem[]>([]);
  const [projectBoqError, setProjectBoqError] = useState('');
  const autoSaveReady = useRef(false);
  const saveSeq = useRef(0);
  const savingRef = useRef(false);
  const skipNextLoad = useRef(false);
  const contractorBaselineRef = useRef<Record<string, string>>({});
  const fieldAnchorRefs = useRef<Record<string, HTMLElement | null>>({});
  const contractorDraftCommentMode =
    user?.role === 'contractor' &&
    (reportType === 'IAR' || reportType === 'STEWA') &&
    ['draft', 'pending_contractor', 'rejected'].includes(status);
  const contractorChangeByField = useMemo(
    () => new Map(contractorChanges.map((change) => [change.field, change])),
    [contractorChanges],
  );
  const missingChangeComments = useMemo(
    () => contractorChanges.filter((change) => !String(change.comment ?? '').trim()),
    [contractorChanges],
  );
  const showChangeCommentsPanel =
    contractorChanges.length > 0 &&
    (contractorDraftCommentMode || user?.role === 'engineer_1' || status === 'contractor_confirmed');

  const focusChangeField = useCallback((field: string) => {
    setActiveCommentField(field);
    const el = fieldAnchorRefs.current[field];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  useEffect(() => {
    if (!idParam && isContractor && routeType === 'IAR') {
      // IAR only — contractor SWA/STEWA access is via pending_contractor reports
    }
  }, [idParam, isContractor, routeType]);

  useEffect(() => {
    if (idParam) return;
    let cancelled = false;
    listProjects()
      .then((res) => {
        if (cancelled) return;
        const projects = res.projects;
        const current = String(projectId || '').trim();
        const currentOk = Boolean(current) && projects.some((p) => String(p.id) === current);
        if (currentOk) return;

        if (!projects.length) {
          // Stale localStorage ids (deleted demo/sample projects) must not stay bound —
          // reading `projects/{missingId}/boqItems` always permission-denies under rules.
          if (current) {
            setEditor((s) => (s.projectId === current ? { ...s, projectId: '' } : s));
            setSelectedProjectId('');
          }
          setProjectBoqItems([]);
          setProjectBoqError('Select a project first. Add or restore a project under Projects.');
          return;
        }

        const preferred =
          projects.find((p) => String(p.id) === String(selectedProjectId || '').trim())
          ?? projects[0];
        const nextId = String(preferred.id);
        setEditor((s) => ({ ...s, projectId: nextId }));
        setSelectedProjectId(nextId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // New reports only: bind to an accessible project (never a deleted/missing id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam]);

  useEffect(() => {
    const id = String(projectId || '').trim();
    if (!id || id === '1') return;
    // Saved SWA/STEWA keep the header already stored on the report.
    if (idParam && reportType !== 'IAR') return;
    // Opening a saved IAR keeps its header until the engineer picks another project.
    if (reportType === 'IAR') {
      if (loadedProjectIdRef.current === 'pending') return;
      if (loadedProjectIdRef.current && loadedProjectIdRef.current === id) {
        loadedProjectIdRef.current = '';
        return;
      }
    }
    let cancelled = false;
    getProject(id)
      .then((res) => {
        if (cancelled) return;
        const d = res.report_defaults;
        setEditor((s) => ({
          ...s,
          data: {
            ...s.data,
            project_name: d.project_name || s.data.project_name,
            project_title: d.project_name || s.data.project_title,
            location: d.location ?? s.data.location,
            municipality: d.location ?? s.data.municipality,
            contractor: d.contractor || s.data.contractor,
            contract_amount: d.contract_amount || s.data.contract_amount,
            notice_to_proceed: d.start_date || s.data.notice_to_proceed,
          },
          lineItems:
            reportType === 'SWA' && s.lineItems.length <= 1 && res.project.name.includes('Remebella')
              ? buildReferenceWorkItems()
              : s.lineItems,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [idParam, projectId, reportType, setEditor]);

  useEffect(() => {
    // SWA + IAR line items share the project BOQ as the Item No. source of truth
    // (same `projects/{id}/boqItems` used by PDM / S-Curve / Bar Chart).
    const id = String(projectId || '').trim();
    if ((reportType !== 'SWA' && reportType !== 'IAR') || !id || id === '1') {
      setProjectBoqItems([]);
      if ((reportType === 'SWA' || reportType === 'IAR') && !id) {
        setProjectBoqError('Select a project first to load Item Nos. from its BOQ.');
      } else {
        setProjectBoqError('');
      }
      return;
    }
    let cancelled = false;
    setProjectBoqError('');
    listProjectItemOptions(id)
      .then((items) => {
        if (cancelled) return;
        setProjectBoqItems(items);
        if (items.length === 0) {
          setProjectBoqError(
            'No Item Nos. yet. They come from this project’s BOQ and from the item numbers on its schedule.',
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setProjectBoqItems([]);
        const raw = err instanceof Error ? err.message : 'Could not load project BOQ items.';
        setProjectBoqError(
          /permission|insufficient|not.?found|missing/i.test(raw)
            ? 'This project is missing or you do not have access to its BOQ. Pick an accessible project (Projects list), then open SWA/IAR again.'
            : raw,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reportType]);

  const refreshProjectBoq = useCallback(async () => {
    const id = String(projectId || '').trim();
    if ((reportType !== 'SWA' && reportType !== 'IAR') || !id || id === '1') {
      setProjectBoqItems([]);
      return;
    }
    try {
      const items = await listProjectItemOptions(id);
      setProjectBoqItems(items);
      setProjectBoqError(
        items.length === 0
          ? 'No Item Nos. yet. They come from this project’s BOQ and from the item numbers on its schedule.'
          : '',
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not load project BOQ items.';
      setProjectBoqError(
        /permission|insufficient|not.?found|missing/i.test(raw)
          ? 'This project is missing or you do not have access to its BOQ. Pick an accessible project (Projects list), then open SWA/IAR again.'
          : raw,
      );
    }
  }, [projectId, reportType]);

  useEffect(() => {
    if (reportType !== 'STEWA') return;
    setEditor((s) => {
      const nextData = applyStewaDerivedFields(s.data);
      const changed = (
        [
          'period_start',
          'period_end',
          'period_covered',
          'week_covered',
          'expiry_date',
          'total_time_extension',
          'revised_contract_duration',
          'revised_expiry_date',
          'calendar_days_elapsed',
          'percent_planned',
          'slippage',
        ] as const
      ).some((key) => nextData[key] !== s.data[key]);
      return changed ? { ...s, data: nextData } : s;
    });
  }, [
    reportType,
    data.report_date,
    data.contract_duration,
    data.notice_to_proceed,
    data.approved_time_extension,
    data.approved_time_suspension,
    data.percent_actual,
    setEditor,
  ]);

  useEffect(() => {
    if (reportType !== 'STEWA' || !data.report_date) return;
    let cancelled = false;
    getStewaFromSwa(projectId, data.report_date)
      .then((res) => {
        if (cancelled) return;
        if (res.percent_actual == null) return;
        setEditor((s) => {
          const nextData = applyStewaDerivedFields({
            ...s.data,
            percent_actual: String(res.percent_actual),
            swa_source_report: res.swa_report_number ?? s.data.swa_source_report ?? '',
          });
          return { ...s, data: nextData };
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reportType, projectId, data.report_date, setEditor]);

  useEffect(() => {
    if (reportType !== 'IAR' || !projectId) return;
    const requestId = ++iarProgressRequest.current;
    getIarProgress(projectId, data.report_date)
      .then((progress) => {
        if (requestId !== iarProgressRequest.current) return;
        setEditor((s) => {
          const nextData = { ...s.data };
          const values: Record<string, number | null> = {
            orig_target: progress.orig_target,
            rev_target: progress.rev_target,
          };
          let changed = false;
          for (const [key, value] of Object.entries(values)) {
            if (value == null) continue;
            const nextValue = String(Math.round(value * 100) / 100);
            if (nextData[key] !== nextValue) {
              nextData[key] = nextValue;
              changed = true;
            }
          }
          const actual =
            progress.actual_progress == null
              ? ''
              : String(Math.round(progress.actual_progress * 100) / 100);
          if (nextData.actual_progress !== actual) {
            nextData.actual_progress = actual;
            changed = true;
          }
          const actualNum = Number(actual);
          const plannedRaw = String(nextData.rev_target || nextData.orig_target || '').trim();
          const plannedNum = Number(plannedRaw);
          const variance =
            actual !== '' && plannedRaw !== '' && Number.isFinite(actualNum) && Number.isFinite(plannedNum)
              ? String(Math.round((actualNum - plannedNum) * 100) / 100)
              : '';
          if ((nextData.variance ?? '') !== variance) {
            nextData.variance = variance;
            changed = true;
          }
          const source = progress.source_swa
            ? `SWA ${progress.source_swa}`
            : '';
          if (nextData.progress_source !== source) {
            nextData.progress_source = source;
            changed = true;
          }
          return changed ? { ...s, data: nextData } : s;
        });
      })
      .catch(() => undefined);
  }, [data.report_date, iarSourceRefresh, projectId, reportType, setEditor]);

  useEffect(() => {
    if (!idParam) {
      setDirty(false);
      setContractorChanges([]);
      contractorBaselineRef.current = {};
      autoSaveReady.current = false;
      requestAnimationFrame(() => {
        autoSaveReady.current = true;
      });
      return;
    }
    autoSaveReady.current = false;
    setDirty(false);
    if (skipNextLoad.current) {
      skipNextLoad.current = false;
      requestAnimationFrame(() => {
        autoSaveReady.current = true;
      });
      return;
    }
    getReport(idParam)
      .then((res) => {
        const r = res.report;
        setError('');
        setReportType(r.report_type);
        setReportId(r.id);
        setStatus(r.status);
        setEmailNotice({
          email_status: r.email_status,
          email_sent_at: r.email_sent_at,
          email_error: r.email_error,
          email_claimed_at: r.email_claimed_at,
          email_recipients: r.email_recipients,
        });
        setReportNumber(r.report_number);
        setContractorChanges(r.contractor_changes ?? []);
        setEditableUserIds(r.edit_user_ids ?? []);
        trackReportViewed(r.id);
        void markReportViewed(r.id);
        listReportRevisions(r.id)
          .then((rev) => setRevisionCount(rev.revisions.length))
          .catch(() => setRevisionCount(0));
        const rd = r.report_data as Record<string, unknown>;
        const scalar: Record<string, string> = {};
        for (const [k, v] of Object.entries(rd)) {
          if (v !== null && typeof v !== 'object') scalar[k] = String(v);
        }
        if (!scalar.less_amount && scalar.advance_payment) {
          scalar.less_amount = scalar.advance_payment;
        }
        if (!scalar.less_reason && parseFloat(scalar.less_amount || '0') > 0) {
          scalar.less_reason = 'Advance Payment';
        }
        const base = createInitialSnapshot(isContractor, user?.name ?? '');
        const acc = rd.accomplishment_items as Array<Record<string, unknown>> | undefined;
        const mp = rd.manpower as IarManpowerRow[] | undefined;
        const vo = rd.variation_items as Array<Record<string, unknown>> | undefined;
        const eq = rd.equipment as IarManpowerRow[] | undefined;
        const acts = rd.activities as string[] | undefined;
        const instr = rd.field_instructions as string[] | undefined;
        const baselineData: Record<string, string> = { ...base.data, ...scalar };
        let baselineActivitiesText = acts?.length ? acts.join('\n') : '';
        let baselineFieldInstructionsText = instr?.length ? instr.join('\n') : '';
        for (const change of r.contractor_changes ?? []) {
          baselineData[change.field] = change.old ?? '';
          if (change.field === 'activities_text') baselineActivitiesText = change.old ?? '';
          if (change.field === 'field_instructions_text') baselineFieldInstructionsText = change.old ?? '';
        }
        contractorBaselineRef.current = {
          ...baselineData,
          activities_text: baselineActivitiesText,
          field_instructions_text: baselineFieldInstructionsText,
        };
        loadedProjectIdRef.current = String(r.project_id);
        if (r.report_type === 'IAR') setIarSourceRefresh((n) => n + 1);
        replaceEditor({
          projectId: String(r.project_id),
          data: { ...base.data, ...scalar },
          lineItems: r.line_items?.length
            ? r.line_items.map((item, i) => {
                const resolved = resolveItemUnit(
                  String(item.snapshotItemNo || item.itemNo || ''),
                  String(item.snapshotDescription || item.description || ''),
                  String(item.snapshotUnit || item.unit || ''),
                );
                return {
                id: String(item.id ?? `wi-${i}`),
                payItemId: item.payItemId ? String(item.payItemId) : '',
                payItemVersion: item.payItemVersion != null ? Number(item.payItemVersion) : undefined,
                snapshotItemNo: item.snapshotItemNo ? String(item.snapshotItemNo) : String(item.itemNo ?? ''),
                snapshotDescription: resolved.description,
                snapshotUnit: resolved.unit,
                itemNo: String(item.itemNo ?? ''),
                description: resolved.description,
                unit: resolved.unit,
                unitPrice: Number(item.unitPrice ?? 0),
                programmedQty: Number(item.programmedQty ?? 0),
                revisedQty: Number(item.revisedQty ?? 0),
                previous: Number(item.previous ?? 0),
                thisPeriod: Number(item.thisPeriod ?? 0),
                toDateInput:
                  item.toDateInput != null && Number.isFinite(Number(item.toDateInput))
                    ? Number(item.toDateInput)
                    : undefined,
                remarks: String(item.remarks ?? ''),
              };
              })
            : base.lineItems,
          iarItems: acc?.length
            ? acc.map((item, i) => {
                const itemNo = String(item.snapshotItemNo || item.itemNo || item.item_no || '');
                const resolved = resolveItemUnit(
                  itemNo,
                  String(item.snapshotDescription || item.description || ''),
                  String(item.snapshotUnit || item.unit || ''),
                );
                return {
                id: String(item.id ?? `iar-${i}`),
                payItemId: item.payItemId ? String(item.payItemId) : '',
                payItemVersion: item.payItemVersion != null ? Number(item.payItemVersion) : undefined,
                snapshotItemNo: itemNo,
                snapshotDescription: resolved.description,
                snapshotUnit: resolved.unit,
                itemNo: String(item.itemNo ?? item.item_no ?? ''),
                description: resolved.description,
                location: String(item.location ?? ''),
                physicalQty: (item.physicalQty ?? item.physical_qty ?? '') as number | '',
                billableQty: (item.billableQty ?? item.billable_qty ?? '') as number | '',
                unit: resolved.unit,
              };
              })
            : base.iarItems,
          variationItems: vo?.length
            ? vo.map((item, i) => {
                const itemNo = String(item.snapshotItemNo || item.itemNo || item.item_no || '');
                const resolved = resolveItemUnit(
                  itemNo,
                  String(item.snapshotDescription || item.description || ''),
                  String(item.snapshotUnit || item.unit || ''),
                );
                return {
                id: String(item.id ?? `vo-${i}`),
                payItemId: item.payItemId ? String(item.payItemId) : '',
                payItemVersion: item.payItemVersion != null ? Number(item.payItemVersion) : undefined,
                snapshotItemNo: itemNo,
                snapshotDescription: resolved.description,
                snapshotUnit: resolved.unit,
                itemNo: String(item.itemNo ?? item.item_no ?? ''),
                description: resolved.description,
                quantity: (item.quantity ?? '') as number | '',
                unit: resolved.unit,
                additive: String(item.additive ?? ''),
                deductive: String(item.deductive ?? ''),
                newItem: String(item.newItem ?? item.new_item ?? ''),
              };
              })
            : base.variationItems,
          manpower: mp?.length
            ? mp.map((m, i) => ({
                id: m.id ?? `mp-${i}`,
                description: String(m.description ?? ''),
                quantity: (m.quantity ?? '') as number | '',
              }))
            : base.manpower,
          equipment: eq?.length
            ? eq.map((m, i) => ({
                id: m.id ?? `eq-${i}`,
                description: String(m.description ?? ''),
                quantity: (m.quantity ?? '') as number | '',
              }))
            : base.equipment,
          activitiesText: acts?.length ? acts.join('\n') : '',
          fieldInstructionsText: instr?.length ? instr.join('\n') : '',
        });
        setDirty(false);
      })
      .catch((err) => {
        console.error('Failed to load report', idParam, err);
        setError('Could not load report');
      })
      .finally(() => {
        requestAnimationFrame(() => {
          autoSaveReady.current = true;
        });
      });
  }, [idParam, isContractor, replaceEditor, user?.name]);

  const markDirty = () => {
    setDirty(true);
    setSuccess('');
    autoSaveReady.current = true;
  };

  const updateContractorChange = useCallback(
    (field: string, label: string, previousValue: string, nextValue: string) => {
      if (!contractorDraftCommentMode) return;
      const baseline = contractorBaselineRef.current[field] ?? previousValue;
      contractorBaselineRef.current[field] = baseline;
      setContractorChanges((current) => {
        const existing = current.find((change) => change.field === field);
        if (nextValue === baseline) {
          return current.filter((change) => change.field !== field);
        }
        const nextChange: ContractorChange = {
          field,
          label,
          old: baseline,
          new: nextValue,
          comment: existing?.comment ?? '',
        };
        return [...current.filter((change) => change.field !== field), nextChange];
      });
    },
    [contractorDraftCommentMode],
  );

  const setContractorChangeComment = useCallback((field: string, comment: string) => {
    setContractorChanges((current) =>
      current.map((change) => (change.field === field ? { ...change, comment } : change)),
    );
  }, []);

  const setField = (key: string, value: string, label?: string) => {
    markDirty();
    setEditor((s) => {
      const previousValue = String(s.data[key] ?? '');
      let nextData = { ...s.data, [key]: value };
      if (reportType === 'STEWA' && STEWA_DERIVE_KEYS.has(key)) {
        nextData = applyStewaDerivedFields(nextData);
      }
      updateContractorChange(key, label ?? key.replace(/_/g, ' '), previousValue, String(nextData[key] ?? ''));
      return { ...s, data: nextData };
    });
  };
  const setProjectId = (value: string) => {
    markDirty();
    setEditor((s) => ({ ...s, projectId: value }));
    setSelectedProjectId(value);
  };
  const setLineItems = (items: WorkItem[]) => {
    markDirty();
    setEditor((s) => ({ ...s, lineItems: items }));
  };
  const setIarItems = (items: IarAccomplishmentItem[]) => {
    markDirty();
    setEditor((s) => ({ ...s, iarItems: items }));
  };
  const setVariationItems = (items: IarVariationItem[]) => {
    markDirty();
    setEditor((s) => ({ ...s, variationItems: items }));
  };
  const setManpower = (items: IarManpowerRow[]) => {
    markDirty();
    setEditor((s) => ({ ...s, manpower: items }));
  };
  const setEquipment = (items: IarManpowerRow[]) => {
    markDirty();
    setEditor((s) => ({ ...s, equipment: items }));
  };
  const setActivitiesText = (value: string) => {
    markDirty();
    setEditor((s) => {
      updateContractorChange('activities_text', 'Activities for the week', s.activitiesText, value);
      return { ...s, activitiesText: value };
    });
  };
  const setFieldInstructionsText = (value: string) => {
    markDirty();
    setEditor((s) => {
      updateContractorChange(
        'field_instructions_text',
        'Field instructions',
        s.fieldInstructionsText,
        value,
      );
      return { ...s, fieldInstructionsText: value };
    });
  };

  const payItemValidationError = useCallback(() => {
    if (reportType === 'SWA') {
      const invalid = lineItems.some(
        (item) =>
          (item.description || item.unit || item.programmedQty > 0) &&
          !item.payItemId &&
          !String(item.itemNo || '').trim(),
      );
      return invalid ? 'Select a standardized Pay Item for every SWA work item before saving.' : '';
    }
    if (reportType === 'IAR') {
      const invalid = iarItems.some(
        (item) =>
          (item.description || item.physicalQty !== '' || item.billableQty !== '') &&
          !item.payItemId &&
          !String(item.itemNo || '').trim(),
      );
      return invalid ? 'Select a standardized Pay Item for every IAR accomplishment row before saving.' : '';
    }
    return '';
  }, [iarItems, lineItems, reportType]);

  const payload = useCallback(() => {
    const source = reportType === 'STEWA' ? applyStewaDerivedFields(data) : data;
    const report_data: Record<string, unknown> = {
      ...source,
      slippage:
        reportType === 'STEWA'
          ? source.slippage
          : computeStewaSlippage(
              parseFloat(data.percent_actual || '0'),
              parseFloat(data.percent_planned || '0'),
            ),
    };
    if (reportType === 'IAR') {
      report_data.accomplishment_items = iarItems.map((item) => ({
        payItemId: item.payItemId || null,
        payItemVersion: item.payItemVersion ?? null,
        snapshotItemNo: item.snapshotItemNo || item.itemNo,
        snapshotDescription: item.snapshotDescription || item.description,
        snapshotUnit: item.snapshotUnit || item.unit,
        item_no: item.itemNo,
        description: item.description,
        location: item.location,
        physical_qty: item.physicalQty,
        billable_qty: item.billableQty,
        unit: item.unit,
      }));
      report_data.variation_items = variationItems.map((item) => ({
        payItemId: item.payItemId || null,
        payItemVersion: item.payItemVersion ?? null,
        snapshotItemNo: item.snapshotItemNo || item.itemNo,
        snapshotDescription: item.snapshotDescription || item.description,
        snapshotUnit: item.snapshotUnit || item.unit,
        item_no: item.itemNo,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        additive: item.additive,
        deductive: item.deductive,
        new_item: item.newItem,
      }));
      report_data.manpower = manpower;
      report_data.equipment = equipment;
      report_data.activities = activitiesText.split('\n').map((s) => s.trim()).filter(Boolean);
      report_data.field_instructions = fieldInstructionsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return {
      id: reportId || savedReportIdRef.current,
      report_type: reportType,
      project_id: projectId,
      report_data,
      line_items:
        reportType === 'SWA'
          ? computeWorkItems(lineItems).items.map((item) => ({
              ...item,
              // Persist Excel-derived accomplishment amounts with the row.
              thisPeriod: item.thisPeriod,
              previous: item.previous,
              remarks: item.remarks?.trim() || item.status,
            }))
          : [],
      contractor_changes:
        contractorDraftCommentMode && (reportType === 'IAR' || reportType === 'STEWA')
          ? contractorChanges
          : undefined,
      created_by: user?.id || undefined,
    };
  }, [
    activitiesText,
    contractorChanges,
    contractorDraftCommentMode,
    data,
    equipment,
    fieldInstructionsText,
    iarItems,
    lineItems,
    manpower,
    projectId,
    reportId,
    reportType,
    user?.id,
    variationItems,
  ]);

  const handleSave = useCallback(
    async (e?: FormEvent | { silent?: boolean }) => {
      const silent = !!e && 'silent' in e && e.silent;
      if (e && 'preventDefault' in e) e.preventDefault();
      if (savingRef.current) return;

      const seq = ++saveSeq.current;
      // Drafts may be incomplete; Pay Item completeness is enforced on Submit only.
      // (Preview also allows incomplete rows — keep Save Draft aligned with that.)
      savingRef.current = true;
      setSaving(true);
      if (!silent) {
        setLoading(true);
        setError('');
        setSuccess('');
      }
      try {
        const res = await saveReport(payload());
        if (seq !== saveSeq.current) return;
        const wasNew = !reportId && !savedReportIdRef.current;
        savedReportIdRef.current = res.report.id;
        setReportId(res.report.id);
        setReportNumber(res.report.report_number);
        setStatus(res.report.status);
        setContractorChanges(res.report.contractor_changes ?? []);
        setDirty(false);
        autoSaveReady.current = false;
        if (wasNew || !idParam) {
          skipNextLoad.current = true;
          navigate(`/swa-stewa/edit?id=${encodeURIComponent(res.report.id)}`, { replace: true });
        }
        requestAnimationFrame(() => {
          autoSaveReady.current = true;
        });
        setSuccess(silent ? 'Auto-saved.' : 'Draft saved.');
        setError('');
      } catch (err) {
        if (seq !== saveSeq.current) return;
        autoSaveReady.current = false;
        const code =
          err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
        setError(
          code === 'resource-exhausted'
            ? 'Firestore quota is exceeded, so this draft could not be written. Save again after the quota resets.'
            : err instanceof Error
              ? err.message
              : 'Save failed',
        );
      } finally {
        if (seq === saveSeq.current) {
          savingRef.current = false;
          setSaving(false);
          setLoading(false);
        }
      }
    },
    [idParam, navigate, payload, reportId],
  );

  const handlePreview = () => {
    setError('');
    try {
      const body = payload();
      const reportData = body.report_data;
      setPreviewHtml(
        buildOfficialReportHtml({
          id: reportId || '',
          report_number: reportNumber || '',
          project_id: projectId,
          report_type: reportType,
          report_data: reportData,
          line_items: body.line_items ?? [],
          status: status as SwaStewaStatus,
          project_name: String(reportData.project_name || reportData.project_title || ''),
          created_at: '',
        }),
      );
      setShowPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    }
  };

  const handlePreviewDownloadPdf = async () => {
    setDownloadingPreview(true);
    setError('');
    try {
      const frame = document.querySelector(
        'iframe[title="Preview"]',
      ) as HTMLIFrameElement | null;
      await downloadReportPreviewPdf({
        fileName: `${reportNumber || reportType || 'report'}-preview.pdf`,
        frame,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download PDF.');
    } finally {
      setDownloadingPreview(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const validationError = payItemValidationError();
      if (validationError) {
        setError(validationError);
        return;
      }
      // Write the current SWA onto the existing document first, then move that
      // same id to Engineer II. A second save must not create another report.
      const saved = await saveReport(payload());
      const id = saved.report.id;
      savedReportIdRef.current = id;
      setReportId(id);
      setReportNumber(saved.report.report_number);
      setStatus(saved.report.status);
      if (!idParam) {
        skipNextLoad.current = true;
        navigate(`/swa-stewa/edit?id=${encodeURIComponent(id)}`, { replace: true });
      }
      await submitReport(id, user?.id);
      setStatus('pending_review');
      setSuccess('Submitted successfully. Waiting for Engineer II review.');
      setShowSubmittedModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!reportId) return;
    setLoading(true);
    setError('');
    try {
      const actorId = user?.id;
      const res = await approveReport(reportId, actorId, user?.role);
      setStatus(res.status);
      if (res.status === 'generated' && res.pdf_url) {
        window.open(res.pdf_url, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!reportId) return;
    const actorId = user?.id;
    await rejectReport(reportId, rejectReason, actorId);
    setStatus('rejected');
  };

  const canEditForm = canEditReport(user?.role, reportType, status, editableUserIds, user?.id ? String(user.id) : null);
  const isViewOnly = reportIsViewOnly(
    user?.role,
    reportType,
    status,
    editableUserIds,
    user?.id ? String(user.id) : null,
  );
  const changedFields = new Set(contractorChanges.map((c) => c.field.split('.')[0]));
  const isFieldChanged = (key: string) => changedFields.has(key) || contractorChangeByField.has(key);
  const renderContractorChangeBox = (field: string) => {
    const change = contractorChangeByField.get(field);
    if (!change) return null;
    const index = contractorChanges.findIndex((entry) => entry.field === field) + 1;
    const needsComment = !String(change.comment ?? '').trim();
    return (
      <div
        ref={(node) => {
          fieldAnchorRefs.current[field] = node;
        }}
        className={`mt-2 rounded-lg border-l-4 px-3 py-2.5 ${
          activeCommentField === field
            ? 'border-amber-500 bg-amber-100/80 ring-1 ring-amber-400'
            : 'border-amber-400 bg-amber-50/80'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
            Comment {index || '·'} · Edited
          </p>
          <button
            type="button"
            className="text-[11px] font-semibold text-amber-800 underline-offset-2 hover:underline"
            onClick={() => setActiveCommentField(field)}
          >
            Open in panel
          </button>
        </div>
        <p className="mt-1 text-xs text-amber-950">
          <span className="line-through opacity-70">{change.old || '—'}</span>
          <span className="mx-1 text-amber-700">→</span>
          <strong>{change.new || '—'}</strong>
        </p>
        {contractorDraftCommentMode ? (
          <TextArea
            rows={2}
            value={change.comment ?? ''}
            onFocus={() => setActiveCommentField(field)}
            onChange={(e) => setContractorChangeComment(field, e.target.value)}
            placeholder="Explain why you changed this (required before confirm)…"
            className={`mt-2 bg-white ${needsComment ? 'border-amber-500 ring-1 ring-amber-400' : 'border-amber-300'}`}
          />
        ) : change.comment ? (
          <p className="mt-2 rounded-md bg-white/70 px-2 py-1.5 text-xs text-amber-950">
            <span className="font-semibold">Reason:</span> {change.comment}
          </p>
        ) : (
          <p className="mt-2 text-xs text-amber-800">No reason provided for this change.</p>
        )}
      </div>
    );
  };

  // Auto-save ~1.2s after the last edit while the form is editable.
  useEffect(() => {
    if (!canEditForm || !dirty || loading || saving || !autoSaveReady.current) return;
    const timer = window.setTimeout(() => {
      void handleSave({ silent: true });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [canEditForm, dirty, editor, handleSave, loading, saving]);

  const handleUndo = () => {
    undo();
    markDirty();
  };
  const handleRedo = () => {
    redo();
    markDirty();
  };

  const handleSendToContractor = async () => {
    if (!reportId) return;
    setLoading(true);
    try {
      await sendToContractor(reportId);
      setStatus('pending_contractor');
      setContractorChanges([]);
      setSuccess('Sent to contractor for review.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send to contractor.');
    } finally {
      setLoading(false);
    }
  };

  const handleContractorConfirm = async () => {
    if (!reportId) return;
    if (missingChangeComments.length > 0) {
      setError(
        `Add a reason for each edited field before confirming (${missingChangeComments.length} still missing).`,
      );
      focusChangeField(missingChangeComments[0]!.field);
      return;
    }
    setLoading(true);
    try {
      const res = await contractorConfirm(reportId);
      setStatus(res.status);
      setContractorChanges(res.report.contractor_changes ?? []);
      setSuccess('Confirmed — Engineer I will review your changes.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm failed.');
    } finally {
      setLoading(false);
    }
  };
  const canApproveNow =
    (user?.role === 'engineer_2' && status === 'pending_review') ||
    (user?.role === 'engineer_3' && status === 'with_engineer_3') ||
    (user?.role === 'engineer_4' && status === 'with_engineer_4');
  const canRequestRevision =
    (user?.role === 'engineer_2' && status === 'pending_review') ||
    (user?.role === 'engineer_3' && status === 'with_engineer_3') ||
    (user?.role === 'engineer_4' && status === 'with_engineer_4');
  useUndoRedoKeyboard(handleUndo, handleRedo, canEditForm);

  const renderField = (
    key: string,
    label: string,
    type: 'text' | 'number' | 'date' | 'textarea' = 'text',
    span2 = false,
    computed = false,
    hint?: string,
    percent = false,
    blankWhenZero = false,
  ) => {
    const changed = isFieldChanged(key);
    const readOnly = computed;
    const rawValue = data[key] ?? '';
    const displayValue = percent
      ? stewaPercentText(rawValue)
        ? `${stewaPercentText(rawValue)}%`
        : ''
      : blankWhenZero
        ? stewaDash(rawValue)
        : rawValue;
    const commentIndex = contractorChanges.findIndex((entry) => entry.field === key) + 1;
    return (
      <FormField key={key} label={label} hint={hint} className={span2 ? 'sm:col-span-2' : ''}>
        <div className="relative">
          {changed && commentIndex > 0 && (
            <button
              type="button"
              onClick={() => focusChangeField(key)}
              className="absolute -right-2 -top-2 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow"
              title={`Open comment ${commentIndex}`}
            >
              {commentIndex}
            </button>
          )}
          {type === 'textarea' ? (
            <TextArea
              disabled={!canEditForm}
              rows={3}
              value={displayValue}
              onChange={(e) => setField(key, e.target.value, label)}
              onFocus={() => changed && setActiveCommentField(key)}
              className={changed ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300' : undefined}
            />
          ) : (
            <TextInput
              disabled={!canEditForm}
              readOnly={readOnly}
              type={percent || blankWhenZero ? 'text' : type}
              value={percent || blankWhenZero ? displayValue : rawValue}
              onChange={(e) => setField(key, e.target.value, label)}
              onFocus={() => changed && setActiveCommentField(key)}
              className={
                readOnly
                  ? 'bg-surface-muted'
                  : changed
                    ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300'
                    : undefined
              }
            />
          )}
        </div>
        {renderContractorChangeBox(key)}
      </FormField>
    );
  };

  return (
    <main className="app-main flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        badge={reportType}
        title={reportNumber ? `${reportType} — ${reportNumber}` : `New ${reportType} report`}
        status={status}
        backTo={user?.role === 'engineer_1' ? '/workflow' : user?.role === 'contractor' ? '/reports' : '/reports'}
        backLabel={user?.role === 'engineer_1' ? 'My Submissions' : 'Documents'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEditForm && (
              <UndoRedoToolbar canUndo={canUndo} canRedo={canRedo} onUndo={handleUndo} onRedo={handleRedo} />
            )}
            <ReportTypeBadge type={reportType} />
          </div>
        }
      />

      {(status === 'approved' || status === 'generated') && (
        <div className="w-full px-8">
          <EmailNoticeStatus
            reportStatus={status}
            emailStatus={emailNotice.email_status}
            emailSentAt={emailNotice.email_sent_at}
            emailError={emailNotice.email_error}
            emailClaimedAt={emailNotice.email_claimed_at}
            emailRecipients={emailNotice.email_recipients}
            canRetry={
              user?.role === 'engineer_2' || user?.role === 'engineer_3' || user?.role === 'engineer_4'
            }
            busy={loading}
            onRetry={() => {
              if (!reportId) return;
              setLoading(true);
              setError('');
              void retryApprovalEmail(reportId)
                .then(async () => {
                  const res = await getReport(reportId);
                  setEmailNotice({
                    email_status: res.report.email_status,
                    email_sent_at: res.report.email_sent_at,
                    email_error: res.report.email_error,
                    email_claimed_at: res.report.email_claimed_at,
                    email_recipients: res.report.email_recipients,
                  });
                  setSuccess('Approval email sent.');
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Could not retry the notification.');
                })
                .finally(() => setLoading(false));
            }}
          />
        </div>
      )}

      {isViewOnly && (
        <div className="w-full px-8">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            View only — this {reportType} cannot be edited while status is{' '}
            <strong>{statusLabel(status)}</strong>
            {status === 'approved' || status === 'generated'
              ? '. Open the official PDF to view the finalized report.'
              : '. Only draft or revision-requested reports can be changed.'}
          </div>
        </div>
      )}

      {user?.role === 'engineer_1' && contractorChanges.length > 0 && (
        <div className="w-full px-8">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">Contractor changes ({contractorChanges.length})</p>
            <p className="mt-1 text-xs text-amber-900">
              Highlighted fields below include Google Docs–style reasons. Use the comments panel to jump between edits.
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {contractorChanges.map((c, index) => (
                <li key={c.field}>
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline"
                    onClick={() => focusChangeField(c.field)}
                  >
                    {index + 1}. {c.label}: <span className="line-through">{c.old || '—'}</span> →{' '}
                    <strong>{c.new || '—'}</strong>
                  </button>
                  {c.comment ? (
                    <span className="block text-xs text-amber-900">Reason: {c.comment}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {contractorDraftCommentMode && (
        <div className="w-full px-8 pt-3">
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            <p className="font-semibold">Edit with comments</p>
            <p className="mt-1 text-xs text-sky-900">
              Every field you change is highlighted. Add a reason for each edit in the comment box (or the side panel), similar to Google Docs suggestions.
            </p>
          </div>
        </div>
      )}

      {showChangeCommentsPanel && (
        <aside className="fixed bottom-4 right-4 z-40 w-[min(100vw-2rem,22rem)] rounded-2xl border border-amber-300 bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-amber-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-text">Comments</p>
              <p className="text-[11px] text-text-muted">
                {contractorChanges.length} edit{contractorChanges.length === 1 ? '' : 's'}
                {missingChangeComments.length > 0
                  ? ` · ${missingChangeComments.length} need a reason`
                  : ''}
              </p>
            </div>
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto p-3">
            {contractorChanges.map((change, index) => {
              const needsComment = !String(change.comment ?? '').trim();
              const active = activeCommentField === change.field;
              return (
                <li
                  key={change.field}
                  className={`rounded-xl border p-3 ${
                    active ? 'border-amber-500 bg-amber-50' : 'border-border bg-surface-muted/40'
                  }`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => focusChangeField(change.field)}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                      #{index + 1} · {change.label}
                    </p>
                    <p className="mt-1 text-xs text-text">
                      <span className="line-through opacity-60">{change.old || '—'}</span>
                      <span className="mx-1">→</span>
                      <strong>{change.new || '—'}</strong>
                    </p>
                  </button>
                  {contractorDraftCommentMode ? (
                    <TextArea
                      rows={2}
                      value={change.comment ?? ''}
                      onFocus={() => setActiveCommentField(change.field)}
                      onChange={(e) => setContractorChangeComment(change.field, e.target.value)}
                      placeholder="Reason for this change…"
                      className={`mt-2 bg-white text-xs ${
                        needsComment ? 'border-amber-500 ring-1 ring-amber-400' : 'border-border'
                      }`}
                    />
                  ) : (
                    <p className="mt-2 text-xs text-text-muted">
                      {change.comment ? `Reason: ${change.comment}` : 'No reason provided.'}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      )}

      {revisionCount > 0 && (
        <div className="w-full px-8 pt-2">
          <p className="text-xs text-text-muted">
            {revisionCount} revision{revisionCount !== 1 ? 's' : ''} saved — previous versions are
            kept in the system and are not overwritten after approval.
          </p>
        </div>
      )}

      {(status === 'pending_review' ||
        success === 'Submitted successfully. Waiting for Engineer II review.' ||
        success === 'Sent to contractor for review.' ||
        success === 'Confirmed — Engineer I will review your changes.') && (
        <div className="w-full px-8 pt-4">
          <div className="rounded-xl border border-primary/30 bg-primary-light px-4 py-3 text-sm text-primary">
            <p className="font-semibold">
              {success?.startsWith('Sent')
                ? 'Sent to contractor'
                : success?.startsWith('Confirmed')
                  ? 'Confirmed'
                  : 'Submitted'}
            </p>
            <p className="mt-0.5">
              {success ||
                'This report has been submitted and is waiting for Engineer II review.'}
              {reportNumber ? ` (${reportNumber})` : ''}
            </p>
          </div>
        </div>
      )}

      <form
        id="report-editor-form"
        className="w-full flex-1 space-y-6 px-8 py-8 pb-28"
        onSubmit={handleSave}
      >
        {reportType !== 'IAR' && (
          <FormSection
            title="Project information"
            step={1}
            description="A new report is not a new project. Pick the existing project this SWA belongs to — name, location, contractor, and contract amount fill in from Projects."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label="Project"
                hint="From the Projects list. Add a project there first if it is missing."
              >
                <ProjectSelect
                  value={projectId}
                  disabled={!canEditForm}
                  onChange={setProjectId}
                  fallbackLabel={data.project_name || undefined}
                />
              </FormField>
              {(['project_name', 'location', 'contract_amount', 'contractor'] as const).map((key) =>
                renderField(
                  key,
                  key === 'project_name' ? 'Project name on form' : key.replace(/_/g, ' '),
                  'text',
                  false,
                  false,
                  key === 'project_name'
                    ? 'Filled from the project you selected. Change only if the printed title should differ.'
                    : undefined,
                ),
              )}
            </div>
          </FormSection>
        )}

        {reportType === 'STEWA' && (
          <FormSection
            title="STEWA — Time Elapsed & Work Accomplished"
            step={2}
            accent="warning"
            description="Same fields as the STEWA sheet. Blue cells in the workbook are the entries below. Planned % uses the sine formula on elapsed days and the original duration. Actual % comes from the SWA for this as-of date."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              {STEWA_FIELDS.map((f) =>
                renderField(
                  f.key,
                  f.label,
                  f.type === 'textarea' ? 'textarea' : f.type,
                  ('span2' in f && f.span2 === true) || f.type === 'textarea',
                  'computed' in f && f.computed === true,
                  'hint' in f ? f.hint : undefined,
                  'percent' in f && f.percent === true,
                  'blankWhenZero' in f && f.blankWhenZero === true,
                ),
              )}
            </div>
            {data.swa_source_report ? (
              <p className="mt-3 text-xs text-text-muted">
                Actual % is the SWA total weight accomplished from <strong>{data.swa_source_report}</strong>{' '}
                on this as-of date.
              </p>
            ) : (
              <p className="mt-3 text-xs text-amber-800">
                No SWA found for this as-of date — save or create the matching SWA first. Planned % still follows the sine formula.
              </p>
            )}
          </FormSection>
        )}

        {reportType === 'IAR' && (
          <>
            <FormSection
              title="Report header"
              step={1}
              description="Contract and project details for this reporting week."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                {renderField('report_date', 'IAR date (week start)', 'date')}
                <FormField
                  label="Project title"
                  hint="Projects you can access. Municipality and contractor fill in from the project record."
                >
                  <ProjectSelect
                    value={projectId}
                    disabled={!canEditForm}
                    onChange={setProjectId}
                    fallbackLabel={data.project_title || data.project_name || undefined}
                  />
                </FormField>
                {(
                  [
                    ['contract_number', 'Contract No.'],
                    ['municipality', 'Municipality'],
                    ['week_covered', 'Week covered'],
                    ['contractor', 'Contractor'],
                    ['contractor_representative', 'Contractor representative'],
                  ] as const
                ).map(([key, label]) => renderField(key, label))}
              </div>
            </FormSection>
            <FormSection title="Accomplishment" step={2} description="Quantity of work completed this week.">
              {projectBoqError ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {projectBoqError}
                </div>
              ) : null}
              <IarAccomplishmentTable
                items={iarItems}
                onChange={setIarItems}
                readOnly={!canEditForm || contractorDraftCommentMode}
                projectBoqItems={projectBoqItems}
                onRefreshProjectBoq={refreshProjectBoq}
              />
            </FormSection>
            <FormSection title="For variation order" step={3} description="Contract changes — additive, deductive, or new items.">
              <IarVariationTable
                items={variationItems}
                onChange={setVariationItems}
                readOnly={!canEditForm || contractorDraftCommentMode}
                projectBoqItems={projectBoqItems}
                onRefreshProjectBoq={refreshProjectBoq}
              />
            </FormSection>
            <FormSection title="Site activities & remarks" step={4}>
              <div className="grid gap-5 lg:grid-cols-2">
                <FormField label="Activities for the week" hint="One activity per line">
                  <TextArea
                    disabled={!canEditForm}
                    rows={5}
                    value={activitiesText}
                    onChange={(e) => setActivitiesText(e.target.value)}
                    placeholder="Preparation of sub-grade&#10;Pouring of concrete..."
                    className={isFieldChanged('activities_text') ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300' : undefined}
                  />
                  {renderContractorChangeBox('activities_text')}
                </FormField>
                <FormField label="Field instructions" hint="One instruction per line">
                  <TextArea
                    disabled={!canEditForm}
                    rows={5}
                    value={fieldInstructionsText}
                    onChange={(e) => setFieldInstructionsText(e.target.value)}
                    className={isFieldChanged('field_instructions_text') ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300' : undefined}
                  />
                  {renderContractorChangeBox('field_instructions_text')}
                </FormField>
              </div>
              <div className="mt-5">
                {renderField('problems_remarks', 'Problems encountered / remarks', 'textarea', true)}
              </div>
            </FormSection>
            <FormSection title="Manpower & equipment" step={5} description="On-site resources for this reporting week.">
              <div className="grid gap-6 lg:grid-cols-2">
                <IarResourceTable
                  title="Manpower"
                  items={manpower}
                  onChange={setManpower}
                  readOnly={!canEditForm || contractorDraftCommentMode}
                />
                <IarResourceTable
                  title="Equipment"
                  items={equipment}
                  onChange={setEquipment}
                  readOnly={!canEditForm || contractorDraftCommentMode}
                />
              </div>
            </FormSection>
            <FormSection title="Physical accomplishment %" step={6} accent="warning">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
                {(
                  [
                    ['orig_target', 'Orig. target'],
                    ['rev_target', 'Rev. target'],
                    ['actual_progress', 'Actual'],
                    ['variance', 'Variance'],
                    ['progress_remarks', 'Remarks'],
                  ] as const
                ).map(([key, label]) =>
                  renderField(
                    key,
                    label,
                    key === 'progress_remarks' ? 'text' : 'number',
                    false,
                    key !== 'progress_remarks',
                    key === 'actual_progress'
                      ? 'From this project’s SWA physical accomplishment %. It updates when that SWA is saved.'
                      : key === 'variance'
                        ? 'Automatically calculated as Actual − Revised target.'
                        : key === 'progress_remarks'
                          ? 'Optional note. The percentage itself comes from the SWA.'
                          : 'Automatically sourced from the matching STEWA report.',
                  ),
                )}
              </div>
              {data.progress_source && (
                <p className="mt-3 text-xs text-text-muted">
                  Progress sourced from: <strong>{data.progress_source}</strong>
                </p>
              )}
            </FormSection>
            <FormSection
              title="Signatures"
              step={7}
              description="Auto-filled: Engineer I + Contractor on submit; Engineer II on approve; Engineer III on accept. Engineer IV has no IAR signature."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                {(
                  [
                    ['prepared_by_name', 'Prepared by — Engineer I'],
                    ['checked_by_name', 'Checked by — Engineer II'],
                    ['noted_by_name', 'Noted by — Engineer III'],
                    ['contractor_representative', 'Contractor conforme'],
                  ] as const
                ).map(([key, label]) => renderField(key, label))}
              </div>
            </FormSection>
          </>
        )}

        {reportType === 'SWA' && (
          <FormSection title="SWA — Work accomplishment" step={2}>
            {projectBoqError ? (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {projectBoqError}
              </div>
            ) : null}
            <WorkItemsTable
              items={lineItems}
              lessReason={data.less_reason ?? ''}
              lessAmount={parseFloat(data.less_amount || data.advance_payment || '0')}
              showRevised={
                data.show_revised_quantity === '1' ||
                data.show_revised_quantity === 'true' ||
                data.show_revised_quantity === 'yes'
              }
              onShowRevisedChange={(value) =>
                setField('show_revised_quantity', value ? '1' : '0')
              }
              onLessReasonChange={(value) => setField('less_reason', value)}
              onLessAmountChange={(value) => setField('less_amount', String(value))}
              onChange={setLineItems}
              boqItems={projectBoqItems}
              onRefreshProjectBoq={refreshProjectBoq}
              readOnly={!canEditForm}
            />
          </FormSection>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </form>

      <div className="sticky bottom-0 border-t border-border/80 bg-card/95 px-8 py-4 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md">
        <div className="flex w-full flex-wrap items-center gap-3">
          {canEditForm && (
            <>
              <button
                type="submit"
                form="report-editor-form"
                disabled={loading || saving}
                className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-text shadow-sm transition hover:bg-surface-muted disabled:opacity-50"
              >
                {saving ? 'Saving…' : dirty ? 'Save draft*' : 'Save draft'}
              </button>
              {(saving || success === 'Auto-saved.' || success === 'Draft saved.') && (
                <span className="text-xs text-text-muted">
                  {saving ? 'Saving changes…' : success}
                </span>
              )}
              <p className="basis-full text-[11px] text-text-muted sm:basis-auto">
                Changes auto-save after you pause typing.
              </p>
              <Button type="button" variant="ghost" disabled={loading || saving} onClick={handlePreview}>
                Preview
              </Button>
              {user?.role === 'engineer_1' &&
                (reportType === 'SWA' || reportType === 'STEWA' || reportType === 'IAR') &&
                (status === 'draft' || status === 'rejected') && (
                  <Button type="button" variant="secondary" disabled={loading} onClick={handleSendToContractor}>
                    {reportType === 'IAR' ? 'Send IAR to contractor' : 'Send to contractor'}
                  </Button>
                )}
              {user?.role === 'contractor' &&
                (reportType === 'SWA' || reportType === 'STEWA' || reportType === 'IAR') &&
                status === 'pending_contractor' && (
                  <Button type="button" variant="primary" disabled={loading} onClick={handleContractorConfirm}>
                    {reportType === 'IAR' ? 'Confirm SWA and IAR' : 'Confirm SWA/STEWA'}
                  </Button>
                )}
              {((user?.role === 'engineer_1' &&
                ['draft', 'rejected', 'contractor_confirmed'].includes(status)) ||
                (user?.role === 'contractor' &&
                  reportType === 'SWA' &&
                  (status === 'draft' || status === 'rejected'))) && (
                  <Button type="button" variant="primary" disabled={loading || saving} onClick={handleSubmit}>
                    Submit for review
                  </Button>
                )}
            </>
          )}
          {!canEditForm && status === 'pending_contractor' && user?.role === 'contractor' && (
            <span className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900">
              Review and confirm this {reportType}
            </span>
          )}
          {!canEditForm && status === 'contractor_confirmed' && user?.role === 'engineer_1' && (
            <span className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900">
              Contractor confirmed — review highlighted changes, then submit to Engineer II
            </span>
          )}
          {!canEditForm && status === 'pending_review' && (
            <span className="rounded-xl bg-primary-light px-4 py-2.5 text-sm font-semibold text-primary">
              Submitted — awaiting Engineer II
            </span>
          )}
          {isViewOnly && reportId && (status === 'generated' || status === 'approved') && (
            <ButtonLink to={`/reports/view?id=${encodeURIComponent(reportId)}`} variant="secondary">
              View report
            </ButtonLink>
          )}
          {canApproveNow && (
            <>
              <Button type="button" variant="primary" disabled={loading} onClick={handleApprove}>
                Approve
              </Button>
              {canRequestRevision && (
                <>
                  <TextInput
                    placeholder="Rejection reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="!mt-0 max-w-xs"
                  />
                  <Button type="button" variant="danger" onClick={handleReject}>
                    Request Revision
                  </Button>
                </>
              )}
            </>
          )}
          {status === 'generated' && reportNumber && (
            <ButtonLink
              to={`/verify?qr=${encodeURIComponent(reportNumber)}`}
              variant="secondary"
            >
              Open QR verification page
            </ButtonLink>
          )}
        </div>
      </div>

      {showSubmittedModal && (
        <SubmissionSuccessSign
          open={showSubmittedModal}
          title="Submission Successful"
          message={
            reportNumber
              ? `${reportType} ${reportNumber} is waiting for Engineer II review.`
              : `Your ${reportType} report is waiting for Engineer II review.`
          }
          onClose={() => setShowSubmittedModal(false)}
          autoCloseMs={0}
        />
      )}

      {showPreview && (
        <PreviewModal
          title="Report preview"
          open={showPreview}
          onClose={() => setShowPreview(false)}
          iframeSrcDoc={previewHtml}
          iframeTitle="Preview"
          downloading={downloadingPreview}
          onDownload={() => void handlePreviewDownloadPdf()}
          wide
        />
      )}
    </main>
  );
}
