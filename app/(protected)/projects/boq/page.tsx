import { RoleGuard } from '../../../../src/components/RoleGuard';
import { ProjectBoqPage } from '../../../../src/legacy-pages/ProjectBoqPage';

/** Static route — project id comes from ?projectId= (works with output:export + any Firestore id). */
export default function Page() {
  return (
    <RoleGuard roles={['engineer_1']}>
      <ProjectBoqPage />
    </RoleGuard>
  );
}
