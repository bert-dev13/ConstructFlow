/**
 * Precedence diagram — Construction of Box Culvert along Cato-Conner Road, Tuao.
 *
 * Revision (user markup): B→E marked MALI (wrong). E waits on C and D (FS), not B.
 */
import type { PdmActivity, PdmDependency } from '../types';

export const REFERENCE_PDM_TITLE =
  'CONSTRUCTION OF BOX CULVERT ALONG CATO-CONNER ROAD, TUAO';

const ACTS: { key: string; number: string; name: string; duration: number; esOverride?: number }[] = [
  { key: 'a', number: 'A', name: 'Mobilization', duration: 5, esOverride: 0 },
  { key: 'b', number: 'B', name: 'Box Culvert Construction', duration: 23 },
  { key: 'c', number: 'C', name: 'Retaining Wall Construction', duration: 10 },
  { key: 'd', number: 'D', name: 'RCPC Installation', duration: 9 },
  { key: 'e', number: 'E', name: 'Sub-grade Preparation', duration: 28 },
  { key: 'f', number: 'F', name: 'Embankment', duration: 27 },
  { key: 'g', number: 'G', name: 'Aggregate Base Course', duration: 22 },
  { key: 'h', number: 'H', name: 'PCCP', duration: 70 },
  { key: 'i', number: 'I', name: 'Demobilization', duration: 5 },
];

/** FS links after revision: A→B/C/D, C→E, D→E (no B→E), then E→F→G→H→I. */
const DEPS: { from: string; to: string }[] = [
  { from: 'a', to: 'b' },
  { from: 'a', to: 'c' },
  { from: 'a', to: 'd' },
  { from: 'c', to: 'e' },
  { from: 'd', to: 'e' },
  { from: 'e', to: 'f' },
  { from: 'f', to: 'g' },
  { from: 'g', to: 'h' },
  { from: 'h', to: 'i' },
];

export const HAS_REFERENCE_PDM = ACTS.length > 0;

export function buildRoadPdmSample(): { activities: PdmActivity[]; dependencies: PdmDependency[] } {
  const activities: PdmActivity[] = ACTS.map((a) => ({
    id: `sample-${a.key}`,
    number: a.number,
    name: a.name,
    duration: a.duration,
    esOverride: a.esOverride ?? null,
  }));
  const dependencies: PdmDependency[] = DEPS.map((d, i) => ({
    id: `sample-d-${i}`,
    fromId: `sample-${d.from}`,
    toId: `sample-${d.to}`,
    type: 'FS',
    lag: 0,
  }));
  return { activities, dependencies };
}
