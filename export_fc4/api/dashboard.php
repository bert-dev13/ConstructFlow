<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Peo\Auth;
use Peo\DatabaseSetup;

$pdo = db();
DatabaseSetup::ensureSwaStewaTables($pdo);
DatabaseSetup::ensureUsersAndProjects($pdo);

$user = Auth::requireAuth();
$role = $user['role'];

$projectCount = (int)$pdo->query("SELECT COUNT(*) FROM projects WHERE status = 'active'")->fetchColumn();
$pending = (int)$pdo->query(
    "SELECT COUNT(*) FROM swa_stewa_reports WHERE status IN ('pending_review','with_engineer_3')"
)->fetchColumn();
$delayed = (int)$pdo->query("SELECT COUNT(*) FROM projects WHERE status = 'delayed'")->fetchColumn();
$rejected = (int)$pdo->query("SELECT COUNT(*) FROM swa_stewa_reports WHERE status = 'rejected'")->fetchColumn();
$drafts = (int)$pdo->query("SELECT COUNT(*) FROM swa_stewa_reports WHERE status = 'draft'")->fetchColumn();
$approved = (int)$pdo->query(
    "SELECT COUNT(*) FROM swa_stewa_reports WHERE status IN ('approved','generated')"
)->fetchColumn();

$myDrafts = 0;
$myRejected = 0;
if ($role === 'engineer_1' || $role === 'contractor') {
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) FROM swa_stewa_reports WHERE status = 'draft' AND created_by = ?"
    );
    $stmt->execute([(int)$user['id']]);
    $myDrafts = (int)$stmt->fetchColumn();

    $stmt = $pdo->prepare(
        "SELECT COUNT(*) FROM swa_stewa_reports WHERE status = 'rejected' AND created_by = ?"
    );
    $stmt->execute([(int)$user['id']]);
    $myRejected = (int)$stmt->fetchColumn();
}

jsonResponse([
    'kpis' => [
        'visibleProjects' => [
            'value' => $projectCount,
            'label' => $role === 'contractor' ? 'Active projects you monitor' : 'Active projects in system',
        ],
        'pendingApprovals' => [
            'value' => $pending,
            'label' => 'Reports awaiting engineer review',
        ],
        'delayedProjects' => [
            'value' => $delayed,
            'label' => 'Projects flagged as delayed',
        ],
        'inputWarnings' => [
            'value' => $rejected + $myRejected,
            'label' => 'Reports needing revision',
        ],
    ],
    'counts' => [
        'drafts' => $drafts,
        'my_drafts' => $myDrafts,
        'my_rejected' => $myRejected,
        'approved' => $approved,
    ],
    'period' => date('F Y'),
]);
