import { RoleGuard } from '../../../../src/components/RoleGuard';
import { SwaStewaTemplatePage } from '../../../../src/legacy-pages/SwaStewaTemplatePage';

export default function Page() { return <RoleGuard roles={['engineer_4']}><SwaStewaTemplatePage /></RoleGuard>; }
