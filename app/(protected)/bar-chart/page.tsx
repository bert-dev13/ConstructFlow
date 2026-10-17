import { RoleGuard } from '../../../src/components/RoleGuard';
import { BarChartPage } from '../../../src/legacy-pages/BarChartPage';
import { chartViewRoles } from '../../../src/lib/chartPermissions';

export default function Page() {
  return (
    <RoleGuard roles={chartViewRoles()}>
      <BarChartPage />
    </RoleGuard>
  );
}
