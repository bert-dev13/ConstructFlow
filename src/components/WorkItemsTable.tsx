import { useId, useMemo, useState } from 'react';
import { boqCatalogSize, lookupWorkItemByItemNo, searchBoqItemNumbers, workItemPatchFromBoq } from '../lib/boqLookup';
import {
  computeWorkItems,
  formatMoney,
  formatPct,
  newWorkItem,
  type WorkItem,
} from '../lib/workItems';

interface WorkItemsTableProps {
  items: WorkItem[];
  lessReason: string;
  lessAmount: number;
  showRevised: boolean;
  onShowRevisedChange?: (value: boolean) => void;
  onLessReasonChange?: (value: string) => void;
  onLessAmountChange?: (value: number) => void;
  onChange: (items: WorkItem[]) => void;
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
  readOnly,
}: WorkItemsTableProps) {
  const itemNoListId = useId();
  const [itemNoQuery, setItemNoQuery] = useState('');
  const { items: computed, totals } = computeWorkItems(items, lessAmount, showRevised);
  const itemNoSuggestions = useMemo(
    () => searchBoqItemNumbers(itemNoQuery),
    [itemNoQuery],
  );

  const update = (id: string, patch: Partial<WorkItem>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const applyItemNoLookup = (id: string, itemNo: string) => {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const patch = workItemPatchFromBoq(itemNo, current);
    if (patch) {
      update(id, patch);
      return;
    }
    if (itemNo !== current.itemNo) {
      update(id, { itemNo });
    }
  };

  const handleItemNoChange = (id: string, itemNo: string) => {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const hit = lookupWorkItemByItemNo(itemNo);
    if (hit && hit.itemNo.trim() === itemNo.trim()) {
      const patch = workItemPatchFromBoq(itemNo, current);
      if (patch) {
        update(id, patch);
        return;
      }
    }
    update(id, { itemNo });
  };

  const addRow = () => onChange([...items, newWorkItem()]);
  const removeRow = (id: string) => onChange(items.filter((i) => i.id !== id));

  const leadingColSpan = 5; // item, desc, prog qty, unit price, unit

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
            <tr key={row.id} className="border-b border-border/50">
              <td className="p-1">
                {readOnly ? (
                  row.itemNo
                ) : (
                  <>
                    <input
                      className="w-full rounded border border-border px-1 py-0.5"
                      list={itemNoListId}
                      value={row.itemNo}
                      onFocus={() => setItemNoQuery(row.itemNo)}
                      onChange={(e) => {
                        setItemNoQuery(e.target.value);
                        handleItemNoChange(row.id, e.target.value);
                      }}
                      onBlur={(e) => applyItemNoLookup(row.id, e.target.value)}
                      placeholder="e.g. B.7 (1)"
                      title="Type item number — description fills from DPWH catalog"
                    />
                    {itemNoSuggestions.length > 0 && (
                      <datalist id={itemNoListId}>
                        {itemNoSuggestions.map((n) => (
                          <option key={n} value={n} />
                        ))}
                      </datalist>
                    )}
                  </>
                )}
              </td>
              <td className="p-1">
                {readOnly ? (
                  row.description
                ) : (
                  <input
                    className="w-full rounded border border-border px-1 py-0.5"
                    value={row.description}
                    onChange={(e) => update(row.id, { description: e.target.value })}
                  />
                )}
              </td>
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
                {readOnly ? (
                  row.unit
                ) : (
                  <input
                    className="w-full rounded border border-border px-1 py-0.5"
                    value={row.unit}
                    onChange={(e) => update(row.id, { unit: e.target.value })}
                  />
                )}
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
                  row.previous
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border border-border px-1 py-0.5 text-right"
                    value={row.previous || ''}
                    onChange={(e) =>
                      update(row.id, { previous: parseFloat(e.target.value) || 0 })
                    }
                  />
                )}
              </td>
              <td className="p-1">
                {readOnly ? (
                  row.thisPeriod
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border border-border px-1 py-0.5 text-right"
                    value={row.thisPeriod || ''}
                    onChange={(e) =>
                      update(row.id, { thisPeriod: parseFloat(e.target.value) || 0 })
                    }
                  />
                )}
              </td>
              <td className="p-1 text-right">{row.toDate}</td>
              <td className="p-1 text-right">{formatPct(row.accomplishmentWeightPct)}</td>
              <td className="p-1 text-left">{row.status}</td>
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
            Enter an <strong>Item No.</strong> (e.g. <code className="text-[11px]">B.7 (1)</code>,{' '}
            <code className="text-[11px]">311 (1) c1</code>) — description and unit auto-fill from the
            DPWH pay-item catalog ({boqCatalogSize().toLocaleString()} items).
            {showRevised && (
              <>
                {' '}
                When a revised quantity is entered, accomplishment weight uses the revised baseline.
              </>
            )}
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
