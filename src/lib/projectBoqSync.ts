import type { PdmActivity } from '../types';
import { lookupWorkItemByItemNo } from './boqLookup';
import type { ProjectBoqItem } from './projectBoqApi';
import { listScheduleActivities } from './scheduleApi';
import { listProjectBoq } from './projectBoqApi';

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

function itemNoKey(value: string) {
  return value.trim().toLowerCase();
}

/** Unit from the DPWH list when the schedule row itself has none. */
function catalogUnit(itemNo: string, name: string): string {
  const hit = lookupWorkItemByItemNo(itemNo) || lookupWorkItemByItemNo(name);
  const unit = (hit?.unit || '').trim();
  if (!unit || unit === '—' || unit === '-') return '';
  return unit;
}

/**
 * Item Nos. Engineer I picks on SWA/IAR.
 * Project BOQ rows stay first. Schedule activity numbers (the PDM item key)
 * are added when that key is not already on the BOQ — including keys that
 * were typed on Prepare Schedule without a Pay Item Master link.
 */
export function withScheduleItemKeys(
  projectId: string,
  boqItems: ProjectBoqItem[],
  activities: PdmActivity[],
): ProjectBoqItem[] {
  const coveredIds = new Set(boqItems.map((row) => row.payItemId).filter(Boolean));
  const coveredNos = new Set(boqItems.map((row) => itemNoKey(row.itemNo)).filter(Boolean));
  const extras: ProjectBoqItem[] = [];

  for (const activity of activities) {
    const itemNo = String(activity.number ?? '').trim();
    if (!itemNo) continue;
    const payItemId = activity.payItemId ? String(activity.payItemId) : '';
    const noKey = itemNoKey(itemNo);
    if ((payItemId && coveredIds.has(payItemId)) || coveredNos.has(noKey)) continue;
    if (payItemId) coveredIds.add(payItemId);
    coveredNos.add(noKey);
    extras.push({
      id: `schedule-${activity.id}`,
      projectId,
      payItemId,
      payItemVersion: activity.payItemVersion ?? 1,
      itemNo,
      description: activity.name || lookupWorkItemByItemNo(itemNo)?.description || '',
      unit: activity.unit || catalogUnit(itemNo, activity.name || ''),
      programmedQty: 0,
      revisedQty: null,
      unitPrice: 0,
      weightPct: null,
      active: true,
      createdAt: '',
      updatedAt: '',
    });
  }

  return [...boqItems, ...extras];
}

/** BOQ snapshots plus the current schedule's item keys. */
export async function listProjectItemOptions(projectId: string): Promise<ProjectBoqItem[]> {
  const id = String(projectId || '').trim();
  const [boq, activities] = await Promise.all([
    listProjectBoq(id),
    listScheduleActivities(id).catch(() => [] as PdmActivity[]),
  ]);
  return withScheduleItemKeys(id, boq, activities);
}

/** Persist a master Pay Item id only. Schedule-only keys keep itemNo and leave payItemId empty. */
export function linkedPayItemId(
  selectedId: string,
  boqItem: { payItemId?: string } | undefined,
): string {
  const fromBoq = boqItem?.payItemId?.trim() || '';
  if (fromBoq) return fromBoq;
  if (selectedId.startsWith('schedule-') || selectedId.startsWith('catalog:')) return '';
  return selectedId;
}
