import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

type Role = 'contractor' | 'engineer_1' | 'engineer_2' | 'engineer_3' | 'engineer_4';

const PROJECT_ID = 'workflow-validation-project';
const REPORT_ID = 'workflow-validation-report';

const USERS = {
  contractor: { uid: 'wf-contractor', role: 'contractor' as Role, email: 'wf.contractor@example.com' },
  engineer1: { uid: 'wf-engineer-1', role: 'engineer_1' as Role, email: 'wf.engineer1@example.com' },
  engineer2: { uid: 'wf-engineer-2', role: 'engineer_2' as Role, email: 'wf.engineer2@example.com' },
  engineer3: { uid: 'wf-engineer-3', role: 'engineer_3' as Role, email: 'wf.engineer3@example.com' },
  engineer4: { uid: 'wf-engineer-4', role: 'engineer_4' as Role, email: 'wf.engineer4@example.com' },
};

function nowIso() {
  return new Date().toISOString();
}

function projectDoc(state: 'active' | 'pending_delete_approval' | 'archived') {
  return {
    name: 'Workflow Validation Project',
    location: 'Emulator',
    status: 'active',
    lifecycleState: state,
    contractorId: state === 'archived' ? null : USERS.contractor.uid,
    contractorName: 'Workflow Contractor',
    assignedUserIds: state === 'archived' ? [USERS.engineer1.uid] : [USERS.engineer1.uid, USERS.contractor.uid],
    involvedUserIds: state === 'archived' ? [] : [USERS.engineer2.uid],
    accessUserIds: state === 'archived' ? [USERS.engineer1.uid] : [USERS.engineer1.uid, USERS.contractor.uid, USERS.engineer2.uid],
    contractAmount: 123456,
    startDate: '2026-01-01',
    plannedEndDate: '2026-12-31',
    archiveOwnerId: state === 'archived' ? USERS.engineer1.uid : null,
    archiveOwnerRole: state === 'archived' ? 'engineer_1' : null,
    archivedAt: state === 'archived' ? nowIso() : null,
    purgeAfter: state === 'archived' ? new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString() : null,
    deletionApproval: null,
    updatedAt: nowIso(),
    createdAt: nowIso(),
  };
}

function reportDoc(status: string) {
  return {
    reportNumber: 'WF-IAR-001',
    projectId: PROJECT_ID,
    projectName: 'Workflow Validation Project',
    reportType: 'IAR',
    reportData: {
      report_date: '2026-09-22',
      project_name: 'Workflow Validation Project',
    },
    lineItems: [],
    accessUserIds: [USERS.engineer1.uid, USERS.contractor.uid, USERS.engineer2.uid],
    editUserIds: [USERS.engineer1.uid, USERS.contractor.uid],
    status,
    approvalFlow: {
      contractorConfirmation: null,
      engineer2: null,
      engineer3: null,
      engineer4: null,
      currentStage: status === 'draft' ? 'draft' : 'contractor_confirmation',
      correctionCycle: 0,
      lastCorrectionReason: null,
      lastCorrectionBy: null,
      lastCorrectionRole: null,
    },
    releaseState: null,
    createdBy: USERS.engineer1.uid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    publicUrl: 'http://localhost/workflow-report',
  };
}

async function seedBaseData(testEnv: RulesTestEnvironment) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const user of Object.values(USERS)) {
      await setDoc(doc(db, 'users', user.uid), {
        email: user.email,
        fullName: user.email,
        role: user.role,
        isActive: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }

    await setDoc(doc(db, 'projects', PROJECT_ID), projectDoc('active'));
    await setDoc(doc(db, 'reports', REPORT_ID), reportDoc('draft'));
  });
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'constructflow-workflow-validation',
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });

  try {
    await seedBaseData(testEnv);

    const engineer1 = testEnv.authenticatedContext(USERS.engineer1.uid).firestore();
    const engineer2 = testEnv.authenticatedContext(USERS.engineer2.uid).firestore();
    const engineer3 = testEnv.authenticatedContext(USERS.engineer3.uid).firestore();
    const engineer4 = testEnv.authenticatedContext(USERS.engineer4.uid).firestore();
    const contractor = testEnv.authenticatedContext(USERS.contractor.uid).firestore();

    const reportRefE1 = doc(engineer1, 'reports', REPORT_ID);
    const reportRefE2 = doc(engineer2, 'reports', REPORT_ID);
    const reportRefE3 = doc(engineer3, 'reports', REPORT_ID);
    const reportRefE4 = doc(engineer4, 'reports', REPORT_ID);
    const reportRefContractor = doc(contractor, 'reports', REPORT_ID);

    const projectRefE1 = doc(engineer1, 'projects', PROJECT_ID);
    const projectRefE2 = doc(engineer2, 'projects', PROJECT_ID);
    const projectRefE3 = doc(engineer3, 'projects', PROJECT_ID);
    const projectRefE4 = doc(engineer4, 'projects', PROJECT_ID);

    await assertFails(
      updateDoc(reportRefE2, {
        status: 'with_engineer_3',
        approvalFlow: {
          contractorConfirmation: null,
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: null,
          engineer4: null,
          currentStage: 'engineer_3',
          correctionCycle: 0,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE1, {
        status: 'pending_contractor',
        contractorChanges: [],
        approvalFlow: {
          contractorConfirmation: null,
          engineer2: null,
          engineer3: null,
          engineer4: null,
          currentStage: 'contractor_confirmation',
          correctionCycle: 0,
          lastCorrectionReason: null,
          lastCorrectionBy: null,
          lastCorrectionRole: null,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertFails(
      updateDoc(reportRefE2, {
        status: 'pending_review',
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefContractor, {
        status: 'contractor_confirmed',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: null,
          engineer3: null,
          engineer4: null,
          currentStage: 'engineer_2',
          correctionCycle: 0,
          lastCorrectionReason: null,
          lastCorrectionBy: null,
          lastCorrectionRole: null,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE1, {
        status: 'pending_review',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: null,
          engineer3: null,
          engineer4: null,
          currentStage: 'engineer_2',
          correctionCycle: 0,
          lastCorrectionReason: null,
          lastCorrectionBy: null,
          lastCorrectionRole: null,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertFails(
      updateDoc(reportRefE3, {
        status: 'with_engineer_4',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: null,
          engineer3: { approvedBy: USERS.engineer3.uid, approvedRole: 'engineer_3', approvedAt: nowIso() },
          engineer4: null,
          currentStage: 'engineer_4',
          correctionCycle: 0,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE2, {
        status: 'with_engineer_3',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: null,
          engineer4: null,
          currentStage: 'engineer_3',
          correctionCycle: 0,
          lastCorrectionReason: null,
          lastCorrectionBy: null,
          lastCorrectionRole: null,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE3, {
        lastViewedBy: USERS.engineer3.uid,
        lastViewedAt: nowIso(),
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE3, {
        status: 'rejected',
        rejectionReason: 'Please correct manpower totals.',
        editUserIds: [USERS.engineer1.uid, USERS.contractor.uid, USERS.engineer3.uid],
        approvalFlow: {
          contractorConfirmation: null,
          engineer2: null,
          engineer3: null,
          engineer4: null,
          currentStage: 'draft',
          correctionCycle: 1,
          lastCorrectionReason: 'Please correct manpower totals.',
          lastCorrectionBy: USERS.engineer3.uid,
          lastCorrectionRole: 'engineer_3',
        },
        updatedAt: nowIso(),
      }),
    );

    const rejectedSnap = await getDoc(reportRefE1);
    const rejectedData = rejectedSnap.data();
    if (!rejectedData || !Array.isArray(rejectedData.editUserIds) || !rejectedData.editUserIds.includes(USERS.engineer3.uid)) {
      throw new Error('Rejected report did not retain last-view editor access.');
    }

    await assertSucceeds(
      updateDoc(reportRefE1, {
        status: 'pending_contractor',
        contractorChanges: [],
        approvalFlow: {
          contractorConfirmation: null,
          engineer2: null,
          engineer3: null,
          engineer4: null,
          currentStage: 'contractor_confirmation',
          correctionCycle: 1,
          lastCorrectionReason: 'Please correct manpower totals.',
          lastCorrectionBy: USERS.engineer3.uid,
          lastCorrectionRole: 'engineer_3',
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefContractor, {
        status: 'contractor_confirmed',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: null,
          engineer3: null,
          engineer4: null,
          currentStage: 'engineer_2',
          correctionCycle: 1,
          lastCorrectionReason: 'Please correct manpower totals.',
          lastCorrectionBy: USERS.engineer3.uid,
          lastCorrectionRole: 'engineer_3',
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE1, {
        status: 'pending_review',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: null,
          engineer3: null,
          engineer4: null,
          currentStage: 'engineer_2',
          correctionCycle: 1,
          lastCorrectionReason: 'Please correct manpower totals.',
          lastCorrectionBy: USERS.engineer3.uid,
          lastCorrectionRole: 'engineer_3',
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE2, {
        status: 'with_engineer_3',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: null,
          engineer4: null,
          currentStage: 'engineer_3',
          correctionCycle: 1,
          lastCorrectionReason: 'Please correct manpower totals.',
          lastCorrectionBy: USERS.engineer3.uid,
          lastCorrectionRole: 'engineer_3',
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE3, {
        status: 'with_engineer_4',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: { approvedBy: USERS.engineer3.uid, approvedRole: 'engineer_3', approvedAt: nowIso() },
          engineer4: null,
          currentStage: 'engineer_4',
          correctionCycle: 1,
          lastCorrectionReason: 'Please correct manpower totals.',
          lastCorrectionBy: USERS.engineer3.uid,
          lastCorrectionRole: 'engineer_3',
        },
        updatedAt: nowIso(),
      }),
    );

    await assertFails(
      updateDoc(reportRefE1, {
        releaseState: { optionalAttachments: ['swa'] },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(reportRefE4, {
        status: 'approved',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: USERS.contractor.uid,
            confirmedRole: 'contractor',
            confirmedAt: nowIso(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: { approvedBy: USERS.engineer3.uid, approvedRole: 'engineer_3', approvedAt: nowIso() },
          engineer4: { approvedBy: USERS.engineer4.uid, approvedRole: 'engineer_4', approvedAt: nowIso() },
          currentStage: 'engineer_4',
          correctionCycle: 1,
          lastCorrectionReason: 'Please correct manpower totals.',
          lastCorrectionBy: USERS.engineer3.uid,
          lastCorrectionRole: 'engineer_3',
        },
        releaseState: {
          optionalAttachments: ['swa', 'stewa', 'pdm'],
          releasedBy: USERS.engineer4.uid,
          releasedRole: 'engineer_4',
          attachmentsReleasedAt: null,
          emailSentAt: null,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertFails(
      updateDoc(projectRefE1, {
        ...projectDoc('archived'),
        accessUserIds: [USERS.engineer1.uid],
      }),
    );

    await assertSucceeds(
      updateDoc(projectRefE1, {
        lifecycleState: 'pending_delete_approval',
        deletionApproval: {
          requestedBy: USERS.engineer1.uid,
          requestedRole: 'engineer_1',
          requestedAt: nowIso(),
          engineer2: null,
          engineer3: null,
          engineer4: null,
          completedAt: null,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(projectRefE2, {
        lifecycleState: 'pending_delete_approval',
        deletionApproval: {
          requestedBy: USERS.engineer1.uid,
          requestedRole: 'engineer_1',
          requestedAt: nowIso(),
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: null,
          engineer4: null,
          completedAt: null,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertFails(
      updateDoc(projectRefE4, {
        ...projectDoc('archived'),
        deletionApproval: {
          requestedBy: USERS.engineer1.uid,
          requestedRole: 'engineer_1',
          requestedAt: nowIso(),
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: null,
          engineer4: { approvedBy: USERS.engineer4.uid, approvedRole: 'engineer_4', approvedAt: nowIso() },
        },
        accessUserIds: [USERS.engineer1.uid],
        assignedUserIds: [USERS.engineer1.uid],
      }),
    );

    await assertSucceeds(
      updateDoc(projectRefE3, {
        lifecycleState: 'pending_delete_approval',
        deletionApproval: {
          requestedBy: USERS.engineer1.uid,
          requestedRole: 'engineer_1',
          requestedAt: nowIso(),
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: { approvedBy: USERS.engineer3.uid, approvedRole: 'engineer_3', approvedAt: nowIso() },
          engineer4: null,
          completedAt: null,
        },
        updatedAt: nowIso(),
      }),
    );

    await assertSucceeds(
      updateDoc(projectRefE4, {
        ...projectDoc('archived'),
        deletionApproval: {
          requestedBy: USERS.engineer1.uid,
          requestedRole: 'engineer_1',
          requestedAt: nowIso(),
          engineer2: { approvedBy: USERS.engineer2.uid, approvedRole: 'engineer_2', approvedAt: nowIso() },
          engineer3: { approvedBy: USERS.engineer3.uid, approvedRole: 'engineer_3', approvedAt: nowIso() },
          engineer4: { approvedBy: USERS.engineer4.uid, approvedRole: 'engineer_4', approvedAt: nowIso() },
          completedAt: nowIso(),
        },
        archivedAccessSnapshot: {
          contractorId: USERS.contractor.uid,
          assignedUserIds: [USERS.engineer1.uid, USERS.contractor.uid],
          involvedUserIds: [USERS.engineer2.uid],
          accessUserIds: [USERS.engineer1.uid, USERS.contractor.uid, USERS.engineer2.uid],
        },
        accessUserIds: [USERS.engineer1.uid],
        assignedUserIds: [USERS.engineer1.uid],
        involvedUserIds: [],
        archiveOwnerId: USERS.engineer1.uid,
        archiveOwnerRole: 'engineer_1',
        archivedAt: nowIso(),
        purgeAfter: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: nowIso(),
      }),
    );

    await assertFails(getDoc(doc(contractor, 'projects', PROJECT_ID)));
    await assertSucceeds(getDoc(projectRefE1));

    await assertSucceeds(
      updateDoc(projectRefE1, {
        ...projectDoc('active'),
        lifecycleState: 'active',
        deletionApproval: null,
        archivedAccessSnapshot: null,
        archiveOwnerId: null,
        archiveOwnerRole: null,
        archivedAt: null,
        purgeAfter: null,
        restoredAt: nowIso(),
        restoredBy: USERS.engineer1.uid,
        contractorId: USERS.contractor.uid,
        assignedUserIds: [USERS.engineer1.uid, USERS.contractor.uid],
        involvedUserIds: [USERS.engineer2.uid],
        accessUserIds: [USERS.engineer1.uid, USERS.contractor.uid, USERS.engineer2.uid],
        updatedAt: nowIso(),
      }),
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          reportWorkflowValidated: true,
          archiveWorkflowValidated: true,
          finalApprovalValidated: true,
          restoreValidated: true,
          purgeMetadataValidated: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
