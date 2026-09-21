'use client';

import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { NavIcon } from './NavIcon';

const REVIEWER_ROLES = new Set(['engineer_2', 'engineer_3', 'engineer_4']);

/** Back to Documents hub for Engineer II / III / IV. */
export function DocumentsBackLink() {
  const { user } = useAuth();
  if (!user || !REVIEWER_ROLES.has(user.role)) return null;

  return (
    <Link
      to="/reports"
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted transition hover:text-primary"
    >
      <NavIcon name="arrow-left" className="h-3.5 w-3.5" />
      Documents
    </Link>
  );
}
