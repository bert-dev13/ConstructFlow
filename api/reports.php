<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/mail.php';

$method = $_SERVER['REQUEST_METHOD'];
$pdo = db();

if ($method === 'GET') {
    $id = $_GET['id'] ?? null;
    $qr = $_GET['qr'] ?? null;

    if ($qr) {
        $stmt = $pdo->prepare(
            'SELECT r.*, p.name AS project_name, u.full_name AS submitted_by_name
             FROM progress_reports r
             JOIN projects p ON p.id = r.project_id
             LEFT JOIN users u ON u.id = r.submitted_by
             WHERE r.qr_code = ?'
        );
        $stmt->execute([$qr]);
        $report = $stmt->fetch();
        if (!$report) jsonError('Report not found', 404);
        jsonResponse([
            'verified' => true,
            'message' => 'This document is legitimately stored in ConstructFlow.',
            'report' => $report,
        ]);
    }

    $stmt = $pdo->query(
        'SELECT r.*, p.name AS project_name, u.full_name AS submitted_by_name
         FROM progress_reports r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN users u ON u.id = r.submitted_by
         ORDER BY r.updated_at DESC'
    );
    jsonResponse(['reports' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $body = readJsonBody();
    $action = $body['action'] ?? 'submit';

    if ($action === 'submit') {
        $qr = 'PEO-RPT-' . strtoupper(bin2hex(random_bytes(8)));
        $stmt = $pdo->prepare(
            'INSERT INTO progress_reports (project_id, report_type, period_label, status, submitted_by, qr_code, report_data)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $body['project_id'],
            $body['report_type'],
            $body['period_label'],
            'with_engineer_2',
            $body['submitted_by'],
            $qr,
            json_encode($body['report_data'] ?? []),
        ]);
        $reportId = (int)$pdo->lastInsertId();

        $pdo->prepare('INSERT INTO document_verification (qr_code, report_id) VALUES (?, ?)')
            ->execute([$qr, $reportId]);

        queueApprovalEmail($pdo, $reportId, $qr);

        jsonResponse(['id' => $reportId, 'qr_code' => $qr, 'status' => 'with_engineer_2'], 201);
    }

    if ($action === 'approve') {
        $reportId = (int)$body['report_id'];
        $actorId = (int)$body['actor_id'];
        $role = $body['actor_role'] ?? '';

        $newStatus = match ($role) {
            'engineer_2' => 'with_engineer_3',
            'engineer_3' => 'approved',
            default => 'approved',
        };

        $pdo->prepare('UPDATE progress_reports SET status = ? WHERE id = ?')
            ->execute([$newStatus, $reportId]);

        $pdo->prepare('INSERT INTO report_workflow_log (report_id, actor_id, action, comment) VALUES (?, ?, ?, ?)')
            ->execute([$reportId, $actorId, 'approve', $body['comment'] ?? null]);

        if ($newStatus === 'approved') {
            notifyContractor($pdo, $reportId);
        } else {
            queueEngineer3Email($pdo, $reportId);
        }

        jsonResponse(['status' => $newStatus]);
    }

    if ($action === 'revise') {
        $reportId = (int)$body['report_id'];
        $pdo->prepare('UPDATE progress_reports SET status = ? WHERE id = ?')
            ->execute(['revision_requested', $reportId]);
        $pdo->prepare('INSERT INTO report_workflow_log (report_id, actor_id, action, comment) VALUES (?, ?, ?, ?)')
            ->execute([$reportId, $body['actor_id'], 'revise', $body['comment'] ?? '']);
        notifyRevision($pdo, $reportId, $body['comment'] ?? '');
        jsonResponse(['status' => 'revision_requested']);
    }

    jsonError('Unknown action');
}

jsonError('Method not allowed', 405);
