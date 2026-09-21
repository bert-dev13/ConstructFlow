import {
  listProjectBoq as listProjectBoqFs,
  saveProjectBoqItem as saveProjectBoqItemFs,
  setProjectBoqActive as setProjectBoqActiveFs,
  type ProjectBoqItem,
} from './firebase/projectBoq';

export type { ProjectBoqItem };

export function listProjectBoq(projectId: string) {
  return listProjectBoqFs(projectId);
}

export function saveProjectBoqItem(
  projectId: string,
  input: Omit<ProjectBoqItem, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>,
  id?: string,
) {
  return saveProjectBoqItemFs(projectId, input, id);
}

export function setProjectBoqActive(projectId: string, id: string, active: boolean) {
  return setProjectBoqActiveFs(projectId, id, active);
}
