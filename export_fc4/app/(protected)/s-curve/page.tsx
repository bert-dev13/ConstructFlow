import { RoleGuard } from '../../../src/components/RoleGuard';
import { SCurvePage } from '../../../src/legacy-pages/SCurvePage';
import { chartViewRoles } from '../../../src/lib/chartPermissions';

export default function Page() {
  return (
    <RoleGuard roles={chartViewRoles()}>
      <SCurvePage />
    </RoleGuard>
  );
}
