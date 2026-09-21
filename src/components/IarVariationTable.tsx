'use client';

import { newVariationItem, type IarVariationItem } from '../lib/iarItems';
import { fieldInputClass } from './ui/FormField';
import { PayItemSelect } from './PayItemSelect';
import type { PayItem } from '../lib/payItemsApi';

interface Props {
  items: IarVariationItem[];
  onChange: (items: IarVariationItem[]) => void;
  readOnly?: boolean;
}

export function IarVariationTable({ items, onChange, readOnly }: Props) {
  const inputCls = `${fieldInputClass()} !mt-0 !py-2 text-xs`;

  const update = (id: string, patch: Partial<IarVariationItem>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const selectPayItem = (id: string, item: PayItem | null) => {
    if (!item) return;
    update(id, {
      payItemId: item.id,
      payItemVersion: item.version,
      snapshotItemNo: item.itemNo,
      snapshotDescription: item.description,
      snapshotUnit: item.unit,
      itemNo: item.itemNo,
      description: item.description,
      unit: item.unit,
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface/50">
      <div className="overflow-x-auto">
        <table className="data-table w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/80">
              <th className="px-3 py-3 text-left">Item No.</th>
              <th className="px-3 py-3 text-left">Description</th>
              <th className="px-3 py-3 text-right">Quantity</th>
              <th className="px-3 py-3 text-left">Unit</th>
              <th className="px-3 py-3 text-left">Additive</th>
              <th className="px-3 py-3 text-left">Deductive</th>
              <th className="px-3 py-3 text-left">New Item</th>
              {!readOnly && <th className="w-10 px-2 py-3" />}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr
                key={item.id}
                className={`border-b border-border/40 transition hover:bg-white/60 ${idx % 2 === 1 ? 'bg-white/40' : ''}`}
              >
                <td className="px-2 py-2">
                  {readOnly ? item.snapshotItemNo || item.itemNo : <PayItemSelect value={item.payItemId ?? ''} onChange={(selected) => selectPayItem(item.id, selected)} fallbackLabel={item.itemNo || undefined} />}
                </td>
                <td className="px-2 py-2">
                  <span className="block min-w-[160px] text-xs text-text">{item.snapshotDescription || item.description || 'Select a Pay Item'}</span>
                </td>
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    type="number"
                    value={item.quantity}
                    onChange={(e) =>
                      update(item.id, {
                        quantity: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className={`${inputCls} w-20 text-right`}
                  />
                </td>
                <td className="px-2 py-2">
                  <span className="text-xs text-text">{item.snapshotUnit || item.unit || '—'}</span>
                </td>
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    value={item.additive}
                    onChange={(e) => update(item.id, { additive: e.target.value })}
                    className={`${inputCls} w-24`}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    value={item.deductive}
                    onChange={(e) => update(item.id, { deductive: e.target.value })}
                    className={`${inputCls} w-24`}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    value={item.newItem}
                    onChange={(e) => update(item.id, { newItem: e.target.value })}
                    className={`${inputCls} w-24`}
                  />
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
            onClick={() => onChange([...items, newVariationItem()])}
            className="rounded-lg border border-dashed border-primary/40 bg-primary-light/50 px-4 py-2 text-xs font-semibold text-primary transition hover:border-primary hover:bg-primary-light"
          >
            + Add variation order row
          </button>
        </div>
      )}
    </div>
  );
}
