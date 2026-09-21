import {
  createPayItem as createPayItemFs,
  listPayItems as listPayItemsFs,
  setPayItemActive as setPayItemActiveFs,
  updatePayItem as updatePayItemFs,
  type PayItem,
  type PayItemInput,
} from './firebase/payItems';

export type { PayItem, PayItemInput };

export function listPayItems(includeInactive = true) {
  return listPayItemsFs(includeInactive);
}

export function createPayItem(input: PayItemInput, actorId: string) {
  return createPayItemFs(input, actorId);
}

export function updatePayItem(id: string, input: PayItemInput, actorId: string) {
  return updatePayItemFs(id, input, actorId);
}

export function setPayItemActive(id: string, active: boolean) {
  return setPayItemActiveFs(id, active);
}
