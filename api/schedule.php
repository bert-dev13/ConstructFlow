<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Peo\Auth;
use Peo\DatabaseSetup;
use Peo\PdmSchedule;
use Peo\ScheduleSync;

try {
    $pdo = db();
} catch (Throwable $e) {
    jsonError('Database connection failed: ' . $e->getMessage(), 500);
}

try {
    DatabaseSetup::ensureScheduleTables($pdo);
    DatabaseSetup::ensureUsersAndProjects($pdo);
    DatabaseSetup::ensureSwaStewaTables($pdo);
    DatabaseSetup::ensureSCurveTable($pdo);
    DatabaseSetup::seedScheduleIfEmpty($pdo);
} catch (Throwable $e) {
    jsonError('Database setup failed: ' . $e->getMessage(), 500);
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($method === 'GET' ? 'get' : '');

function normalizeEsOverride(mixed $value): ?int
{
    if ($value === null || $value === '') {
        return null;
    }
    return max(0, (int)$value);
}

function loadSchedule(PDO $pdo, int $projectId): array
{
    $acts = $pdo->prepare(
        'SELECT id, activity_number AS number, activity_name AS name, duration, es_override, extend_to_end, pos_x, pos_y
         FROM pdm_activities WHERE project_id = ? ORDER BY id'
    );
    $acts->execute([$projectId]);
    $activities = [];
    foreach ($acts->fetchAll() as $row) {
        $activities[] = [
            'id' => (string)$row['id'],
            'number' => $row['number'],
            'name' => $row['name'],
            'duration' => (int)$row['duration'],
            'esOverride' => normalizeEsOverride($row['es_override']),
            'extendToEnd' => !empty($row['extend_to_end']),
            'posX' => (int)$row['pos_x'],
            'posY' => (int)$row['pos_y'],
        ];
    }

    $deps = $pdo->prepare(
        'SELECT id, from_activity_id AS fromId, to_activity_id AS toId, dependency_type AS type, lag_days AS `lag`
         FROM pdm_dependencies WHERE project_id = ?'
    );
    $deps->execute([$projectId]);
    $dependencies = [];
    foreach ($deps->fetchAll() as $row) {
        $dependencies[] = [
            'id' => (string)$row['id'],
            'fromId' => (string)$row['fromId'],
            'toId' => (string)$row['toId'],
            'type' => $row['type'],
            'lag' => (int)$row['lag'],
        ];
    }

    $tasks = $pdo->prepare(
        'SELECT id, task_index AS `index`, task_name AS name, start_day AS startDay, end_day AS endDay, actual_end_day AS actualEndDay
         FROM bar_chart_tasks WHERE project_id = ? ORDER BY task_index'
    );
    $tasks->execute([$projectId]);
    $barChartTasks = [];
    foreach ($tasks->fetchAll() as $row) {
        $barChartTasks[] = [
            'id' => (string)$row['id'],
            'index' => (int)$row['index'],
            'name' => $row['name'],
            'startDay' => (int)$row['startDay'],
            'endDay' => (int)$row['endDay'],
            'actualEndDay' => $row['actualEndDay'] !== null ? (int)$row['actualEndDay'] : null,
        ];
    }

    $settings = $pdo->prepare('SELECT bar_chart_total_days, bar_chart_time_now FROM schedule_settings WHERE project_id = ?');
    $settings->execute([$projectId]);
    $set = $settings->fetch() ?: ['bar_chart_total_days' => 24, 'bar_chart_time_now' => 10];

    $pdmInput = array_map(fn($a) => [
        'id' => $a['id'],
        'number' => $a['number'],
        'name' => $a['name'],
        'duration' => $a['duration'],
        'esOverride' => $a['esOverride'] ?? null,
        'extendToEnd' => !empty($a['extendToEnd']),
    ], $activities);

    $pdm = $activities ? PdmSchedule::calculate($pdmInput, $dependencies) : [
        'activities' => [],
        'projectDuration' => 0,
        'criticalPath' => [],
    ];

    if (isset($pdm['error'])) {
        $pdm = ['activities' => $pdmInput, 'projectDuration' => 0, 'criticalPath' => [], 'error' => $pdm['error']];
    }

    $scheduledById = [];
    foreach ($pdm['activities'] as $a) {
        $scheduledById[(string)$a['id']] = $a;
    }
    foreach ($activities as &$a) {
        $s = $scheduledById[$a['id']] ?? null;
        if ($s) {
            $a['es'] = $s['es'] ?? 0;
            $a['ef'] = $s['ef'] ?? 0;
            $a['ls'] = $s['ls'] ?? 0;
            $a['lf'] = $s['lf'] ?? 0;
            $a['duration'] = (int)($s['duration'] ?? $a['duration']);
            $a['extendToEnd'] = !empty($s['extendToEnd']) || !empty($a['extendToEnd']);
            $a['isCritical'] = !empty($s['isCritical']);
        }
    }
    unset($a);

    $actualByName = [];
    $idByName = [];
    foreach ($barChartTasks as $t) {
        $idByName[$t['name']] = $t['id'];
        if ($t['actualEndDay'] !== null) {
            $actualByName[$t['name']] = $t['actualEndDay'];
        }
    }
    $derivedTasks = ScheduleSync::barChartFromPdm($pdm['activities'] ?? [], $actualByName);
    $barChartTasks = [];
    foreach ($derivedTasks as $i => $t) {
        $barChartTasks[] = [
            'id' => $idByName[$t['name']] ?? ('bar-' . $i),
            'index' => $t['index'],
            'name' => $t['name'],
            'startDay' => $t['startDay'],
            'endDay' => $t['endDay'],
            'actualEndDay' => $t['actualEndDay'],
            'isCritical' => !empty($t['isCritical']),
        ];
    }
    $totalDaysFromPdm = max(1, (int)($pdm['projectDuration'] ?? 0));
    $barTotalDays = $totalDaysFromPdm ?: (int)$set['bar_chart_total_days'];
    $timeNow = (int)$set['bar_chart_time_now'];

    // Auto-update the bar chart from weekly SWA / STEWA / IAR actual progress.
    $reportFeed = ScheduleSync::reportProgressEntries($pdo, $projectId);
    $reportActuals = ScheduleSync::actualPointsFromReports($pdo, $projectId);
    $startDate = ScheduleSync::projectStartDate($pdo, $projectId);
    $applied = ScheduleSync::applyReportProgressToBarChart(
        $barChartTasks,
        $reportActuals,
        $startDate,
        $barTotalDays,
        $timeNow,
    );
    $barChartTasks = $applied['tasks'];
    $timeNow = $applied['timeNow'];

    return [
        'project_id' => $projectId,
        'activities' => $activities,
        'dependencies' => $dependencies,
        'barChartTasks' => $barChartTasks,
        'barChartTotalDays' => $barTotalDays,
        'barChartTimeNow' => $timeNow,
        'projectDuration' => $pdm['projectDuration'] ?? 0,
        'criticalPath' => $pdm['criticalPath'] ?? [],
        'pdmError' => $pdm['error'] ?? null,
        'syncedFromPdm' => true,
        'reportFeed' => $reportFeed,
        'latestReportPercent' => $applied['latestPercent'],
        'latestReportDate' => $applied['latestReportDate'],
    ];
}

if ($method === 'GET' && $action === 'get') {
    Auth::requireAuth();
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    try {
        $projectId = (int)($_GET['project_id'] ?? 1);
        jsonResponse(loadSchedule($pdo, $projectId));
    } catch (Throwable $e) {
        jsonError('Could not load schedule: ' . $e->getMessage(), 500);
    }
}

if ($method === 'POST' && $action === 'save') {
    Auth::requireRoles(['contractor']);
    $body = readJsonBody();
    $projectId = (int)($body['project_id'] ?? 0);
    if (!$projectId) {
        jsonError('project_id required');
    }

    $activities = $body['activities'] ?? [];
    $dependencies = $body['dependencies'] ?? [];
    $timeNow = (int)($body['barChartTimeNow'] ?? 10);

    $pdo->beginTransaction();
    try {
        $oldTasks = $pdo->prepare(
            'SELECT task_name, actual_end_day FROM bar_chart_tasks WHERE project_id = ?'
        );
        $oldTasks->execute([$projectId]);
        $actualByName = [];
        foreach ($oldTasks->fetchAll() as $row) {
            if ($row['actual_end_day'] !== null) {
                $actualByName[(string)$row['task_name']] = (int)$row['actual_end_day'];
            }
        }
        foreach ($body['barChartTasks'] ?? [] as $t) {
            if (isset($t['actualEndDay']) && $t['actualEndDay'] !== '' && $t['actualEndDay'] !== null) {
                $actualByName[(string)($t['name'] ?? '')] = (int)$t['actualEndDay'];
            }
        }

        $pdo->prepare('DELETE FROM pdm_dependencies WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM pdm_activities WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM bar_chart_tasks WHERE project_id = ?')->execute([$projectId]);

        $idMap = [];
        $actStmt = $pdo->prepare(
            'INSERT INTO pdm_activities (project_id, activity_number, activity_name, duration, es_override, extend_to_end, pos_x, pos_y)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($activities as $i => $a) {
            $clientId = (string)($a['id'] ?? ('new-' . $i));
            $esOverride = $a['esOverride'] ?? $a['es_override'] ?? null;
            if ($esOverride === '' || $esOverride === null) {
                $esOverride = null;
            } else {
                $esOverride = max(0, (int)$esOverride);
            }
            $extendToEnd = !empty($a['extendToEnd']) || !empty($a['extend_to_end']) ? 1 : 0;
            $actStmt->execute([
                $projectId,
                $a['number'] ?? chr(65 + $i),
                $a['name'] ?? 'Activity',
                max(1, (int)($a['duration'] ?? 1)),
                $esOverride,
                $extendToEnd,
                (int)($a['posX'] ?? 120 + ($i % 3) * 160),
                (int)($a['posY'] ?? 80 + intdiv($i, 3) * 140),
            ]);
            $idMap[$clientId] = (string)$pdo->lastInsertId();
        }

        $depStmt = $pdo->prepare(
            'INSERT INTO pdm_dependencies (project_id, from_activity_id, to_activity_id, dependency_type, lag_days)
             VALUES (?, ?, ?, ?, ?)'
        );
        foreach ($dependencies as $d) {
            $from = $idMap[(string)$d['fromId']] ?? (string)$d['fromId'];
            $to = $idMap[(string)$d['toId']] ?? (string)$d['toId'];
            if (!$from || !$to) {
                continue;
            }
            $depStmt->execute([
                $projectId,
                $from,
                $to,
                $d['type'] ?? 'FS',
                (int)($d['lag'] ?? 0),
            ]);
        }

        $pdmInput = [];
        $actRows = $pdo->prepare(
            'SELECT id, activity_number AS number, activity_name AS name, duration, es_override, extend_to_end
             FROM pdm_activities WHERE project_id = ? ORDER BY id'
        );
        $actRows->execute([$projectId]);
        foreach ($actRows->fetchAll() as $row) {
            $pdmInput[] = [
                'id' => (string)$row['id'],
                'number' => $row['number'],
                'name' => $row['name'],
                'duration' => (int)$row['duration'],
                'esOverride' => normalizeEsOverride($row['es_override']),
                'extendToEnd' => !empty($row['extend_to_end']),
            ];
        }

        $dbDeps = $pdo->prepare(
            'SELECT from_activity_id AS fromId, to_activity_id AS toId, dependency_type AS type, lag_days AS `lag`
             FROM pdm_dependencies WHERE project_id = ?'
        );
        $dbDeps->execute([$projectId]);
        $dbDependencies = [];
        foreach ($dbDeps->fetchAll() as $row) {
            $dbDependencies[] = [
                'fromId' => (string)$row['fromId'],
                'toId' => (string)$row['toId'],
                'type' => $row['type'],
                'lag' => (int)$row['lag'],
            ];
        }

        $pdm = ScheduleSync::calculateScheduled($pdmInput, $dbDependencies);
        if (isset($pdm['error'])) {
            throw new RuntimeException($pdm['error']);
        }

        $barChartTasks = ScheduleSync::barChartFromPdm($pdm['activities'], $actualByName);
        $totalDays = max(1, (int)($pdm['projectDuration'] ?? 1));
        $reportActuals = ScheduleSync::actualPointsFromReports($pdo, $projectId);
        $startDate = ScheduleSync::projectStartDate($pdo, $projectId);
        $applied = ScheduleSync::applyReportProgressToBarChart(
            $barChartTasks,
            $reportActuals,
            $startDate,
            $totalDays,
            $timeNow,
        );
        $barChartTasks = $applied['tasks'];
        $timeNow = $applied['timeNow'];

        $taskStmt = $pdo->prepare(
            'INSERT INTO bar_chart_tasks (project_id, task_index, task_name, start_day, end_day, actual_end_day)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        foreach ($barChartTasks as $t) {
            $taskStmt->execute([
                $projectId,
                (int)$t['index'],
                $t['name'],
                (int)$t['startDay'],
                (int)$t['endDay'],
                $t['actualEndDay'] ?? null,
            ]);
        }

        $pdo->prepare(
            'INSERT INTO schedule_settings (project_id, bar_chart_total_days, bar_chart_time_now)
             VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE bar_chart_total_days=VALUES(bar_chart_total_days), bar_chart_time_now=VALUES(bar_chart_time_now)'
        )->execute([$projectId, $totalDays, $timeNow]);

        ScheduleSync::syncDerivedViews($pdo, $projectId, $pdm, $actualByName);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('Save failed: ' . $e->getMessage(), 500);
    }

    jsonResponse(loadSchedule($pdo, $projectId));
}

if ($method === 'POST' && $action === 'load-reference') {
    Auth::requireRoles(['contractor']);
    if (!\Peo\RoadPdmSample::hasReference()) {
        jsonError('Reference PDM not configured yet. Send the new schedule to be loaded.', 400);
    }
    $body = readJsonBody();
    $projectId = (int)($body['project_id'] ?? 0);
    if (!$projectId) {
        jsonError('project_id required');
    }

    $pdo->beginTransaction();
    try {
        DatabaseSetup::loadReferenceSchedule($pdo, $projectId);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('Load reference failed: ' . $e->getMessage(), 500);
    }

    jsonResponse(loadSchedule($pdo, $projectId));
}

if ($method === 'GET' && $action === 'reference-boq') {
    Auth::requireAuth();
    jsonResponse([
        'project' => \Peo\RoadProjectReference::meta(),
        'boq' => \Peo\RoadProjectReference::boqItems(),
        'target_cumulative' => \Peo\RoadProjectReference::targetCumulativeByDay(),
    ]);
}

if ($method === 'POST' && $action === 'clear') {
    Auth::requireRoles(['contractor']);
    $body = readJsonBody();
    $projectId = (int)($body['project_id'] ?? 0);
    if (!$projectId) {
        jsonError('project_id required');
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM pdm_dependencies WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM pdm_activities WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM bar_chart_tasks WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM schedule_settings WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM s_curve_points WHERE project_id = ?')->execute([$projectId]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('Clear failed: ' . $e->getMessage(), 500);
    }

    jsonResponse(loadSchedule($pdo, $projectId));
}

jsonError('Method not allowed', 405);
