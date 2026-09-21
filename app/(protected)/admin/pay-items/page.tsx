import { RoleGuard } from '../../../../src/components/RoleGuard';
import { PayItemMasterPage } from '../../../../src/legacy-pages/PayItemMasterPage';

export default function Page() {
  return (
    <RoleGuard roles={['engineer_1']}>
      <PayItemMasterPage />
    </RoleGuard>
  );
}
