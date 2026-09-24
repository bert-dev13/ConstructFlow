import {
  listProjectBoq as listProjectBoqFs,
  saveProjectBoqItem as saveProjectBoqItemFs,
  setProjectBoqActive as setProjectBoqActiveFs,
  projectBoqAmount,
  type ProjectBoqItem,
  type ProjectBoqInput,
} from './firebase/projectBoq';

export type { ProjectBoqItem, ProjectBoqInput };
export { projectBoqAmount };

export function listProjectBoq(projectId: string) {
  return listProjectBoqFs(projectId);
}

export function saveProjectBoqItem(
  projectId: string,
  input: ProjectBoqInput,
  id?: string,
) {
  return saveProjectBoqItemFs(projectId, input, id);
}

export function setProjectBoqActive(projectId: string, id: string, active: boolean) {
  return setProjectBoqActiveFs(projectId, id, active);
}
