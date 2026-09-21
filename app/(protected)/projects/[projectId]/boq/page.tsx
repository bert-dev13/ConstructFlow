import { RoleGuard } from '../../../../../src/components/RoleGuard';
import { ProjectBoqPage } from '../../../../../src/legacy-pages/ProjectBoqPage';
import { projectIdParams as generateStaticParams } from '../../../../../src/routeParams';

export { generateStaticParams };

export default function Page() {
  return (
    <RoleGuard roles={['engineer_1']}>
      <ProjectBoqPage />
    </RoleGuard>
  );
}
