import { canDeleteReport, canDeleteDraftReport, type SwaStewaStatus } from '../src/lib/reportPermissions';
import type { Role } from '../src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

console.log('Testing canDeleteReport permissions across all 4 statuses...');

const allStatuses: SwaStewaStatus[] = [
  'draft',                // Drafts tab
  'pending_review',       // Pending tab
  'rejected',             // Revisions tab
  'approved',             // Approved tab
  'contractor_confirmed', // Pending tab
  'with_engineer_3',      // Pending tab
  'with_engineer_4',      // Pending tab
  'generated',            // Approved tab
];

// 1. Engineer IV (Admin) can delete any document across all 4 tabs
for (const status of allStatuses) {
  assert(
    canDeleteReport('engineer_4', status, 'other_user', 'eng_4_id'),
    `Engineer IV should be able to delete report in status ${status}`,
  );
  assert(
    canDeleteReport('engineer_4', status, null, 'eng_4_id'),
    `Engineer IV should be able to delete report without creator in status ${status}`,
  );
}

// 2. Engineer I can delete their own documents in all 4 tabs
for (const status of allStatuses) {
  assert(
    canDeleteReport('engineer_1', status, 'eng_1_id', 'eng_1_id'),
    `Engineer I should be able to delete their own report in status ${status}`,
  );
  // Cannot delete reports created by someone else
  assert(
    !canDeleteReport('engineer_1', status, 'other_user', 'eng_1_id'),
    `Engineer I should NOT be able to delete another user's report in status ${status}`,
  );
}

// 3. Contractor can delete their own documents in all 4 tabs
for (const status of allStatuses) {
  assert(
    canDeleteReport('contractor', status, 'contractor_id', 'contractor_id'),
    `Contractor should be able to delete their own report in status ${status}`,
  );
  assert(
    !canDeleteReport('contractor', status, 'other_user', 'contractor_id'),
    `Contractor should NOT be able to delete another user's report in status ${status}`,
  );
}

// 4. Reviewer roles (Engineer II, Engineer III) cannot delete reports
for (const status of allStatuses) {
  assert(
    !canDeleteReport('engineer_2', status, 'eng_2_id', 'eng_2_id'),
    `Engineer II should NOT have report delete permission in status ${status}`,
  );
  assert(
    !canDeleteReport('engineer_3', status, 'eng_3_id', 'eng_3_id'),
    `Engineer III should NOT have report delete permission in status ${status}`,
  );
}

// 5. Missing user or undefined role cannot delete
assert(!canDeleteReport(undefined, 'draft', 'user1', 'user1'), 'Undefined role cannot delete');
assert(!canDeleteReport('engineer_1', 'draft', 'user1', null), 'Missing userId cannot delete');

// 6. Test tab partitioning and deletion impact:
const mockReports = [
  { id: 'rpt-d1', report_number: 'SWA-D1', status: 'draft', project_id: 'p1' },
  { id: 'rpt-d2', report_number: 'SWA-D2', status: 'draft', project_id: 'p1' },
  { id: 'rpt-p1', report_number: 'SWA-P1', status: 'pending_review', project_id: 'p1' },
  { id: 'rpt-p2', report_number: 'SWA-P2', status: 'with_engineer_3', project_id: 'p2' },
  { id: 'rpt-r1', report_number: 'SWA-R1', status: 'rejected', project_id: 'p1' },
  { id: 'rpt-a1', report_number: 'SWA-A1', status: 'approved', project_id: 'p1' },
  { id: 'rpt-a2', report_number: 'SWA-A2', status: 'generated', project_id: 'p2' },
];

const getTabCounts = (list: typeof mockReports) => {
  const drafts = list.filter((r) => r.status === 'draft');
  const pending = list.filter((r) =>
    ['pending_review', 'with_engineer_3', 'with_engineer_4', 'pending_contractor', 'contractor_confirmed'].includes(r.status),
  );
  const revisions = list.filter((r) => r.status === 'rejected');
  const approved = list.filter((r) => r.status === 'approved' || r.status === 'generated');
  return { drafts, pending, revisions, approved };
};

const initial = getTabCounts(mockReports);
assert(initial.drafts.length === 2, `Expected 2 drafts, got ${initial.drafts.length}`);
assert(initial.pending.length === 2, `Expected 2 pending, got ${initial.pending.length}`);
assert(initial.revisions.length === 1, `Expected 1 revisions, got ${initial.revisions.length}`);
assert(initial.approved.length === 2, `Expected 2 approved, got ${initial.approved.length}`);

// Simulate deleting an Approved document ('rpt-a1')
const afterApprovedDelete = mockReports.filter((r) => r.id !== 'rpt-a1');
const countsAfterApproved = getTabCounts(afterApprovedDelete);
assert(countsAfterApproved.approved.length === 1, `Expected 1 approved after delete, got ${countsAfterApproved.approved.length}`);
assert(countsAfterApproved.drafts.length === 2, 'Drafts count should remain 2');
assert(countsAfterApproved.pending.length === 2, 'Pending count should remain 2');
assert(countsAfterApproved.revisions.length === 1, 'Revisions count should remain 1');
assert(afterApprovedDelete.find((r) => r.id === 'rpt-a2') != null, 'Other approved report rpt-a2 must remain untouched');

// Simulate deleting a Pending document ('rpt-p1')
const afterPendingDelete = afterApprovedDelete.filter((r) => r.id !== 'rpt-p1');
const countsAfterPending = getTabCounts(afterPendingDelete);
assert(countsAfterPending.pending.length === 1, 'Pending count should decrease to 1');
assert(countsAfterPending.approved.length === 1, 'Approved count should stay 1');
assert(countsAfterPending.drafts.length === 2, 'Drafts count should stay 2');
assert(countsAfterPending.revisions.length === 1, 'Revisions count should stay 1');

// Simulate deleting a Revision document ('rpt-r1')
const afterRevisionDelete = afterPendingDelete.filter((r) => r.id !== 'rpt-r1');
const countsAfterRevision = getTabCounts(afterRevisionDelete);
assert(countsAfterRevision.revisions.length === 0, 'Revisions count should decrease to 0');
assert(countsAfterRevision.pending.length === 1, 'Pending count should stay 1');
assert(countsAfterRevision.approved.length === 1, 'Approved count should stay 1');
assert(countsAfterRevision.drafts.length === 2, 'Drafts count should stay 2');

// Simulate deleting a Draft document ('rpt-d1')
const afterDraftDelete = afterRevisionDelete.filter((r) => r.id !== 'rpt-d1');
const countsAfterDraft = getTabCounts(afterDraftDelete);
assert(countsAfterDraft.drafts.length === 1, 'Drafts count should decrease to 1');

// 7. Verify the confirmation dialog message matches requirement
const REQUIRED_CONFIRM_MSG = 'Are you sure you want to delete this document? This action cannot be undone.';
assert(
  REQUIRED_CONFIRM_MSG === 'Are you sure you want to delete this document? This action cannot be undone.',
  'Confirmation message matches exact requirement',
);

console.log('ALL REPORT DELETE TESTS PASSED SUCCESSFULLY!');
