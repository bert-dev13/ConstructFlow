'use client';

import { newManpowerRow, type IarManpowerRow } from '../lib/iarItems';
import { fieldInputClass } from './ui/FormField';

interface Props {
  title: string;
  items: IarManpowerRow[];
  onChange: (items: IarManpowerRow[]) => void;
  readOnly?: boolean;
}

export function IarResourceTable({ title, items, onChange, readOnly }: Props) {
  const inputCls = `${fieldInputClass()} !mt-0 !py-2 text-xs`;

  const update = (id: string, patch: Partial<IarManpowerRow>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-text">{title}</p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface/50">
        <table className="data-table w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/80">
              <th className="px-3 py-2 text-left">Description</th>
              <th className="w-28 px-3 py-2 text-right">Qty</th>
              {!readOnly && <th className="w-10 px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/40">
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    value={item.description}
                    onChange={(e) => update(item.id, { description: e.target.value })}
                    className={`${inputCls} w-full`}
                    placeholder="Resource name"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    disabled={readOnly}
                    type="number"
                    min={0}
                    value={item.quantity}
                    onChange={(e) =>
                      update(item.id, {
                        quantity: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className={`${inputCls} w-full text-right`}
                  />
                </td>
                {!readOnly && (
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => onChange(items.filter((x) => x.id !== item.id))}
                      className="text-xs text-red-600"
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => onChange([...items, newManpowerRow()])}
              className="text-xs font-semibold text-primary"
            >
              + Add row
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
