import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { IarAccomplishmentTable } from '../components/IarAccomplishmentTable';
import { IarResourceTable } from '../components/IarResourceTable';
import { IarVariationTable } from '../components/IarVariationTable';
import { ProjectSelect } from '../components/ProjectSelect';
import { WorkItemsTable } from '../components/WorkItemsTable';
import { newIarItem, newManpowerRow, newVariationItem, type IarAccomplishmentItem, type IarManpowerRow, type IarVariationItem } from '../lib/iarItems';
import { computeStewaSlippage, newWorkItem, type WorkItem } from '../lib/workItems';
import { applyStewaDerivedFields } from '../lib/stewaCalculations';
import { getProject, listProjects } from '../lib/projectsApi';
import { buildReferenceWorkItems } from '../data/roadProjectReference';
import {
  approveReport,
  contractorConfirm,
  getReport,
  getStewaFromSwa,
  listReportRevisions,
  previewReport,
  rejectReport,
  saveReport,
  sendToContractor,
  submitReport,
  type ContractorChange,
} from '../lib/swaStewaApi';
import { trackReportViewed } from '../lib/recentViewed';
import { Button, ButtonLink } from '../components/ui/Button';
import { FormField, TextArea, TextInput } from '../components/ui/FormField';
import { FormSection } from '../components/ui/FormSection';
import { PageHeader } from '../components/ui/PageHeader';
import { ReportTypeBadge } from '../components/ui/StatusBadge';
import { SubmissionSuccessSign } from '../components/ui/SubmissionSuccessSign';
import { UndoRedoToolbar } from '../components/ui/UndoRedoToolbar';
import { useUndoRedo, useUndoRedoKeyboard } from '../hooks/useUndoRedo';
import {
  canEditReport,
  reportIsViewOnly,
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
    projectId: '1',
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
      project_title: 'Improvement of Road Network',
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

const STEWA_DERIVE_KEYS = new Set(['report_date', 'period_covered', 'notice_to_proceed']);

const STEWA_FIELDS = [
  { key: 'report_date', label: 'Report date', type: 'date' },
  { key: 'period_covered', label: 'Period covered (end date)', type: 'date', hint: 'Contract duration = days from report date through this date.' },
  { key: 'contract_duration', label: 'Contract duration (days)', type: 'number', computed: true },
  { key: 'notice_to_proceed', label: 'Notice to proceed date', type: 'date' },
  { key: 'expiry_date', label: 'Expiry date', type: 'date' },
  { key: 'approved_time_extension', label: 'Approved time extension', type: 'number' },
  { key: 'approved_time_suspension', label: 'Approved time suspension', type: 'text' },
  { key: 'total_time_extension', label: 'Total time extension', type: 'number' },
  { key: 'revised_contract_duration', label: 'Revised contract duration', type: 'number' },
  { key: 'revised_expiry_date', label: 'Revised expiry date', type: 'date' },
  { key: 'calendar_days_elapsed', label: 'Calendar days elapsed', type: 'number' },
  {
    key: 'percent_actual',
    label: 'Work accomplished — Actual',
    type: 'number',
    computed: true,
    hint: 'From SWA on the same report date (total accomplishment %).',
  },
  {
    key: 'percent_planned',
    label: 'Work accomplished — Planned',
    type: 'number',
    computed: true,
    hint: 'From SWA on the same report date (target plan %).',
  },
  { key: 'remarks', label: 'Remarks', type: 'textarea' },
  { key: 'submitted_by_name', label: 'Submitted by (name)', type: 'text' },
  { key: 'submitted_by_title', label: 'Submitted by (title)', type: 'text' },
  { key: 'noted_by_name', label: 'Noted by (name)', type: 'text' },
  { key: 'noted_by_title', label: 'Noted by (title)', type: 'text' },
] as const;

export function SwaStewaEditorPage() {
  const { type: typeParam, id: idParam } = useParams<{ type?: string; id?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projectId: selectedProjectId, setProjectId: setSelectedProjectId } = useSelectedProject();
  const initialProjectRef = useRef(selectedProjectId);

  const isContractor = user?.role === 'contractor';
  const routeType =
    typeParam === 'SWA' || typeParam === 'STEWA' || typeParam === 'IAR' ? typeParam : null;
  const [reportType, setReportType] = useState<SwaStewaReportKind>(routeType ?? 'IAR');
  const [reportId, setReportId] = useState<number | undefined>(idParam ? Number(idParam) : undefined);
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
  const [reportNumber, setReportNumber] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);
  const [generateSCurve, setGenerateSCurve] = useState(false);
  const [generatePdm, setGeneratePdm] = useState(false);
  const [generateBarChart, setGenerateBarChart] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [contractorChanges, setContractorChanges] = useState<ContractorChange[]>([]);
  const [revisionCount, setRevisionCount] = useState(0);
  const autoSaveReady = useRef(false);
  const saveSeq = useRef(0);
  const savingRef = useRef(false);
  const skipNextLoad = useRef(false);

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
        if (!projects.length) return;
        const current = String(projectId);
        const currentOk = projects.some((p) => String(p.id) === current);
        if (currentOk) return;
        const preferred =
          projects.find((p) => String(p.id) === selectedProjectId) ?? projects[0];
        const nextId = String(preferred.id);
        setEditor((s) => ({ ...s, projectId: nextId }));
        setSelectedProjectId(nextId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // New reports only: bind to the current project (or the first in the list).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam]);

  useEffect(() => {
    if (idParam) return;
    let cancelled = false;
    getProject(Number(projectId))
      .then((res) => {
        if (cancelled) return;
        const d = res.report_defaults;
        setEditor((s) => ({
          ...s,
          data: {
            ...s.data,
            project_name: d.project_name || s.data.project_name,
            location: d.location ?? s.data.location,
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
    if (reportType !== 'STEWA') return;
    if (!data.report_date && !data.period_covered && !data.notice_to_proceed) return;
    setEditor((s) => {
      const nextData = applyStewaDerivedFields(s.data);
      if (
        nextData.contract_duration === s.data.contract_duration &&
        nextData.calendar_days_elapsed === s.data.calendar_days_elapsed
      ) {
        return s;
      }
      return { ...s, data: nextData };
    });
  }, [reportType, data.report_date, data.period_covered, data.notice_to_proceed, setEditor]);

  useEffect(() => {
    if (reportType !== 'STEWA' || !data.report_date) return;
    let cancelled = false;
    getStewaFromSwa(Number(projectId), data.report_date)
      .then((res) => {
        if (cancelled) return;
        if (res.percent_actual == null && res.percent_planned == null) return;
        setEditor((s) => ({
          ...s,
          data: {
            ...s.data,
            percent_actual:
              res.percent_actual != null ? String(res.percent_actual) : s.data.percent_actual,
            percent_planned:
              res.percent_planned != null ? String(res.percent_planned) : s.data.percent_planned,
            swa_source_report: res.swa_report_number ?? s.data.swa_source_report ?? '',
          },
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reportType, projectId, data.report_date, setEditor]);

  useEffect(() => {
    if (!idParam) {
      setDirty(false);
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
        setReportType(r.report_type);
        setReportId(r.id);
        setStatus(r.status);
        setReportNumber(r.report_number);
        setContractorChanges(r.contractor_changes ?? []);
        trackReportViewed(r.id);
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
        replaceEditor({
          projectId: String(r.project_id),
          data: { ...base.data, ...scalar },
          lineItems: r.line_items?.length
            ? r.line_items.map((item, i) => ({
                id: String(item.id ?? `wi-${i}`),
                itemNo: String(item.itemNo ?? ''),
                description: String(item.description ?? ''),
                unit: String(item.unit ?? ''),
                unitPrice: Number(item.unitPrice ?? 0),
                programmedQty: Number(item.programmedQty ?? 0),
                revisedQty: Number(item.revisedQty ?? 0),
                previous: Number(item.previous ?? 0),
                thisPeriod: Number(item.thisPeriod ?? 0),
                remarks: String(item.remarks ?? ''),
              }))
            : base.lineItems,
          iarItems: acc?.length
            ? acc.map((item, i) => ({
                id: String(item.id ?? `iar-${i}`),
                itemNo: String(item.itemNo ?? item.item_no ?? ''),
                description: String(item.description ?? ''),
                location: String(item.location ?? ''),
                physicalQty: (item.physicalQty ?? item.physical_qty ?? '') as number | '',
                billableQty: (item.billableQty ?? item.billable_qty ?? '') as number | '',
                unit: String(item.unit ?? ''),
              }))
            : base.iarItems,
          variationItems: vo?.length
            ? vo.map((item, i) => ({
                id: String(item.id ?? `vo-${i}`),
                itemNo: String(item.itemNo ?? item.item_no ?? ''),
                description: String(item.description ?? ''),
                quantity: (item.quantity ?? '') as number | '',
                unit: String(item.unit ?? ''),
                additive: String(item.additive ?? ''),
                deductive: String(item.deductive ?? ''),
                newItem: String(item.newItem ?? item.new_item ?? ''),
              }))
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
      .catch(() => setError('Could not load report'))
      .finally(() => {
        requestAnimationFrame(() => {
          autoSaveReady.current = true;
        });
      });
  }, [idParam, isContractor, replaceEditor, user?.name]);

  const markDirty = () => {
    setDirty(true);
    setSuccess('');
  };

  const setField = (key: string, value: string) => {
    markDirty();
    setEditor((s) => {
      let nextData = { ...s.data, [key]: value };
      if (reportType === 'STEWA' && STEWA_DERIVE_KEYS.has(key)) {
        nextData = applyStewaDerivedFields(nextData);
      }
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
    setEditor((s) => ({ ...s, activitiesText: value }));
  };
  const setFieldInstructionsText = (value: string) => {
    markDirty();
    setEditor((s) => ({ ...s, fieldInstructionsText: value }));
  };

  const payload = useCallback(() => {
    const report_data: Record<string, unknown> = {
      ...data,
      slippage: computeStewaSlippage(
        parseFloat(data.percent_actual || '0'),
        parseFloat(data.percent_planned || '0'),
      ),
    };
    if (reportType === 'IAR') {
      report_data.accomplishment_items = iarItems.map((item) => ({
        item_no: item.itemNo,
        description: item.description,
        location: item.location,
        physical_qty: item.physicalQty,
        billable_qty: item.billableQty,
        unit: item.unit,
      }));
      report_data.variation_items = variationItems.map((item) => ({
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
      id: reportId,
      report_type: reportType,
      project_id: Number(projectId),
      report_data,
      line_items: reportType === 'SWA' ? lineItems : [],
      created_by: user?.id && user.id > 0 ? user.id : undefined,
    };
  }, [
    activitiesText,
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
        const wasNew = !reportId;
        setReportId(res.report.id);
        setReportNumber(res.report.report_number);
        setStatus(res.report.status);
        setContractorChanges(res.report.contractor_changes ?? []);
        setDirty(false);
        autoSaveReady.current = false;
        if (wasNew || !idParam) {
          skipNextLoad.current = true;
          navigate(`/swa-stewa/edit/${res.report.id}`, { replace: true });
        }
        requestAnimationFrame(() => {
          autoSaveReady.current = true;
        });
        setSuccess(silent ? 'Auto-saved.' : 'Draft saved.');
        setError('');
      } catch (err) {
        if (seq !== saveSeq.current) return;
        setError(err instanceof Error ? err.message : 'Save failed');
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

  const handlePreview = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await previewReport(payload());
      setPreviewHtml(res.preview_html);
      setShowPreview(true);
      if (!reportId) {
        setReportId(res.report.id);
        setReportNumber(res.report.report_number);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      let id = reportId;
      if (!id) {
        const res = await saveReport(payload());
        id = res.report.id;
        setReportId(id);
        setReportNumber(res.report.report_number);
        navigate(`/swa-stewa/edit/${id}`, { replace: true });
      }
      await submitReport(id!, user?.id && user.id > 0 ? user.id : 1);
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
      const actorId = user?.id && user.id > 0 ? user.id : 1;
      const gen =
        user?.role === 'engineer_2'
          ? { s_curve: generateSCurve, pdm: generatePdm, bar_chart: generateBarChart }
          : undefined;
      const res = await approveReport(reportId, actorId, user?.role, gen);
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
    const actorId = user?.id && user.id > 0 ? user.id : 1;
    await rejectReport(reportId, rejectReason, actorId);
    setStatus('rejected');
  };

  const canEditForm = canEditReport(user?.role, reportType, status);
  const isViewOnly = reportIsViewOnly(user?.role, reportType, status);
  const changedFields = new Set(contractorChanges.map((c) => c.field.split('.')[0]));
  const isFieldChanged = (key: string) => changedFields.has(key);

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
    (user?.role === 'engineer_4' &&
      (status === 'with_engineer_4' || status === 'with_engineer_3'));
  const canRequestRevision = user?.role === 'engineer_2' && status === 'pending_review';
  useUndoRedoKeyboard(handleUndo, handleRedo, canEditForm);

  const renderField = (
    key: string,
    label: string,
    type: 'text' | 'number' | 'date' | 'textarea' = 'text',
    span2 = false,
    computed = false,
    hint?: string,
  ) => {
    const changed = isFieldChanged(key);
    const change = contractorChanges.find((c) => c.field === key);
    const readOnly = computed;
    return (
      <FormField key={key} label={label} hint={hint} className={span2 ? 'sm:col-span-2' : ''}>
        {type === 'textarea' ? (
          <TextArea
            disabled={!canEditForm}
            rows={3}
            value={data[key] ?? ''}
            onChange={(e) => setField(key, e.target.value)}
            className={changed ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300' : undefined}
          />
        ) : (
          <TextInput
            disabled={!canEditForm}
            readOnly={readOnly}
            type={type}
            value={data[key] ?? ''}
            onChange={(e) => setField(key, e.target.value)}
            className={
              readOnly
                ? 'bg-surface-muted'
                : changed
                  ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300'
                  : undefined
            }
          />
        )}
        {change && (
          <p className="mt-1 text-xs text-amber-800">
            Contractor changed: <span className="line-through">{change.old || '—'}</span> →{' '}
            <strong>{change.new || '—'}</strong>
          </p>
        )}
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

      {isViewOnly && user?.role === 'contractor' && reportType === 'IAR' && (
        <div className="mx-auto max-w-4xl px-8">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            View only — this IAR cannot be edited in its current status.
          </div>
        </div>
      )}

      {user?.role === 'engineer_1' && contractorChanges.length > 0 && (
        <div className="mx-auto max-w-4xl px-8">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">Contractor changes ({contractorChanges.length})</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {contractorChanges.map((c) => (
                <li key={c.field}>
                  {c.label}: <span className="line-through">{c.old || '—'}</span> →{' '}
                  <strong>{c.new || '—'}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {revisionCount > 0 && (
        <div className="mx-auto max-w-4xl px-8 pt-2">
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
        <div className="mx-auto max-w-4xl px-8 pt-4">
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
        className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-8 py-8 pb-28"
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
          >
            <div className="grid gap-5 sm:grid-cols-2">
              {STEWA_FIELDS.map((f) =>
                renderField(
                  f.key,
                  f.label,
                  f.type === 'textarea' ? 'textarea' : f.type,
                  f.type === 'textarea',
                  'computed' in f && f.computed === true,
                  'hint' in f ? f.hint : undefined,
                ),
              )}
              <FormField label="Slippage (Actual − Planned)">
                <TextInput
                  readOnly
                  value={`${computeStewaSlippage(
                    parseFloat(data.percent_actual || '0'),
                    parseFloat(data.percent_planned || '0'),
                  )}%`}
                  className="bg-surface-muted"
                />
                <p className="mt-1 text-[10px] text-text-muted">
                  Negative when Actual is less than Planned (behind schedule).
                </p>
              </FormField>
            </div>
            {data.swa_source_report ? (
              <p className="mt-3 text-xs text-text-muted">
                Actual and planned % pulled from <strong>{data.swa_source_report}</strong> on the
                same report date.
              </p>
            ) : (
              <p className="mt-3 text-xs text-amber-800">
                No SWA found for this report date — save or create the matching SWA first.
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
                {(
                  [
                    ['contract_number', 'Contract No.'],
                    ['project_title', 'Project title'],
                    ['municipality', 'Municipality'],
                    ['week_covered', 'Week covered'],
                    ['contractor', 'Contractor'],
                    ['contractor_representative', 'Contractor representative'],
                  ] as const
                ).map(([key, label]) => renderField(key, label))}
              </div>
            </FormSection>
            <FormSection title="Accomplishment" step={2} description="Quantity of work completed this week.">
              <IarAccomplishmentTable items={iarItems} onChange={setIarItems} readOnly={!canEditForm} />
            </FormSection>
            <FormSection title="For variation order" step={3} description="Contract changes — additive, deductive, or new items.">
              <IarVariationTable items={variationItems} onChange={setVariationItems} readOnly={!canEditForm} />
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
                  />
                </FormField>
                <FormField label="Field instructions" hint="One instruction per line">
                  <TextArea
                    disabled={!canEditForm}
                    rows={5}
                    value={fieldInstructionsText}
                    onChange={(e) => setFieldInstructionsText(e.target.value)}
                  />
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
                  readOnly={!canEditForm}
                />
                <IarResourceTable
                  title="Equipment"
                  items={equipment}
                  onChange={setEquipment}
                  readOnly={!canEditForm}
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
                ).map(([key, label]) => renderField(key, label))}
              </div>
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
              readOnly={!canEditForm}
            />
          </FormSection>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </form>

      <div className="sticky bottom-0 border-t border-border/80 bg-card/95 px-8 py-4 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
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
                (reportType === 'SWA' || reportType === 'STEWA') &&
                (status === 'draft' || status === 'rejected') && (
                  <Button type="button" variant="secondary" disabled={loading} onClick={handleSendToContractor}>
                    Send to contractor
                  </Button>
                )}
              {user?.role === 'contractor' &&
                (reportType === 'SWA' || reportType === 'STEWA') &&
                status === 'pending_contractor' && (
                  <Button type="button" variant="primary" disabled={loading} onClick={handleContractorConfirm}>
                    Confirm SWA/STEWA
                  </Button>
                )}
              {(user?.role === 'engineer_1' || user?.role === 'engineer_2') && (
                  <Button type="button" variant="primary" disabled={loading} onClick={handleSubmit}>
                    Submit for review
                  </Button>
                )}
              {user?.role === 'contractor' && reportType === 'IAR' && (
                <Button type="button" variant="primary" disabled={loading} onClick={handleSubmit}>
                  Submit IAR
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
          {isViewOnly && reportNumber && (status === 'generated' || status === 'approved') && (
            <ButtonLink to={`/reports/view/${reportNumber}`} variant="secondary">
              Open official PDF
            </ButtonLink>
          )}
          {canApproveNow && (
            <>
              {user?.role === 'engineer_2' && reportType === 'IAR' && (
                <div className="mr-auto w-full max-w-sm rounded-xl border border-border bg-surface-muted/60 p-3 text-sm">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={generateSCurve && generatePdm && generateBarChart}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setGenerateSCurve(v);
                        setGeneratePdm(v);
                        setGenerateBarChart(v);
                      }}
                    />
                    Select All
                  </label>
                  <label className="mt-1.5 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={generateSCurve}
                      onChange={(e) => setGenerateSCurve(e.target.checked)}
                    />
                    Generate S-Curve
                  </label>
                  <label className="mt-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={generatePdm}
                      onChange={(e) => setGeneratePdm(e.target.checked)}
                    />
                    Generate PDM
                  </label>
                  <label className="mt-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={generateBarChart}
                      onChange={(e) => setGenerateBarChart(e.target.checked)}
                    />
                    Generate Bar Chart
                  </label>
                </div>
              )}
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
            <ButtonLink to={`/reports/view/${reportNumber}`} variant="secondary">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-surface-muted/50 px-5 py-4">
              <h3 className="font-semibold text-text">Report preview</h3>
              <Button type="button" variant="ghost" onClick={() => setShowPreview(false)}>
                Close
              </Button>
            </div>
            <iframe title="Preview" srcDoc={previewHtml} className="min-h-[60vh] flex-1 w-full border-0 bg-white" />
          </div>
        </div>
      )}
    </main>
  );
}
