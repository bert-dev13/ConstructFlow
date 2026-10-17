import { applyPdmDerivatives } from '../src/lib/scheduleSync';
import { omitUndefinedDeep } from '../src/lib/firebase/ids';
import type { BarChartTask, PdmActivity, PdmDependency } from '../src/types';
import { writeFileSync } from 'fs';

function findUndefined(value: unknown, path = ''): string[] {
  if (value === undefined) return [path || '(root)'];
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findUndefined(item, `${path}[${i}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    findUndefined(v, path ? `${path}.${k}` : k),
  );
}

function sanitizeActivityForFs(a: PdmActivity): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: String(a.id ?? ''),
    number: String(a.number ?? ''),
    name: String(a.name ?? ''),
    duration: Number.isFinite(Number(a.duration)) ? Number(a.duration) : 0,
  };
  if (a.payItemId) out.payItemId = String(a.payItemId);
  if (a.payItemVersion != null && Number.isFinite(Number(a.payItemVersion))) {
    out.payItemVersion = Number(a.payItemVersion);
  }
  if (a.unit != null && a.unit !== '') out.unit = String(a.unit);
  if (a.esOverride != null && Number.isFinite(Number(a.esOverride))) {
    out.esOverride = Number(a.esOverride);
  }
  if (a.extendToEnd === true) out.extendToEnd = true;
  if (a.extendToEnd === false) out.extendToEnd = false;
  if (a.es != null && Number.isFinite(Number(a.es))) out.es = Number(a.es);
  if (a.ef != null && Number.isFinite(Number(a.ef))) out.ef = Number(a.ef);
  if (a.ls != null && Number.isFinite(Number(a.ls))) out.ls = Number(a.ls);
  if (a.lf != null && Number.isFinite(Number(a.lf))) out.lf = Number(a.lf);
  if (a.isCritical === true || a.isCritical === false) out.isCritical = a.isCritical;
  return out;
}

function sanitizeDependencyForFs(d: PdmDependency): Record<string, unknown> {
  return {
    id: String(d.id ?? ''),
    fromId: String(d.fromId ?? ''),
    toId: String(d.toId ?? ''),
    type: d.type ?? 'FS',
    lag: Number.isFinite(Number(d.lag)) ? Number(d.lag) : 0,
  };
}

function sanitizeBarTaskForFs(t: BarChartTask): Record<string, unknown> {
  return {
    id: String(t.id ?? ''),
    index: Number(t.index) || 0,
    name: String(t.name ?? ''),
    startDay: Number(t.startDay) || 0,
    endDay: Number(t.endDay) || 0,
    actualEndDay: t.actualEndDay != null ? Number(t.actualEndDay) : null,
    isCritical: !!t.isCritical,
  };
}

const derived = applyPdmDerivatives({
  project_id: 'Tg9Js8vQlI9nkaoKBIeI',
  activities: [
    {
      id: 'a1',
      number: '103',
      name: 'Earthworks',
      duration: 5,
      payItemId: 'pi-1',
      payItemVersion: 1,
      unit: 'cu.m.',
      esOverride: undefined,
      extendToEnd: undefined,
      posX: undefined,
    } as PdmActivity,
    { id: 'a2', number: 'B', name: 'Activity B', duration: 3 },
  ],
  dependencies: [{ id: 'd1', fromId: 'a1', toId: 'a2', type: 'FS' as const }],
  barChartTasks: [],
  barChartTotalDays: 1,
  barChartTimeNow: 0,
  projectDuration: 0,
  criticalPath: [],
});

const payload = omitUndefinedDeep({
  project_id: 'Tg9Js8vQlI9nkaoKBIeI',
  projectId: 'Tg9Js8vQlI9nkaoKBIeI',
  activities: derived.activities.map(sanitizeActivityForFs),
  dependencies: derived.dependencies.map(sanitizeDependencyForFs),
  barChartTasks: derived.barChartTasks.map(sanitizeBarTaskForFs),
  barChartTotalDays: derived.barChartTotalDays,
  barChartTimeNow: derived.barChartTimeNow,
  projectDuration: derived.projectDuration,
  criticalPath: derived.criticalPath,
  pdmError: derived.pdmError ?? null,
  updatedAt: new Date().toISOString(),
});

const hits = findUndefined(payload);
const out = [
  hits.length ? `HAS_UNDEFINED\n${hits.join('\n')}` : 'NO_UNDEFINED',
  'payItemId=' + String((payload.activities as { payItemId?: string }[])[0]?.payItemId),
  'actualEndDay=' + JSON.stringify((payload.barChartTasks as { actualEndDay?: unknown }[])[0]?.actualEndDay),
].join('\n');
writeFileSync('scripts/check-schedule-out.txt', out);
console.log(out);
