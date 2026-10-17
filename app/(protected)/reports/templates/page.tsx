import { RoleGuard } from '../../../../src/components/RoleGuard';
import { TemplateManagePage } from '../../../../src/legacy-pages/TemplateManagePage';

export default function Page() { return <RoleGuard roles={['engineer_4']}><TemplateManagePage /></RoleGuard>; }
