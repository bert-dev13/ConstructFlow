export interface WorkItem {
  id: string;
  payItemId?: string;
  payItemVersion?: number;
  snapshotItemNo?: string;
  snapshotDescription?: string;
  snapshotUnit?: string;
  itemNo: string;
  description: string;
  unit: string;
  unitPrice: number;
  programmedQty: number;
  /** Optional revised quantity — used when showRevisedQuantity is on. */
  revisedQty?: number;
  previous: number;
  thisPeriod: number;
  remarks: string;
}

export interface WorkItemComputed extends WorkItem {
  contractAmount: number;
  weightPct: number;
  revisedAmount: number;
  revisedWeightPct: number;
  toDate: number;
  accomplishmentWeightPct: number;
  status: string;
}

export interface SwaTotals {
  totalContractAmount: number;
  totalWeightPct: number;
  totalRevisedAmount: number;
  totalRevisedWeightPct: number;
  totalToDateWeightPct: number;
  pctThisAccomplishment: number;
  totalThisAccomplishment: number;
  totalVoucher: number;
}

export function workItemRemarksStatus(accomplishmentWeightPct: number, plannedWeightPct: number): string {
  if (accomplishmentWeightPct <= 0) return 'Not yet started.';
  if (plannedWeightPct > 0 && Math.abs(accomplishmentWeightPct - plannedWeightPct) < 0.005) {
    return 'COMPLETED.';
  }
  return 'ON-GOING.';
}

export function computeWorkItems(
  items: WorkItem[],
  lessAmount = 0,
  showRevised = false,
): { items: WorkItemComputed[]; totals: SwaTotals } {
  const totalContract = items.reduce(
    (sum, i) => sum + i.unitPrice * i.programmedQty,
    0,
  );

  const totalRevised = showRevised
    ? items.reduce((sum, i) => {
        const rq = i.revisedQty ?? 0;
        return sum + (rq > 0 ? i.unitPrice * rq : i.unitPrice * i.programmedQty);
      }, 0)
    : 0;

  const computed: WorkItemComputed[] = items.map((item) => {
    const contractAmount = item.unitPrice * item.programmedQty;
    const weightPct = totalContract > 0 ? (contractAmount / totalContract) * 100 : 0;
    const revisedQty = item.revisedQty ?? 0;
    const useRevised = showRevised && revisedQty > 0;
    const revisedAmount = useRevised
      ? item.unitPrice * revisedQty
      : showRevised
        ? contractAmount
        : 0;
    const revisedWeightPct =
      showRevised && totalRevised > 0 ? (revisedAmount / totalRevised) * 100 : 0;

    const baseQty = useRevised ? revisedQty : item.programmedQty;
    const baselineAmount = showRevised && totalRevised > 0 ? totalRevised : totalContract;
    const toDate = (baseQty / 2) * item.unitPrice;
    const thisPeriod = toDate - item.previous;
    const plannedWeight = useRevised ? revisedWeightPct : weightPct;
    const accomplishmentWeightPct =
      baselineAmount > 0 ? (toDate / baselineAmount) * 100 : 0;
    const status = workItemRemarksStatus(accomplishmentWeightPct, plannedWeight);

    return {
      ...item,
      revisedQty: item.revisedQty ?? 0,
      thisPeriod,
      contractAmount,
      weightPct,
      revisedAmount,
      revisedWeightPct,
      toDate,
      accomplishmentWeightPct,
      status,
    };
  });

  const totalToDateWeightPct = computed.reduce((s, i) => s + i.accomplishmentWeightPct, 0);
  const totalThisAccomplishment = computed.reduce((s, i) => s + i.thisPeriod, 0);
  const accomplishmentBaseline = showRevised && totalRevised > 0 ? totalRevised : totalContract;
  const pctThisAccomplishment =
    accomplishmentBaseline > 0 ? (totalThisAccomplishment / accomplishmentBaseline) * 100 : 0;

  return {
    items: computed,
    totals: {
      totalContractAmount: totalContract,
      totalWeightPct: computed.reduce((s, i) => s + i.weightPct, 0),
      totalRevisedAmount: computed.reduce((s, i) => s + i.revisedAmount, 0),
      totalRevisedWeightPct: computed.reduce((s, i) => s + i.revisedWeightPct, 0),
      totalToDateWeightPct,
      pctThisAccomplishment,
      totalThisAccomplishment,
      totalVoucher: totalThisAccomplishment - lessAmount,
    },
  };
}

export function computeStewaSlippage(actual: number, planned: number): number {
  return Math.round((actual - planned) * 100) / 100;
}

export function formatMoney(n: number): string {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(n: number): string {
  return n.toFixed(2);
}

export function newWorkItem(): WorkItem {
  return {
    id: crypto.randomUUID(),
    payItemId: '',
    payItemVersion: undefined,
    snapshotItemNo: '',
    snapshotDescription: '',
    snapshotUnit: '',
    itemNo: '',
    description: '',
    unit: '',
    unitPrice: 0,
    programmedQty: 0,
    revisedQty: 0,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  };
}
