'use client';

import {
  computeWorkItems,
  formatMoney,
  formatPct,
  isSwaSectionHeading,
  newWorkItem,
  type WorkItem,
} from '../lib/workItems';
import { PayItemSelect } from './PayItemSelect';
import { isPlaceholderUnit, resolveItemUnit } from '../lib/boqLookup';
import { linkedPayItemId } from '../lib/projectBoqSync';
import type { PayItem } from '../lib/payItemsApi';
import type { ProjectBoqItem } from '../lib/projectBoqApi';

interface WorkItemsTableProps {
  items: WorkItem[];
  lessReason: string;
  lessAmount: number;
  showRevised: boolean;
  onShowRevisedChange?: (value: boolean) => void;
  onLessReasonChange?: (value: string) => void;
  onLessAmountChange?: (value: number) => void;
  onChange: (items: WorkItem[]) => void;
  boqItems?: ProjectBoqItem[];
  onRefreshProjectBoq?: () => void | Promise<void>;
  readOnly?: boolean;
}

export function WorkItemsTable({
  items,
  lessReason,
  lessAmount,
  showRevised,
  onShowRevisedChange,
  onLessReasonChange,
  onLessAmountChange,
  onChange,
  boqItems,
  onRefreshProjectBoq,
  readOnly,
}: WorkItemsTableProps) {
  const { items: computed, totals } = computeWorkItems(items, lessAmount, showRevised);

  const update = (id: string, patch: Partial<WorkItem>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const addRow = () => onChange([...items, newWorkItem()]);
  const removeRow = (id: string) => onChange(items.filter((i) => i.id !== id));

  const leadingColSpan = 5; // item, desc, prog qty, unit price, unit

  const selectPayItem = (id: string, item: PayItem | null) => {
    if (!item) {
      update(id, {
        payItemId: '',
        payItemVersion: undefined,
        snapshotItemNo: '',
        snapshotDescription: '',
        snapshotUnit: '',
        itemNo: '',
        description: '',
        unit: '',
        programmedQty: 0,
        revisedQty: 0,
        unitPrice: 0,
      });
      return;
    }
    const boqItem = (boqItems ?? []).find(
      (boq) =>
        boq.active !== false
        && (
          (boq.payItemId && boq.payItemId === item.id)
          || boq.id === item.id
          || (
            boq.itemNo
            && item.itemNo
            && boq.itemNo.trim().toLowerCase() === item.itemNo.trim().toLowerCase()
          )
        ),
    );
    const resolved = resolveItemUnit(
      boqItem?.itemNo || item.itemNo,
      boqItem?.description || item.description,
      boqItem && !isPlaceholderUnit(boqItem.unit) ? boqItem.unit : item.unit,
    );
    update(id, {
      payItemId: linkedPayItemId(item.id, boqItem),
      payItemVersion: item.version,
      snapshotItemNo: boqItem?.itemNo || item.itemNo,
      snapshotDescription: resolved.description,
      snapshotUnit: resolved.unit,
      itemNo: boqItem?.itemNo || item.itemNo,
      description: resolved.description,
      unit: resolved.unit,
      ...(boqItem
        ? {
            programmedQty: boqItem.programmedQty,
            revisedQty: boqItem.revisedQty ?? undefined,
            unitPrice: boqItem.unitPrice,
          }
        : {}),
    });
  };

  const setCustomItemNo = (id: string, text: string) => {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    const trimmed = text.trim();
    if (trimmed === current.itemNo.trim() && !current.payItemId) return;
    const heading = isSwaSectionHeading(trimmed);
    update(id, {
      itemNo: trimmed,
      snapshotItemNo: trimmed,
      payItemId: '',
      payItemVersion: undefined,
      ...(heading
        ? {
            description: '',
            snapshotDescription: '',
            unit: '',
            snapshotUnit: '',
            programmedQty: 0,
            revisedQty: 0,
            unitPrice: 0,
            previous: 0,
            toDateInput: undefined,
            remarks: '',
          }
        : {}),
    });
  };

  return (
    <div className="overflow-x-auto">
      {!readOnly && (
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showRevised}
            onChange={(e) => onShowRevisedChange?.(e.target.checked)}
          />
          <span>
            Include <strong>REVISED</strong> columns (quantity, amount, weight %)
          </span>
        </label>
      )}
      {readOnly && showRevised && (
        <p className="mb-2 text-xs text-text-muted">REVISED quantities are included on this report.</p>
      )}

      <table className="w-full min-w-[900px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="p-2" rowSpan={2}>
              Item No.
            </th>
            <th className="p-2 text-left" rowSpan={2}>
              Description
            </th>
            <th className="p-2" rowSpan={2}>
              Prog. Qty
            </th>
            <th className="p-2" rowSpan={2}>
              Unit Price
            </th>
            <th className="p-2" rowSpan={2}>
              Unit
            </th>
            <th className="p-2" rowSpan={2}>
              Contract Amt
            </th>
            <th className="p-2" rowSpan={2}>
              Weight %
            </th>
            {showRevised && (
              <th className="p-2" colSpan={3}>
                Revised
              </th>
            )}
            <th className="p-2" colSpan={3}>
              Accomplishment
            </th>
            <th className="p-2" rowSpan={2}>
              Wt % Accomp.
            </th>
            <th className="p-2" rowSpan={2}>
              Remarks/Status
            </th>
            {!readOnly && <th className="p-2" rowSpan={2} />}
          </tr>
          <tr className="border-b border-border bg-surface-muted">
            {showRevised && (
              <>
                <th className="p-2">Qty</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Weight %</th>
              </>
            )}
            <th className="p-2">Previous</th>
            <th className="p-2">This Period</th>
            <th className="p-2">To Date</th>
          </tr>
        </thead>
        <tbody>
          {computed.map((row) => (
            <tr key={row.id} className={`border-b border-border/50 ${row.isSection ? 'bg-surface-muted/40' : ''}`}>
              <td className="p-1">
                {readOnly ? (
                  <span className={row.isSection ? 'font-semibold' : undefined}>
                    {row.snapshotItemNo || row.itemNo}
                  </span>
                ) : (
                  <PayItemSelect
                    value={row.payItemId ?? ''}
                    onChange={(item) => selectPayItem(row.id, item)}
                    onCustomText={(text) => setCustomItemNo(row.id, text)}
                    allowCustomText
                    fallbackLabel={row.itemNo || undefined}
                    projectBoqItems={boqItems}
                    onRefreshProjectBoq={onRefreshProjectBoq}
                  />
                )}
              </td>
              <td className="p-1">
                {readOnly ? (
                  row.isSection ? (
                    <span className="font-semibold">{row.snapshotDescription || row.description}</span>
                  ) : (
                    row.snapshotDescription || row.description
                  )
                ) : (
                  <input
                    type="text"
                    className={`w-full min-w-[10rem] rounded border border-border px-1.5 py-0.5 text-left text-xs ${row.isSection ? 'font-semibold' : ''}`}
                    value={row.snapshotDescription || row.description}
                    onChange={(e) =>
                      update(row.id, {
                        description: e.target.value,
                        snapshotDescription: e.target.value,
                      })
                    }
                  />
                )}
              </td>
              {row.isSection ? (
                <>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  {showRevised && (
                    <>
                      <td />
                      <td />
                      <td />
                    </>
                  )}
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                </>
              ) : (
                <>
              <td className="p-1">
                {readOnly ? (
                  row.programmedQty
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border border-border px-1 py-0.5 text-right"
                    value={row.programmedQty || ''}
                    onChange={(e) =>
                      update(row.id, { programmedQty: parseFloat(e.target.value) || 0 })
                    }
                  />
                )}
              </td>
              <td className="p-1">
                {readOnly ? (
                  formatMoney(row.unitPrice)
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border border-border px-1 py-0.5 text-right"
                    value={row.unitPrice || ''}
                    onChange={(e) =>
                      update(row.id, { unitPrice: parseFloat(e.target.value) || 0 })
                    }
                  />
                )}
              </td>
              <td className="p-1">
                {resolveItemUnit(
                  row.snapshotItemNo || row.itemNo,
                  row.snapshotDescription || row.description,
                  row.snapshotUnit || row.unit,
                ).unit || row.snapshotUnit || row.unit}
              </td>
              <td className="p-1 text-right">{formatMoney(row.contractAmount)}</td>
              <td className="p-1 text-right">{formatPct(row.weightPct)}</td>
              {showRevised && (
                <>
                  <td className="p-1">
                    {readOnly ? (
                      row.revisedQty || '—'
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        className="w-20 rounded border border-border px-1 py-0.5 text-right"
                        value={row.revisedQty || ''}
                        onChange={(e) =>
                          update(row.id, { revisedQty: parseFloat(e.target.value) || 0 })
                        }
                        placeholder="optional"
                        title="Leave blank to keep programmed quantity"
                      />
                    )}
                  </td>
                  <td className="p-1 text-right">{formatMoney(row.revisedAmount)}</td>
                  <td className="p-1 text-right">{formatPct(row.revisedWeightPct)}</td>
                </>
              )}
              <td className="p-1">
                {readOnly ? (
                  row.previous ? formatMoney(row.previous) : '—'
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border border-border px-1 py-0.5 text-right"
                    value={row.previous || ''}
                    onChange={(e) =>
                      update(row.id, { previous: parseFloat(e.target.value) || 0 })
                    }
                    title="Previous accomplishment amount (peso)"
                  />
                )}
              </td>
              <td className="p-1">
                {readOnly ? (
                  formatMoney(row.thisPeriod)
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    className="w-24 rounded border border-border bg-surface-muted px-1 py-0.5 text-right text-text-muted"
                    value={row.thisPeriod ? Number(row.thisPeriod.toFixed(2)) : ''}
                    readOnly
                    disabled
                    title="Auto: TO DATE − PREVIOUS"
                  />
                )}
              </td>
              <td className="p-1 text-right" title="To-date accomplishment amount (peso)">
                {readOnly ? (
                  formatMoney(row.toDate)
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    className="w-24 rounded border border-border px-1 py-0.5 text-right"
                    value={row.toDate ? Number(row.toDate.toFixed(2)) : ''}
                    onChange={(e) =>
                      update(row.id, { toDateInput: parseFloat(e.target.value) || 0 })
                    }
                    title="To-date accomplishment amount (peso)"
                  />
                )}
              </td>
              <td className="p-1 text-right" title="Auto: TO DATE ÷ Total Contract Amount">
                {formatPct(row.accomplishmentWeightPct)}
              </td>
              <td className="p-1 text-left" title="Editable remarks — blank uses the Excel status rule">
                {readOnly ? (
                  row.remarks || row.status
                ) : (
                  <input
                    type="text"
                    className="w-full min-w-[8rem] rounded border border-border px-1.5 py-0.5 text-left text-xs"
                    value={items.find((item) => item.id === row.id)?.remarks ?? ''}
                    placeholder={row.status}
                    onChange={(e) => update(row.id, { remarks: e.target.value })}
                  />
                )}
              </td>
                </>
              )}
              {!readOnly && (
                <td className="p-1">
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    className="text-red-500 hover:underline"
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
          <tr className="bg-surface-muted font-semibold">
            <td colSpan={leadingColSpan} className="p-2 text-right">
              TOTAL
            </td>
            <td className="p-2 text-right">{formatMoney(totals.totalContractAmount)}</td>
            <td className="p-2 text-right">{formatPct(totals.totalWeightPct)}</td>
            {showRevised && (
              <>
                <td />
                <td className="p-2 text-right">{formatMoney(totals.totalRevisedAmount)}</td>
                <td className="p-2 text-right">{formatPct(totals.totalRevisedWeightPct)}</td>
              </>
            )}
            <td colSpan={2} />
            <td />
            <td className="p-2 text-right">{formatPct(totals.totalToDateWeightPct)}</td>
            <td colSpan={readOnly ? 1 : 2} />
          </tr>
        </tbody>
      </table>
      {!readOnly && (
        <>
          <button
            type="button"
            onClick={addRow}
            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            + Add work item
          </button>
          <p className="mt-2 text-xs text-text-muted">
            Type an <strong>Item No.</strong> such as A.1 or B.1 and choose a match, or type any
            text such as <strong>I. OTHER GENERAL REQUIREMENTS</strong> for a section heading.
            A Roman-numeral heading such as I. or II. SITE WORKS leaves the rest of that row blank and is not included in the totals. A matched item
            still fills description and unit from the DPWH standard pay item list.
            {showRevised && (
              <>
                {' '}
                When a revised quantity is entered, accomplishment weight uses the revised baseline.
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            <strong>Formulas:</strong> TO DATE is entered manually; THIS PERIOD = TO DATE −
            PREVIOUS; Weight % = (Contract Amt ÷ Total Project Cost) × 100;
            WT% Accomp. = (TO DATE ÷ Total Project Cost) × 100; Remarks default to the Excel status
            rule and can be edited.
          </p>
        </>
      )}
      <div className="mt-4 grid gap-2 text-sm sm:ml-auto sm:w-80">
        <div className="flex justify-between">
          <span>% This Accomplishment</span>
          <strong>{formatPct(totals.pctThisAccomplishment)}%</strong>
        </div>
        <div className="flex justify-between">
          <span>Total Project Cost</span>
          <strong>P {formatMoney(totals.totalContractAmount)}</strong>
        </div>
        <div className="flex justify-between">
          <span>Total This Accomplishment</span>
          <strong>P {formatMoney(totals.totalThisAccomplishment)}</strong>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>Less:</span>
          {readOnly ? (
            <span className="text-right">
              {lessReason || '—'}
              {lessAmount > 0 ? ` · P ${formatMoney(lessAmount)}` : ''}
            </span>
          ) : (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <input
                type="text"
                className="min-w-[8rem] flex-1 rounded border border-border px-2 py-1 text-sm"
                placeholder="Reason (e.g. Advance Payment)"
                value={lessReason}
                onChange={(e) => onLessReasonChange?.(e.target.value)}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-28 rounded border border-border px-2 py-1 text-right text-sm"
                placeholder="0.00"
                value={lessAmount || ''}
                onChange={(e) => onLessAmountChange?.(parseFloat(e.target.value) || 0)}
              />
            </div>
          )}
        </div>
        <div className="flex justify-between border-t border-border pt-2">
          <span title="Total This Accomplishment − Less">Total Voucher</span>
          <strong>P {formatMoney(totals.totalVoucher)}</strong>
        </div>
        <p className="text-[10px] text-text-muted">
          Total Voucher = Total This Accomplishment − Less
        </p>
      </div>
    </div>
  );
}
