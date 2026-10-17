<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Peo\Auth;
use Peo\DatabaseSetup;
use Peo\ScheduleSync;

$pdo = db();
DatabaseSetup::ensureUsersAndProjects($pdo);
DatabaseSetup::ensureScheduleTables($pdo);
DatabaseSetup::ensureSCurveTable($pdo);
DatabaseSetup::seedScheduleIfEmpty($pdo);
DatabaseSetup::seedSCurveIfEmpty($pdo);

$method = $_SERVER['REQUEST_METHOD'];
$projectId = (int)($_GET['project_id'] ?? 1);
$snapshotId = isset($_GET['snapshot_id']) ? (int)$_GET['snapshot_id'] : 0;

function formatScurvePoints(array $rawPoints): array
{
    $points = [];
    foreach ($rawPoints as $row) {
        $target = $row['original_plan_pct'] !== null ? (float)$row['original_plan_pct'] : null;
        $actual = $row['actual_pct'] !== null ? (float)$row['actual_pct'] : null;
        $variance = ($target !== null && $actual !== null) ? round($actual - $target, 2) : null;
        $points[] = [
            'date' => date('M j', strtotime((string)$row['point_date'])),
            'pointDate' => (string)$row['point_date'],
            'label' => $row['label'] ?? null,
            'originalPlan' => $target,
            'currentPlan' => $row['current_plan_pct'] !== null ? (float)$row['current_plan_pct'] : null,
            'actual' => $actual,
            'variance' => $variance,
        ];
    }
    return $points;
}

function buildScurveResponse(
    int $projectId,
    array $rawPoints,
    array $pdm,
    array $scheduled,
    int $duration,
    array $activities,
    array $reportFeed,
    array $reportActuals,
    bool $hasActualProgress,
    array $versions,
    string $projectStartDate,
    string $projectEndDate,
    ?int $viewingSnapshotId = null,
    ?string $viewingSnapshotLabel = null,
    ?string $viewingSnapshotAt = null,
): void {
    $rawPoints = ScheduleSync::enrichPointsWithTargetPlan($rawPoints);
    $latestDate = $hasActualProgress ? array_key_last($reportActuals) : null;
    $latestActual = $hasActualProgress ? (float)$reportActuals[$latestDate] : null;
    $scheduleStatus = ScheduleSync::computeScheduleStatus($rawPoints, $latestActual, $latestDate);
    $comparisons = $hasActualProgress
        ? ScheduleSync::comparisonAtReportDates($rawPoints, $reportActuals)
        : [];

    jsonResponse([
        'project_id' => $projectId,
        'project_duration' => $duration,
        'project_start_date' => $projectStartDate,
        'project_end_date' => $projectEndDate,
        'critical_path' => $pdm['criticalPath'] ?? [],
        'points' => formatScurvePoints($rawPoints),
        'activities' => $activities,
        'synced_from_pdm' => $scheduled !== [],
        'has_actual_progress' => $hasActualProgress,
        'has_revised_schedule' => ScheduleSync::hasRevisedSchedule($rawPoints),
        'schedule_status' => $scheduleStatus,
        'comparisons' => $comparisons,
        'report_feed' => $reportFeed,
        'latest_report_percent' => $hasActualProgress ? (float)$reportActuals[array_key_last($reportActuals)] : null,
        'latest_report_date' => $hasActualProgress ? array_key_last($reportActuals) : null,
        'versions' => $versions,
        'viewing_snapshot_id' => $viewingSnapshotId,
        'viewing_snapshot_label' => $viewingSnapshotLabel,
        'viewing_snapshot_at' => $viewingSnapshotAt,
    ]);
}

if ($method === 'GET') {
    Auth::requireAuth();

    $versions = ScheduleSync::listSCurveSnapshots($pdo, $projectId);
    $viewingSnapshot = null;

    if ($snapshotId > 0) {
        $rawPoints = ScheduleSync::loadSCurveSnapshotPoints($pdo, $projectId, $snapshotId);
        if ($rawPoints === null) {
            jsonError('Snapshot not found', 404);
        }
        foreach ($versions as $version) {
            if ($version['id'] === $snapshotId) {
                $viewingSnapshot = $version;
                break;
            }
        }
        $pdm = ScheduleSync::loadPdmResult($pdo, $projectId);
        $scheduled = $pdm['activities'] ?? [];
        $pdmDuration = max(1, (int)($pdm['projectDuration'] ?? 0));
        $timeline = ScheduleSync::projectTimeline($pdo, $projectId, $pdmDuration);
        $startDate = $timeline['start_date'];
        $endDate = $timeline['end_date'];
        $duration = $timeline['duration_days'];
        $activities = $scheduled !== []
            ? ScheduleSync::sCurveActivitiesFromPdm($scheduled, $startDate, $endDate, $pdmDuration)
            : [];
        $reportFeed = ScheduleSync::reportProgressEntries($pdo, $projectId);
        $hasActualProgress = false;
        $snapshotActuals = [];
        foreach ($rawPoints as $row) {
            if ($row['actual_pct'] !== null) {
                $hasActualProgress = true;
                $snapshotActuals[(string)$row['point_date']] = (float)$row['actual_pct'];
            }
        }

        buildScurveResponse(
            $projectId,
            $rawPoints,
            $pdm,
            $scheduled,
            $duration,
            $activities,
            $reportFeed,
            $snapshotActuals,
            $hasActualProgress,
            $versions,
            $startDate,
            $endDate,
            $snapshotId,
            $viewingSnapshot['trigger_label'] ?? null,
            $viewingSnapshot['captured_at'] ?? null,
        );
    }

    $pdm = ScheduleSync::loadPdmResult($pdo, $projectId);
    $scheduled = $pdm['activities'] ?? [];
    $pdmDuration = max(1, (int)($pdm['projectDuration'] ?? 0));
    $timeline = ScheduleSync::projectTimeline($pdo, $projectId, $pdmDuration);
    $startDate = $timeline['start_date'];
    $endDate = $timeline['end_date'];
    $duration = $timeline['duration_days'];
    $reportFeed = ScheduleSync::reportProgressEntries($pdo, $projectId);
    $reportActuals = ScheduleSync::actualPointsFromReports($pdo, $projectId);
    $hasActualProgress = $reportActuals !== [];
    $actuals = $hasActualProgress ? $reportActuals : [];

    if ($scheduled !== []) {
        if (ScheduleSync::isReferenceProject($pdo, $projectId)) {
            $rawPoints = ScheduleSync::sCurveFromReferenceTargets($startDate, $pdmDuration, $actuals, null, $endDate);
        } else {
            $rawPoints = ScheduleSync::sCurveFromPdm($scheduled, $startDate, $pdmDuration, $actuals, $endDate);
        }
        $rawPoints = ScheduleSync::mergeBaselineIntoPoints($pdo, $projectId, $rawPoints);
        $activities = ScheduleSync::sCurveActivitiesFromPdm($scheduled, $startDate, $endDate, $pdmDuration);
    } else {
        $stmt = $pdo->prepare(
            'SELECT point_date, original_plan_pct, current_plan_pct, actual_pct
             FROM s_curve_points WHERE project_id = ? ORDER BY point_date'
        );
        $stmt->execute([$projectId]);
        $byDate = [];
        foreach ($stmt->fetchAll() as $row) {
            $byDate[(string)$row['point_date']] = [
                'point_date' => (string)$row['point_date'],
                'original_plan_pct' => $row['original_plan_pct'],
                'current_plan_pct' => $row['current_plan_pct'],
                'actual_pct' => $row['actual_pct'],
                'label' => null,
            ];
        }
        foreach ($reportActuals as $dateKey => $val) {
            if (isset($byDate[$dateKey])) {
                $byDate[$dateKey]['actual_pct'] = $val;
            } else {
                $byDate[$dateKey] = [
                    'point_date' => $dateKey,
                    'original_plan_pct' => null,
                    'current_plan_pct' => null,
                    'actual_pct' => $val,
                    'label' => 'Actual (report)',
                ];
            }
        }
        if (!$hasActualProgress) {
            foreach ($byDate as &$row) {
                $row['actual_pct'] = null;
            }
            unset($row);
        }
        ksort($byDate);
        $rawPoints = array_values($byDate);
        $activities = [];
    }

    if (!$hasActualProgress) {
        foreach ($rawPoints as &$row) {
            $row['actual_pct'] = null;
        }
        unset($row);
    }

    buildScurveResponse(
        $projectId,
        $rawPoints,
        $pdm,
        $scheduled,
        $duration,
        $activities,
        $reportFeed,
        $reportActuals,
        $hasActualProgress,
        $versions,
        $startDate,
        $endDate,
    );
}

if ($method === 'POST') {
    Auth::requireRoles(['engineer_1', 'engineer_2', 'engineer_3', 'engineer_4', 'contractor']);
    $body = readJsonBody();
    $projectId = (int)($body['project_id'] ?? 1);
    $points = $body['points'] ?? [];
    if (!is_array($points)) {
        jsonError('points array required');
    }

    $pdo->prepare('DELETE FROM s_curve_points WHERE project_id = ?')->execute([$projectId]);
    $ins = $pdo->prepare(
        'INSERT INTO s_curve_points (project_id, point_date, original_plan_pct, current_plan_pct, actual_pct)
         VALUES (?, ?, ?, ?, ?)'
    );
    foreach ($points as $p) {
        $date = (string)($p['point_date'] ?? $p['date'] ?? '');
        if ($date === '') {
            continue;
        }
        $ts = strtotime($date);
        if ($ts === false) {
            continue;
        }
        $ins->execute([
            $projectId,
            date('Y-m-d', $ts),
            $p['original_plan_pct'] ?? $p['originalPlan'] ?? null,
            $p['current_plan_pct'] ?? $p['currentPlan'] ?? null,
            $p['actual_pct'] ?? $p['actual'] ?? null,
        ]);
    }
    jsonResponse(['ok' => true]);
}

jsonError('Method not allowed', 405);
