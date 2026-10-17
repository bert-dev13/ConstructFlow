<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Peo\Auth;
use Peo\DatabaseSetup;
use Peo\ProjectInfo;
use Peo\ScheduleSync;

$pdo = db();
DatabaseSetup::ensureUsersAndProjects($pdo);
DatabaseSetup::ensureSwaStewaTables($pdo);
ProjectInfo::ensureTables($pdo);
Auth::requireAuth();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' && isset($_GET['contractors'])) {
    $rows = $pdo->query(
        "SELECT id, full_name, email FROM users WHERE role = 'contractor' AND is_active = 1 ORDER BY full_name"
    )->fetchAll();
    jsonResponse(['contractors' => $rows]);
}

$projectId = (int)($_GET['id'] ?? 0);

if ($method === 'GET' && $projectId > 0) {
    $project = ProjectInfo::fetch($pdo, $projectId);
    if (!$project) {
        jsonError('Project not found.', 404);
    }
    jsonResponse([
        'project' => formatProjectRow($project),
        'audit_log' => ProjectInfo::auditLog($pdo, $projectId),
        'contract_history' => ProjectInfo::contractHistory($pdo, $projectId),
        'report_defaults' => ProjectInfo::reportDefaults($pdo, $projectId),
    ]);
}

function formatProjectRow(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'name' => (string)$row['name'],
        'location' => $row['location'],
        'status' => (string)($row['status'] ?? 'active'),
        'start_date' => $row['start_date'],
        'planned_end_date' => $row['planned_end_date'],
        'contractor_id' => $row['contractor_id'] !== null ? (int)$row['contractor_id'] : null,
        'contractor_name' => $row['contractor_name'] ?? null,
        'contract_amount' => $row['contract_amount'] !== null ? (float)$row['contract_amount'] : null,
        'created_at' => $row['created_at'] ?? null,
        'updated_at' => $row['updated_at'] ?? null,
    ];
}

function projectPayloadFromBody(array $body): array
{
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '') {
        jsonError('Project title is required.');
    }

    $contractorId = isset($body['contractor_id']) && $body['contractor_id'] !== ''
        ? (int)$body['contractor_id']
        : null;
    $contractAmount = isset($body['contract_amount']) && $body['contract_amount'] !== ''
        ? round((float)$body['contract_amount'], 2)
        : null;

    return [
        'name' => $name,
        'location' => trim((string)($body['location'] ?? '')) ?: null,
        'start_date' => trim((string)($body['start_date'] ?? '')) ?: null,
        'planned_end_date' => trim((string)($body['planned_end_date'] ?? '')) ?: null,
        'status' => trim((string)($body['status'] ?? 'active')) ?: 'active',
        'contractor_id' => $contractorId,
        'contract_amount' => $contractAmount,
    ];
}

if ($method === 'POST') {
    Auth::requireRoles(['engineer_1']);
    $body = readJsonBody();
    $payload = projectPayloadFromBody($body);

    $stmt = $pdo->prepare(
        'INSERT INTO projects (name, location, start_date, planned_end_date, status, contractor_id, contract_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $payload['name'],
        $payload['location'],
        $payload['start_date'],
        $payload['planned_end_date'],
        $payload['status'],
        $payload['contractor_id'],
        $payload['contract_amount'],
    ]);

    $id = (int)$pdo->lastInsertId();
    $actorId = Auth::actorId();
    ProjectInfo::auditProjectUpdate($pdo, $id, $actorId, [], $payload);
    if ($payload['contract_amount'] !== null && $payload['contract_amount'] > 0) {
        ProjectInfo::recordContractAmount(
            $pdo,
            $id,
            $payload['contract_amount'],
            $payload['start_date'] ?? date('Y-m-d'),
            $actorId,
            null,
            'Initial contract amount',
        );
    }

    $project = ProjectInfo::fetch($pdo, $id);
    jsonResponse(['project' => formatProjectRow($project ?: [])], 201);
}

if ($method === 'PUT' || $method === 'PATCH') {
    Auth::requireRoles(['engineer_1']);
    $body = readJsonBody();
    $id = (int)($body['id'] ?? $_GET['id'] ?? 0);
    if ($id <= 0) {
        jsonError('Project id is required.');
    }

    $before = ProjectInfo::fetch($pdo, $id);
    if (!$before) {
        jsonError('Project not found.', 404);
    }

    $payload = projectPayloadFromBody($body);
    $stmt = $pdo->prepare(
        'UPDATE projects
         SET name = ?, location = ?, start_date = ?, planned_end_date = ?, status = ?,
             contractor_id = ?, contract_amount = ?
         WHERE id = ?'
    );
    $stmt->execute([
        $payload['name'],
        $payload['location'],
        $payload['start_date'],
        $payload['planned_end_date'],
        $payload['status'],
        $payload['contractor_id'],
        $payload['contract_amount'],
        $id,
    ]);

    ProjectInfo::auditProjectUpdate($pdo, $id, Auth::actorId(), $before, $payload);

    $datesChanged =
        (string)($before['start_date'] ?? '') !== (string)($payload['start_date'] ?? '')
        || (string)($before['planned_end_date'] ?? '') !== (string)($payload['planned_end_date'] ?? '');
    if ($datesChanged) {
        try {
            DatabaseSetup::ensureScheduleTables($pdo);
            DatabaseSetup::ensureSCurveTable($pdo);
            $pdm = ScheduleSync::loadPdmResult($pdo, $id);
            if (($pdm['activities'] ?? []) !== []) {
                ScheduleSync::syncDerivedViews(
                    $pdo,
                    $id,
                    $pdm,
                    [],
                    'project_dates',
                    'Project start/end dates updated',
                );
            }
        } catch (Throwable) {
            // Project save already succeeded; S-curve refresh is best-effort.
        }
    }

    $project = ProjectInfo::fetch($pdo, $id);
    jsonResponse(['project' => formatProjectRow($project ?: [])]);
}

$rows = $pdo->query(
    'SELECT p.id, p.name, p.location, p.status, p.start_date, p.planned_end_date,
            p.contractor_id, p.contract_amount, p.created_at, p.updated_at,
            u.full_name AS contractor_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.contractor_id
     ORDER BY p.name'
)->fetchAll();

jsonResponse(['projects' => array_map('formatProjectRow', $rows)]);
