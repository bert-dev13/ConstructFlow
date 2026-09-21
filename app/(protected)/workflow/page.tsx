import { RoleGuard } from '../../../src/components/RoleGuard';
import { WorkflowPage } from '../../../src/legacy-pages/WorkflowPage';

export default function Page() { return <RoleGuard roles={['engineer_1', 'engineer_2', 'engineer_3', 'engineer_4']}><WorkflowPage /></RoleGuard>; }
