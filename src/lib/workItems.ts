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
  /** Manually entered TO DATE amount (peso). */
  toDateInput?: number;
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
  /** Section/subheader row. Stored data is unchanged; this is derived for display and totals. */
  isSection: boolean;
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

/**
 * Excel Remarks/Status:
 * IF(L=H,"COMPLETED",IF(L=0,"Not Yet Started","On going"))
 * where L and H are ROUND(amount / totalContract, 5) fractions.
 */
export function workItemRemarksStatus(
  accomplishmentWeightPct: number,
  plannedWeightPct: number,
): string {
  const accompFrac = Math.round((accomplishmentWeightPct / 100) * 1e5) / 1e5;
  const plannedFrac = Math.round((plannedWeightPct / 100) * 1e5) / 1e5;
  if (accompFrac === 0) return 'Not Yet Started';
  if (plannedFrac > 0 && accompFrac === plannedFrac) return 'COMPLETED';
  return 'On going';
}

/** A real Roman numeral, not a pay-item fragment such as "C" inside "C.1". */
function isRomanNumeral(token: string): boolean {
  return /^(?=[IVXLCDM])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i.test(
    token,
  );
}

/**
 * Section headings typed in Item No., such as "I. OTHER GENERAL REQUIREMENTS",
 * "II. SITE WORKS", or a bare marker "I" / "II." / "III.".
 * Ordinary item numbers ("1", "B.5", "101(3)b1", "C.1") are not headings.
 */
export function isSwaSectionHeading(itemNo: string): boolean {
  const text = itemNo.trim();
  if (!text) return false;
  if (/^[IVXLCDM]+(?:\s*[.\-–—:])?\s*$/i.test(text)) {
    return isRomanNumeral(text.replace(/[^IVXLCDM]/gi, ''));
  }
  const titled = text.match(/^([IVXLCDM]+)\s*[.\-–—:]\s+[A-Za-z]/i);
  return titled != null && isRomanNumeral(titled[1] ?? '');
}

/**
 * A section/header row. The Item No. decides this. Leftover quantity or price
 * on a heading stays stored, but the row is not a pay item.
 */
export function isSwaSectionRow(item: WorkItem): boolean {
  const itemNo = String(item.snapshotItemNo || item.itemNo || '').trim();
  const description = String(item.snapshotDescription || item.description || '').trim();
  if (isSwaSectionHeading(itemNo)) return true;
  return itemNo === '' && isSwaSectionHeading(description);
}

function blankSectionRow(item: WorkItem): WorkItemComputed {
  return {
    ...item,
    previous: Number(item.previous) || 0,
    revisedQty: item.revisedQty ?? 0,
    thisPeriod: 0,
    contractAmount: 0,
    weightPct: 0,
    revisedAmount: 0,
    revisedWeightPct: 0,
    toDate: 0,
    accomplishmentWeightPct: 0,
    status: '',
    remarks: item.remarks?.trim() ? item.remarks : '',
    isSection: true,
  };
}

/** Lump sum units such as "L.S.", "LS", or "lump sum". */
export function isLumpSumUnit(unit: string | null | undefined): boolean {
  const normalized = String(unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return normalized === 'ls' || normalized === 'lumpsum';
}

/**
 * TO DATE for L.S. = (Programmed Quantity / 2) × Unit Price.
 * TO DATE for every other unit = Contract Amount (Programmed Quantity × Unit Price).
 */
export function swaToDateAmount(programmedQty: number, unitPrice: number, unit = ''): number {
  const qty = Number(programmedQty) || 0;
  const price = Number(unitPrice) || 0;
  if (isLumpSumUnit(unit)) return (qty / 2) * price;
  return qty * price;
}

/** THIS PERIOD = TO DATE − PREVIOUS */
export function swaThisPeriodAmount(toDate: number, previous: number): number {
  return (Number(toDate) || 0) - (Number(previous) || 0);
}

/**
 * Excel WEIGHT %: ROUND(Item Contract Amount / Total Contract Amount, 5), shown as a percent.
 * That is (Contract Amount ÷ Total Contract Amount × 100) after the same 5-decimal ratio round.
 * WEIGHT % ACCOMPLISHMENT uses the same round on TO DATE ÷ Total Contract Amount.
 */
export function swaWeightPct(amount: number, totalProjectCost: number): number {
  if (totalProjectCost <= 0) return 0;
  const ratio = (Number(amount) || 0) / totalProjectCost;
  const rounded = Math.round(ratio * 1e5) / 1e5;
  return rounded * 100;
}

export function computeWorkItems(
  items: WorkItem[],
  lessAmount = 0,
  showRevised = false,
): { items: WorkItemComputed[]; totals: SwaTotals } {
  // Section headings stay on the form but do not enter Total Project Cost or accomplishment.
  const billable = items.filter((item) => !isSwaSectionRow(item));
  const totalProjectCost = billable.reduce(
    (sum, i) => sum + i.unitPrice * i.programmedQty,
    0,
  );

  const totalRevised = showRevised
    ? billable.reduce((sum, i) => {
        const rq = i.revisedQty ?? 0;
        return sum + (rq > 0 ? i.unitPrice * rq : i.unitPrice * i.programmedQty);
      }, 0)
    : 0;

  const computed: WorkItemComputed[] = items.map((item) => {
    if (isSwaSectionRow(item)) return blankSectionRow(item);
    const contractAmount = item.unitPrice * item.programmedQty;
    // WEIGHT % = (Contract Amount / Total Project Cost) × 100
    const weightPct = swaWeightPct(contractAmount, totalProjectCost);
    const revisedQty = item.revisedQty ?? 0;
    const useRevised = showRevised && revisedQty > 0;
    const revisedAmount = useRevised
      ? item.unitPrice * revisedQty
      : showRevised
        ? contractAmount
        : 0;
    const revisedWeightPct = showRevised
      ? swaWeightPct(revisedAmount, totalRevised)
      : 0;

    const previous = Number(item.previous) || 0;
    const toDate =
      item.toDateInput != null && Number.isFinite(Number(item.toDateInput))
        ? Number(item.toDateInput)
        : 0;
    // THIS PERIOD = TO DATE − PREVIOUS
    const thisPeriod = swaThisPeriodAmount(toDate, previous);

    // WEIGHT % ACCOMPLISHMENT = (TO DATE / Total Project Cost) × 100
    const accomplishmentWeightPct = swaWeightPct(toDate, totalProjectCost);
    const plannedWeight = useRevised ? revisedWeightPct : weightPct;
    const status = workItemRemarksStatus(accomplishmentWeightPct, plannedWeight);

    return {
      ...item,
      previous,
      revisedQty,
      thisPeriod,
      contractAmount,
      weightPct,
      revisedAmount,
      revisedWeightPct,
      toDate,
      accomplishmentWeightPct,
      status,
      isSection: false,
      // Keep user-entered remarks; fall back to Excel status when blank.
      remarks: item.remarks?.trim() ? item.remarks : status,
    };
  });

  const billableComputed = computed.filter((row) => !row.isSection);
  const totalToDateWeightPct = billableComputed.reduce((s, i) => s + i.accomplishmentWeightPct, 0);
  // TOTAL THIS ACCOMPLISHMENT = SUM(THIS PERIOD) — peso amounts
  const totalThisAccomplishment = billableComputed.reduce((s, i) => s + i.thisPeriod, 0);
  const pctThisAccomplishment =
    totalProjectCost > 0 ? (totalThisAccomplishment / totalProjectCost) * 100 : 0;

  return {
    items: computed,
    totals: {
      totalContractAmount: totalProjectCost,
      totalWeightPct: billableComputed.reduce((s, i) => s + i.weightPct, 0),
      totalRevisedAmount: billableComputed.reduce((s, i) => s + i.revisedAmount, 0),
      totalRevisedWeightPct: billableComputed.reduce((s, i) => s + i.revisedWeightPct, 0),
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

/** Two-decimal percent, rounding 5 away from zero the way the Excel percent format does. */
export function formatPct(n: number): string {
  const value = Number(n) || 0;
  const sign = value < 0 ? -1 : 1;
  const hundredths = Math.round(Number((Math.abs(value) * 100).toFixed(8))) / 100;
  return (sign * hundredths).toFixed(2);
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
