import { RoleGuard } from '../../../src/components/RoleGuard';
import { ProjectsPage } from '../../../src/legacy-pages/ProjectsPage';

export default function Page() { return <RoleGuard roles={['engineer_1']}><ProjectsPage /></RoleGuard>; }
