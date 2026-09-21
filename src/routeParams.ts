import type { Role } from './types';

const roles: Role[] = ['engineer_1', 'engineer_2', 'engineer_3', 'engineer_4', 'contractor'];

export function roleParams() {
  return roles.map((role) => ({ role }));
}

export function reportNumberParams() {
  return [{ reportNumber: '_' }];
}

export function reportTypeParams() {
  return [{ type: 'SWA' }, { type: 'STEWA' }, { type: 'IAR' }];
}

export function reportIdParams() {
  return [{ id: '_' }];
}

export function projectIdParams() {
  return [{ projectId: 'demo-capitol-annex' }, { projectId: 'demo-remebella-road' }];
}
