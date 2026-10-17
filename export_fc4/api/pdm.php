<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Peo\PdmSchedule;

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $body = readJsonBody();
    $activities = $body['activities'] ?? [];
    $dependencies = $body['dependencies'] ?? [];
    if (!$activities) jsonError('activities required');
    jsonResponse(PdmSchedule::calculate($activities, $dependencies));
}

if ($method === 'GET') {
    $projectId = (int)($_GET['project_id'] ?? 0);
    if (!$projectId) jsonError('project_id required');

    $pdo = db();
    $acts = $pdo->prepare(
        'SELECT id, activity_number AS number, activity_name AS name, duration, es_override, extend_to_end
         FROM pdm_activities WHERE project_id = ?'
    );
    $acts->execute([$projectId]);
    $activities = [];
    foreach ($acts->fetchAll() as $row) {
        $activities[] = [
            'id' => (string)$row['id'],
            'number' => $row['number'],
            'name' => $row['name'],
            'duration' => (int)$row['duration'],
            'esOverride' => $row['es_override'] !== null ? (int)$row['es_override'] : null,
            'extendToEnd' => !empty($row['extend_to_end']),
        ];
    }

    $deps = $pdo->prepare('SELECT from_activity_id AS fromId, to_activity_id AS toId, dependency_type AS type, lag_days AS `lag` FROM pdm_dependencies WHERE project_id = ?');
    $deps->execute([$projectId]);
    $dependencies = $deps->fetchAll();

    jsonResponse(PdmSchedule::calculate($activities, $dependencies));
}

jsonError('Method not allowed', 405);
