'use client';

import { newIarItem, type IarAccomplishmentItem } from '../lib/iarItems';
import { fieldInputClass } from './ui/FormField';
import { PayItemSelect } from './PayItemSelect';
import { isPlaceholderUnit, resolveItemUnit } from '../lib/boqLookup';
import { linkedPayItemId } from '../lib/projectBoqSync';
import type { PayItem } from '../lib/payItemsApi';

interface Props {
  items: IarAccomplishmentItem[];
  onChange: (items: IarAccomplishmentItem[]) => void;
  readOnly?: boolean;
  projectBoqItems?: import('../lib/projectBoqApi').ProjectBoqItem[];
  onRefreshProjectBoq?: () => void | Promise<void>;
}

export function IarAccomplishmentTable({
  items,
  onChange,
  readOnly,
  projectBoqItems,
  onRefreshProjectBoq,
}: Props) {
  const inputCls = `${fieldInputClass()} !mt-0 !py-2 text-xs`;

  const update = (id: string, patch: Partial<IarAccomplishmentItem>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

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
      });
      return;
    }
    const boqItem = (projectBoqItems ?? []).find(
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
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface/50">
      <div className="overflow-x-auto">
        <table className="data-table w-full min-w-[800px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/80">
              <th className="px-3 py-3 text-left" rowSpan={2}>
                Item No.
              </th>
              <th className="px-3 py-3 text-left" rowSpan={2}>
                Description
              </th>
              <th className="px-3 py-3 text-left" rowSpan={2}>
                Location / Station
              </th>
              <th className="px-3 py-2 text-center" colSpan={2}>
                Quantity for the week
              </th>
              <th className="px-3 py-3 text-left" rowSpan={2}>
                Unit
              </th>
              {!readOnly && <th className="w-10 px-2 py-3" rowSpan={2} />}
            </tr>
            <tr className="border-b border-border bg-surface-muted/60">
              <th className="px-3 py-2 text-right">Physical</th>
              <th className="px-3 py-2 text-right">Billable</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr
                key={item.id}
                className={`border-b border-border/40 transition hover:bg-white/60 ${idx % 2 === 1 ? 'bg-white/40' : ''}`}
              >
                <td className="px-2 py-2">
                  {readOnly ? (
                    item.snapshotItemNo || item.itemNo
                  ) : (
                    <PayItemSelect
                      value={item.payItemId ?? ''}
                      onChange={(selected) => selectPayItem(item.id, selected)}
                      fallbackLabel={item.itemNo || undefined}
                      projectBoqItems={projectBoqItems}
                      onRefreshProjectBoq={onRefreshProjectBoq}
                    />
                  )}
                </td>
                <td className="px-2 py-2">
                  <span className="block min-w-[180px] text-xs text-text">
                    {item.snapshotDescription || item.description || 'Select a Pay Item'}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    value={item.location}
                    onChange={(e) => update(item.id, { location: e.target.value })}
                    className={`${inputCls} w-24`}
                    placeholder="PCCP"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    type="number"
                    value={item.physicalQty}
                    onChange={(e) =>
                      update(item.id, {
                        physicalQty: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className={`${inputCls} w-20 text-right`}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    type="number"
                    value={item.billableQty}
                    onChange={(e) =>
                      update(item.id, {
                        billableQty: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className={`${inputCls} w-20 text-right`}
                  />
                </td>
                <td className="px-2 py-2">
                  <span className="text-xs text-text">
                    {resolveItemUnit(
                      item.snapshotItemNo || item.itemNo,
                      item.snapshotDescription || item.description,
                      item.snapshotUnit || item.unit,
                    ).unit || item.snapshotUnit || item.unit || '—'}
                  </span>
                </td>
                {!readOnly && (
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                      className="rounded-lg p-1.5 text-text-muted transition hover:bg-red-50 hover:text-red-600"
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="border-t border-border bg-surface-muted/40 px-4 py-3">
          <button
            type="button"
            onClick={() => onChange([...items, newIarItem()])}
            className="rounded-lg border border-dashed border-primary/40 bg-primary-light/50 px-4 py-2 text-xs font-semibold text-primary transition hover:border-primary hover:bg-primary-light"
          >
            + Add accomplishment row
          </button>
          <p className="mt-2 text-[11px] text-text-muted">
            Type an Item No. such as A.1 or B.1 and choose a match.
            Description and unit fill in from the DPWH standard pay item list.
          </p>
        </div>
      )}
    </div>
  );
}
