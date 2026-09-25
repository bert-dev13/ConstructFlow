import { RoleGuard } from '../../../src/components/RoleGuard';
import { PdmPage } from '../../../src/legacy-pages/PdmPage';
import { chartViewRoles } from '../../../src/lib/chartPermissions';

export default function Page() {
  return (
    <RoleGuard roles={chartViewRoles()}>
      <PdmPage />
    </RoleGuard>
  );
}
