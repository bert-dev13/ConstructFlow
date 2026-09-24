import type { PdmActivity } from '../types';
import type { ProjectBoqItem } from './projectBoqApi';

/**
 * Merge project BOQ pay items into PDM activities.
 * - Matching payItemId / itemNo → refresh Item No., Description, Unit from BOQ snapshots
 * - New BOQ rows → append activities (duration default 3)
 * Does not invent master pay items; does not write to Pay Item Master.
 */
export function mergeBoqIntoActivities(
  activities: PdmActivity[],
  boqItems: ProjectBoqItem[],
): { activities: PdmActivity[]; added: number; updated: number } {
  const active = boqItems.filter((row) => row.active && row.payItemId && row.itemNo);
  let added = 0;
  let updated = 0;
  const next = [...activities];

  for (const row of active) {
    const existingIndex = next.findIndex(
      (a) =>
        (a.payItemId && a.payItemId === row.payItemId) ||
        a.number.trim().toLowerCase() === row.itemNo.trim().toLowerCase(),
    );
    if (existingIndex >= 0) {
      const current = next[existingIndex]!;
      next[existingIndex] = {
        ...current,
        payItemId: row.payItemId,
        payItemVersion: row.payItemVersion,
        number: row.itemNo,
        name: row.description,
        unit: row.unit,
      };
      updated += 1;
    } else {
      next.push({
        id: `boq-${row.id}-${Date.now()}-${added}`,
        number: row.itemNo,
        name: row.description,
        unit: row.unit,
        payItemId: row.payItemId,
        payItemVersion: row.payItemVersion,
        duration: 3,
      });
      added += 1;
    }
  }

  return { activities: next, added, updated };
}
