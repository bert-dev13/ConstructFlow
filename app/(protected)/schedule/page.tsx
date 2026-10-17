import { RoleGuard } from '../../../src/components/RoleGuard';
import { ScheduleEditorPage } from '../../../src/legacy-pages/ScheduleEditorPage';

export default function Page() { return <RoleGuard roles={['contractor']}><ScheduleEditorPage /></RoleGuard>; }
