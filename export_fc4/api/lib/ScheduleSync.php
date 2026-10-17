<?php
declare(strict_types=1);

namespace Peo;

use PDO;

class ScheduleSync
{
    /** @param array<int, array<string, mixed>> $scheduledActivities Activities with es/ef from PdmSchedule */
    /** @param array<string, int|null> $actualEndByName */
    public static function barChartFromPdm(array $scheduledActivities, array $actualEndByName = []): array
    {
        $tasks = [];
        $i = 1;
        foreach ($scheduledActivities as $a) {
            $es = (int)($a['es'] ?? 0);
            $ef = (int)($a['ef'] ?? $es + (int)($a['duration'] ?? 1));
            $name = (string)($a['name'] ?? $a['number'] ?? 'Activity');
            $tasks[] = [
                'index' => $i++,
                'name' => $name,
                'startDay' => $es,
                'endDay' => max($es, $ef),
                'actualEndDay' => $actualEndByName[$name] ?? null,
                'isCritical' => !empty($a['isCritical']),
            ];
        }
        return $tasks;
    }

    /** Target S-curve from contractor reference milestones (WT% cumulative by day). */
    public static function sCurveFromReferenceTargets(
        string $startDate,
        int $projectDuration,
        array $preservedActual = [],
        ?array $milestones = null,
        ?string $endDate = null,
    ): array {
        $milestones = $milestones ?? RoadProjectReference::targetCumulativeByDay();
        $networkDuration = max(1, $projectDuration);
        $timeline = self::resolveTimeline($startDate, $endDate, $networkDuration);
        $startKey = $timeline['start_date'];
        $endKey = $timeline['end_date'];
        $calendarDays = $timeline['duration_days'];
        $points = [];

        $points[$startKey] = [
            'point_date' => $startKey,
            'original_plan_pct' => 0.0,
            'current_plan_pct' => 0.0,
            'actual_pct' => $preservedActual[$startKey] ?? null,
            'label' => 'Project start',
        ];

        foreach ($milestones as $day => $pct) {
            $dayNum = (int)$day;
            if ($dayNum <= 0 || $dayNum > $networkDuration) {
                continue;
            }
            $dateKey = self::mapNetworkDayToDate($startKey, $endKey, $dayNum, $networkDuration, $calendarDays);
            $pctVal = round(min(100.0, (float)$pct), 3);
            $points[$dateKey] = [
                'point_date' => $dateKey,
                'original_plan_pct' => $pctVal,
                'current_plan_pct' => $pctVal,
                'actual_pct' => $preservedActual[$dateKey] ?? null,
                'label' => 'Day ' . $dayNum,
            ];
        }

        $points[$endKey] = [
            'point_date' => $endKey,
            'original_plan_pct' => 100.0,
            'current_plan_pct' => 100.0,
            'actual_pct' => $preservedActual[$endKey] ?? ($points[$endKey]['actual_pct'] ?? null),
            'label' => 'Project end',
        ];

        foreach ($preservedActual as $dateKey => $val) {
            if ($val === null) {
                continue;
            }
            if (isset($points[$dateKey])) {
                $points[$dateKey]['actual_pct'] = (float)$val;
            } else {
                $points[$dateKey] = [
                    'point_date' => $dateKey,
                    'original_plan_pct' => null,
                    'current_plan_pct' => null,
                    'actual_pct' => (float)$val,
                    'label' => 'Actual (report)',
                ];
            }
        }

        ksort($points);
        return array_values($points);
    }

    /** @param array<int, array<string, mixed>> $scheduledActivities */
    /** @param array<string, float|null> $preservedActual keyed by Y-m-d */
    public static function sCurveFromPdm(
        array $scheduledActivities,
        string $startDate,
        int $projectDuration,
        array $preservedActual = [],
        ?string $endDate = null,
    ): array {
        if ($scheduledActivities === []) {
            return [];
        }

        $totalDur = array_sum(array_map(fn($a) => (int)($a['duration'] ?? 0), $scheduledActivities)) ?: 1;
        $networkDuration = max(1, $projectDuration);
        $timeline = self::resolveTimeline($startDate, $endDate, $networkDuration);
        $startKey = $timeline['start_date'];
        $endKey = $timeline['end_date'];
        $calendarDays = $timeline['duration_days'];
        $points = [];

        $points[$startKey] = [
            'point_date' => $startKey,
            'original_plan_pct' => 0.0,
            'current_plan_pct' => 0.0,
            'actual_pct' => $preservedActual[$startKey] ?? null,
            'label' => 'Project start',
        ];

        $sorted = $scheduledActivities;
        usort($sorted, static function (array $a, array $b): int {
            $ef = ((int)($a['ef'] ?? 0)) <=> ((int)($b['ef'] ?? 0));
            return $ef !== 0 ? $ef : strcmp((string)($a['number'] ?? ''), (string)($b['number'] ?? ''));
        });

        $done = 0;
        foreach ($sorted as $a) {
            $done += (int)($a['duration'] ?? 0);
            $ef = max(0, (int)($a['ef'] ?? 0));
            $pct = round(min(100.0, ($done / $totalDur) * 100), 2);
            $dateKey = self::mapNetworkDayToDate($startKey, $endKey, $ef, $networkDuration, $calendarDays);
            $name = (string)($a['name'] ?? $a['number'] ?? 'Activity');
            $points[$dateKey] = [
                'point_date' => $dateKey,
                'original_plan_pct' => $pct,
                'current_plan_pct' => $pct,
                'actual_pct' => $preservedActual[$dateKey] ?? null,
                'label' => trim((string)($a['number'] ?? '') . ' — ' . $name, ' —'),
            ];
        }

        $points[$endKey] = [
            'point_date' => $endKey,
            'original_plan_pct' => 100.0,
            'current_plan_pct' => 100.0,
            'actual_pct' => $preservedActual[$endKey] ?? ($points[$endKey]['actual_pct'] ?? null),
            'label' => 'Project end',
        ];

        // Merge in any actual-progress dates (e.g. weekly SWA/STEWA/IAR entries) that do
        // not line up with a planned point so they still appear on the S-curve.
        foreach ($preservedActual as $dateKey => $val) {
            if ($val === null) {
                continue;
            }
            if (isset($points[$dateKey])) {
                $points[$dateKey]['actual_pct'] = (float)$val;
            } else {
                $points[$dateKey] = [
                    'point_date' => $dateKey,
                    'original_plan_pct' => null,
                    'current_plan_pct' => null,
                    'actual_pct' => (float)$val,
                    'label' => 'Actual (report)',
                ];
            }
        }

        $ordered = array_values($points);
        usort($ordered, static fn(array $a, array $b) => strcmp($a['point_date'], $b['point_date']));

        return self::forwardFillActualPoints($ordered, $preservedActual);
    }

    /**
     * Carry the latest reported actual % forward so the S-curve line reflects SWA/STEWA/IAR
     * progress between report dates.
     *
     * @param array<int, array<string, mixed>> $points
     * @param array<string, float> $reportActuals
     * @return array<int, array<string, mixed>>
     */
    public static function forwardFillActualPoints(array $points, array $reportActuals): array
    {
        if ($reportActuals === []) {
            return $points;
        }

        ksort($reportActuals);
        $reportDates = array_keys($reportActuals);
        $idx = 0;
        $latest = null;
        foreach ($points as &$point) {
            $dateKey = (string)($point['point_date'] ?? '');
            while ($idx < count($reportDates) && $reportDates[$idx] <= $dateKey) {
                $latest = (float)$reportActuals[$reportDates[$idx]];
                $idx++;
            }
            if ($latest !== null) {
                $point['actual_pct'] = $latest;
            }
        }
        unset($point);

        return $points;
    }

    /**
     * @return array{tasks: array<int, array<string, mixed>>, timeNow: int, latestPercent: float|null, latestReportDate: string|null}
     */
    public static function applyReportProgressToBarChart(
        array $barChartTasks,
        array $reportActuals,
        string $projectStartDate,
        int $totalDays,
        int $defaultTimeNow = 10,
    ): array {
        $timeNow = max(1, min($totalDays, $defaultTimeNow));
        $latestPercent = null;
        $latestReportDate = null;

        if ($reportActuals === []) {
            // First schedule entry is Target Plan only — no Time Now and no delay colors.
            foreach ($barChartTasks as &$task) {
                $task['actualEndDay'] = null;
            }
            unset($task);

            return [
                'tasks' => $barChartTasks,
                'timeNow' => 0,
                'latestPercent' => null,
                'latestReportDate' => null,
            ];
        }

        $startTs = strtotime($projectStartDate) ?: time();
        $latestDate = array_key_last($reportActuals);
        $latestPercent = (float)$reportActuals[$latestDate];
        $latestReportDate = (string)$latestDate;
        $latestTs = strtotime($latestReportDate) ?: $startTs;
        $elapsed = (int)floor(($latestTs - $startTs) / 86400) + 1;
        $timeNow = min(max(1, $elapsed), max(1, $totalDays));

        $achievedDays = (int)round(($latestPercent / 100) * max(1, $totalDays));
        foreach ($barChartTasks as &$task) {
            if (($task['actualEndDay'] ?? null) === null && (int)$task['endDay'] <= $achievedDays) {
                $task['actualEndDay'] = (int)$task['endDay'];
            }
        }
        unset($task);

        return [
            'tasks' => $barChartTasks,
            'timeNow' => $timeNow,
            'latestPercent' => $latestPercent,
            'latestReportDate' => $latestReportDate,
        ];
    }

    /**
     * Parse report period / week fields into Y-m-d (week start when ISO week is used).
     */
    public static function parseReportDate(mixed $raw, string $fallbackCreatedAt = ''): ?string
    {
        $value = trim((string)$raw);
        if ($value === '') {
            $value = trim($fallbackCreatedAt);
        }
        if ($value === '') {
            return null;
        }

        if (preg_match('/^(\d{4})-W(\d{1,2})$/i', $value, $m)) {
            $dt = new \DateTimeImmutable('now');
            $dt = $dt->setISODate((int)$m[1], (int)$m[2]);
            return $dt->format('Y-m-d');
        }

        $ts = strtotime($value);
        if ($ts !== false) {
            return date('Y-m-d', $ts);
        }

        if ($fallbackCreatedAt !== '') {
            $fallbackTs = strtotime($fallbackCreatedAt);
            if ($fallbackTs !== false) {
                return date('Y-m-d', $fallbackTs);
            }
        }

        return null;
    }

    /**
     * @return list<array{reportNumber:string,reportType:string,date:string,percent:float,label:string,status:string}>
     */
    public static function reportProgressEntries(PDO $pdo, int $projectId): array
    {
        try {
            $stmt = $pdo->prepare(
                "SELECT report_number, report_type, report_data, line_items, status, created_at
                 FROM swa_stewa_reports
                 WHERE project_id = ?
                   AND report_type IN ('SWA', 'STEWA', 'IAR')
                   AND status IN ('approved', 'generated')
                 ORDER BY created_at ASC, id ASC"
            );
            $stmt->execute([$projectId]);
            $rows = $stmt->fetchAll();
        } catch (\Throwable) {
            return [];
        }

        $entries = [];
        foreach ($rows as $row) {
            $data = json_decode((string)($row['report_data'] ?? '{}'), true);
            if (!is_array($data)) {
                $data = [];
            }

            $date = self::parseReportDate(
                $data['report_date']
                    ?? $data['period_covered']
                    ?? $data['week_covered']
                    ?? $data['period']
                    ?? null,
                (string)$row['created_at'],
            );
            if ($date === null) {
                continue;
            }

            $pct = self::progressPercentFromReport(
                (string)$row['report_type'],
                $data,
                $row['line_items'] ?? null,
            );
            if ($pct === null) {
                continue;
            }

            $type = (string)$row['report_type'];
            $entries[] = [
                'reportNumber' => (string)$row['report_number'],
                'reportType' => $type,
                'date' => $date,
                'percent' => $pct,
                'label' => trim($type . ' · ' . (string)$row['report_number']),
                'status' => (string)$row['status'],
            ];
        }

        usort($entries, static fn(array $a, array $b) => [$a['date'], $a['reportNumber']] <=> [$b['date'], $b['reportNumber']]);
        return $entries;
    }

    /**
     * Actual progress points derived from SWA, STEWA, and IAR reports for a project,
     * keyed by Y-m-d date. Later reports on the same date override earlier ones.
     * This lets the S-curve and bar chart update automatically as weekly reports
     * are added, without manual data entry.
     *
     * @return array<string, float>
     */
    public static function actualPointsFromReports(PDO $pdo, int $projectId): array
    {
        $out = [];
        foreach (self::reportProgressEntries($pdo, $projectId) as $entry) {
            $out[$entry['date']] = $entry['percent'];
        }
        return $out;
    }

    /**
     * Extract overall % complete from a report payload.
     * SWA uses work-item weighted accomplishment; STEWA/IAR use percent fields.
     */
    public static function progressPercentFromReport(
        string $reportType,
        array $data,
        mixed $lineItemsRaw = null,
    ): ?float {
        $pct = null;

        if ($reportType === 'STEWA') {
            $pct = $data['percent_actual'] ?? $data['percent_complete'] ?? null;
        } elseif ($reportType === 'IAR') {
            $pct = $data['actual_progress']
                ?? $data['percent_actual']
                ?? $data['percent_complete']
                ?? $data['rev_target']
                ?? null;
        } elseif ($reportType === 'SWA') {
            $totals = $data['computed_totals'] ?? null;
            if (is_array($totals) && isset($totals['totalToDateWeightPct'])) {
                $pct = $totals['totalToDateWeightPct'];
            } else {
                $pct = $data['percent_actual'] ?? $data['percent_complete'] ?? null;
            }

            if (($pct === null || $pct === '') && $lineItemsRaw !== null) {
                $items = is_array($lineItemsRaw)
                    ? $lineItemsRaw
                    : (json_decode((string)$lineItemsRaw, true) ?: []);
                if (is_array($items) && $items !== []) {
                    try {
                        $calc = WorkItemCalculator::compute(
                            $items,
                            \Peo\SwaStewaLinkage::lessAmount($data),
                            \Peo\SwaStewaLinkage::showRevisedQuantity($data),
                        );
                        $pct = $calc['totals']['totalToDateWeightPct'] ?? null;
                    } catch (\Throwable) {
                        $pct = null;
                    }
                }
            }
        }

        if ($pct === null || $pct === '') {
            return null;
        }

        if (is_string($pct)) {
            $pct = str_replace(['%', ','], ['', ''], trim($pct));
        }

        if (!is_numeric($pct)) {
            return null;
        }

        return round(max(0.0, min(100.0, (float)$pct)), 2);
    }

    /** @param array<int, array<string, mixed>> $scheduledActivities */
    public static function sCurveActivitiesFromPdm(
        array $scheduledActivities,
        string $startDate,
        ?string $endDate = null,
        ?int $projectDuration = null,
    ): array {
        if ($scheduledActivities === []) {
            return [];
        }

        $totalDur = array_sum(array_map(fn($a) => (int)($a['duration'] ?? 0), $scheduledActivities)) ?: 1;
        $networkDuration = max(1, $projectDuration ?? (int)max(array_map(fn($a) => (int)($a['ef'] ?? 0), $scheduledActivities)));
        $timeline = self::resolveTimeline($startDate, $endDate, $networkDuration);
        $startKey = $timeline['start_date'];
        $endKey = $timeline['end_date'];
        $calendarDays = $timeline['duration_days'];
        $sorted = $scheduledActivities;
        usort($sorted, static function (array $a, array $b): int {
            $ef = ((int)($a['ef'] ?? 0)) <=> ((int)($b['ef'] ?? 0));
            return $ef !== 0 ? $ef : strcmp((string)($a['number'] ?? ''), (string)($b['number'] ?? ''));
        });

        $done = 0;
        $rows = [];
        foreach ($sorted as $a) {
            $done += (int)($a['duration'] ?? 0);
            $ef = max(0, (int)($a['ef'] ?? 0));
            $es = max(0, (int)($a['es'] ?? 0));
            $rows[] = [
                'number' => (string)($a['number'] ?? ''),
                'name' => (string)($a['name'] ?? ''),
                'duration' => (int)($a['duration'] ?? 0),
                'es' => $es,
                'ef' => $ef,
                'finish_date' => self::mapNetworkDayToDate($startKey, $endKey, $ef, $networkDuration, $calendarDays),
                'planned_pct' => round(min(100.0, ($done / $totalDur) * 100), 2),
                'is_critical' => !empty($a['isCritical']),
            ];
        }

        return $rows;
    }

    public static function loadPdmResult(PDO $pdo, int $projectId): array
    {
        $acts = $pdo->prepare(
            'SELECT id, activity_number AS number, activity_name AS name, duration, es_override, extend_to_end
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
                'esOverride' => $row['es_override'] !== null ? (int)$row['es_override'] : null,
                'extendToEnd' => !empty($row['extend_to_end']),
            ];
        }

        $deps = $pdo->prepare(
            'SELECT from_activity_id AS fromId, to_activity_id AS toId, dependency_type AS type, lag_days AS `lag`
             FROM pdm_dependencies WHERE project_id = ?'
        );
        $deps->execute([$projectId]);
        $dependencies = [];
        foreach ($deps->fetchAll() as $row) {
            $dependencies[] = [
                'fromId' => (string)$row['fromId'],
                'toId' => (string)$row['toId'],
                'type' => $row['type'],
                'lag' => (int)$row['lag'],
            ];
        }

        return self::calculateScheduled($activities, $dependencies);
    }

    public static function projectStartDate(PDO $pdo, int $projectId): string
    {
        return self::projectTimeline($pdo, $projectId)['start_date'];
    }

    /**
     * Calendar window for S-curve Target Plan / Actual Progress.
     * Prefer projects.start_date → projects.planned_end_date; fall back to start + PDM duration.
     *
     * @return array{start_date:string,end_date:string,duration_days:int,planned_end_date:?string}
     */
    public static function projectTimeline(PDO $pdo, int $projectId, int $pdmDuration = 0): array
    {
        $stmt = $pdo->prepare('SELECT start_date, planned_end_date FROM projects WHERE id = ?');
        $stmt->execute([$projectId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $start = trim((string)($row['start_date'] ?? ''));
        if ($start === '' || strtotime($start) === false) {
            $start = date('Y-m-d');
        }
        $plannedEnd = trim((string)($row['planned_end_date'] ?? ''));
        $plannedEnd = ($plannedEnd !== '' && strtotime($plannedEnd) !== false) ? $plannedEnd : null;

        return self::resolveTimeline($start, $plannedEnd, max(0, $pdmDuration)) + [
            'planned_end_date' => $plannedEnd,
        ];
    }

    /**
     * @return array{start_date:string,end_date:string,duration_days:int}
     */
    public static function resolveTimeline(string $startDate, ?string $endDate, int $networkDuration): array
    {
        $startTs = strtotime($startDate) ?: time();
        $startKey = date('Y-m-d', $startTs);
        $networkDuration = max(1, $networkDuration);

        $endTs = $endDate !== null && $endDate !== '' ? strtotime($endDate) : false;
        if ($endTs === false || $endTs < $startTs) {
            $endTs = strtotime("+{$networkDuration} days", $startTs) ?: $startTs;
        }
        $endKey = date('Y-m-d', $endTs);
        $calendarDays = max(1, (int)round(($endTs - $startTs) / 86400));

        return [
            'start_date' => $startKey,
            'end_date' => $endKey,
            'duration_days' => $calendarDays,
        ];
    }

    /** Map a PDM network day (0 = start, duration = finish) onto the project calendar window. */
    public static function mapNetworkDayToDate(
        string $startDate,
        string $endDate,
        int $networkDay,
        int $networkDuration,
        ?int $calendarDays = null,
    ): string {
        $startTs = strtotime($startDate) ?: time();
        $endTs = strtotime($endDate) ?: $startTs;
        $calendarDays = $calendarDays ?? max(1, (int)round(($endTs - $startTs) / 86400));
        $networkDuration = max(1, $networkDuration);
        $networkDay = max(0, min($networkDuration, $networkDay));
        $offset = (int)round(($networkDay / $networkDuration) * $calendarDays);
        return date('Y-m-d', strtotime("+{$offset} days", $startTs) ?: $startTs);
    }

    /** @return array<string, float|null> */
    public static function loadPreservedActuals(PDO $pdo, int $projectId): array
    {
        $stmt = $pdo->prepare(
            'SELECT point_date, actual_pct FROM s_curve_points WHERE project_id = ? AND actual_pct IS NOT NULL'
        );
        $stmt->execute([$projectId]);
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(string)$row['point_date']] = $row['actual_pct'] !== null ? (float)$row['actual_pct'] : null;
        }
        return $map;
    }

    /** @return array<string, float> */
    public static function loadBaselinePlanByDate(PDO $pdo, int $projectId): array
    {
        $stmt = $pdo->prepare(
            "SELECT points_json FROM s_curve_snapshots
             WHERE project_id = ? AND trigger_type = 'baseline'
             ORDER BY captured_at ASC LIMIT 1"
        );
        $stmt->execute([$projectId]);
        $raw = $stmt->fetchColumn();
        if ($raw === false) {
            return [];
        }
        $points = json_decode((string)$raw, true);
        if (!is_array($points)) {
            return [];
        }
        $map = [];
        foreach ($points as $p) {
            $date = (string)($p['point_date'] ?? '');
            if ($date === '') {
                continue;
            }
            $val = $p['original_plan_pct'] ?? $p['current_plan_pct'] ?? null;
            if ($val !== null) {
                $map[$date] = (float)$val;
            }
        }
        return $map;
    }

    /**
     * Keep the frozen Target Plan (original) while updating current plan and actuals.
     *
     * @param array<int, array<string, mixed>> $points
     */
    public static function saveSCurvePoints(PDO $pdo, int $projectId, array $points): void
    {
        $baseline = self::loadBaselinePlanByDate($pdo, $projectId);
        $pdo->prepare('DELETE FROM s_curve_points WHERE project_id = ?')->execute([$projectId]);
        $ins = $pdo->prepare(
            'INSERT INTO s_curve_points (project_id, point_date, original_plan_pct, current_plan_pct, actual_pct)
             VALUES (?, ?, ?, ?, ?)'
        );
        foreach ($points as $p) {
            $date = (string)$p['point_date'];
            $current = $p['current_plan_pct'] ?? $p['original_plan_pct'];
            $original = $baseline[$date] ?? $p['original_plan_pct'] ?? $current;
            $ins->execute([
                $projectId,
                $date,
                $original,
                $current,
                $p['actual_pct'],
            ]);
        }
    }

    /**
     * @param array<int, array<string, mixed>> $points
     * @return array<int, array<string, mixed>>
     */
    public static function mergeBaselineIntoPoints(PDO $pdo, int $projectId, array $points): array
    {
        $baseline = self::loadBaselinePlanByDate($pdo, $projectId);
        if ($baseline === []) {
            return $points;
        }
        foreach ($points as &$point) {
            $date = (string)($point['point_date'] ?? '');
            if (isset($baseline[$date])) {
                $point['original_plan_pct'] = $baseline[$date];
            }
        }
        unset($point);
        return $points;
    }

    /** Planned % at a calendar date by stepping through sorted S-curve points. */
    public static function plannedPercentAtDate(array $points, string $targetDate, string $planKey = 'original_plan_pct'): ?float
    {
        if ($points === []) {
            return null;
        }
        usort($points, static fn(array $a, array $b) => strcmp((string)$a['point_date'], (string)$b['point_date']));
        $latest = null;
        foreach ($points as $point) {
            $date = (string)($point['point_date'] ?? '');
            if ($date > $targetDate) {
                break;
            }
            $val = $point[$planKey] ?? null;
            if ($val !== null) {
                $latest = (float)$val;
            }
        }
        return $latest;
    }

    /**
     * Fill missing Target Plan values on actual-only dates so both curves align for comparison.
     *
     * @param array<int, array<string, mixed>> $points
     * @return array<int, array<string, mixed>>
     */
    public static function enrichPointsWithTargetPlan(array $points): array
    {
        if ($points === []) {
            return [];
        }
        $reference = $points;
        foreach ($points as &$point) {
            if ($point['original_plan_pct'] === null || $point['original_plan_pct'] === '') {
                $date = (string)($point['point_date'] ?? '');
                if ($date !== '') {
                    $planned = self::plannedPercentAtDate($reference, $date, 'original_plan_pct');
                    if ($planned !== null) {
                        $point['original_plan_pct'] = $planned;
                    }
                }
            }
        }
        unset($point);
        return $points;
    }

    /**
     * Target vs Actual at each approved report date.
     *
     * @param array<int, array<string, mixed>> $points
     * @param array<string, float> $reportActuals
     * @return list<array{date:string,date_label:string,target_pct:float,actual_pct:float,variance_pct:float,status:string,status_label:string}>
     */
    public static function comparisonAtReportDates(array $points, array $reportActuals): array
    {
        $rows = [];
        ksort($reportActuals);
        foreach ($reportActuals as $date => $actual) {
            $target = self::plannedPercentAtDate($points, (string)$date, 'original_plan_pct');
            if ($target === null) {
                continue;
            }
            $actualVal = round((float)$actual, 2);
            $targetVal = round($target, 2);
            $variance = round($actualVal - $targetVal, 2);
            $behind = round($targetVal - $actualVal, 2);
            if ($behind > 1.0) {
                $status = 'behind';
                $statusLabel = "{$behind}% behind schedule";
            } elseif ($behind < -1.0) {
                $status = 'ahead';
                $statusLabel = abs($behind) . '% ahead of schedule';
            } else {
                $status = 'on_schedule';
                $statusLabel = 'On schedule';
            }
            $ts = strtotime((string)$date);
            $rows[] = [
                'date' => (string)$date,
                'date_label' => $ts !== false ? date('M j, Y', $ts) : (string)$date,
                'target_pct' => $targetVal,
                'actual_pct' => $actualVal,
                'variance_pct' => $variance,
                'status' => $status,
                'status_label' => $statusLabel,
            ];
        }
        return $rows;
    }

    /**
     * @param array<int, array<string, mixed>> $points
     * @return array{status:string,slippage_pct:?float,planned_pct:?float,actual_pct:?float,label:string}
     */
    public static function computeScheduleStatus(
        array $points,
        ?float $latestActual,
        ?string $latestDate,
    ): array {
        if ($latestActual === null || $latestDate === null) {
            return [
                'status' => 'target_only',
                'slippage_pct' => null,
                'planned_pct' => null,
                'actual_pct' => null,
                'label' => 'Target Plan only — no approved progress yet',
            ];
        }

        $planned = self::plannedPercentAtDate($points, $latestDate, 'original_plan_pct');
        if ($planned === null) {
            return [
                'status' => 'unknown',
                'slippage_pct' => null,
                'planned_pct' => null,
                'actual_pct' => round($latestActual, 2),
                'label' => 'Actual recorded — planned baseline not available at this date',
            ];
        }

        $slippage = round($planned - $latestActual, 2);
        $dateLabel = date('M j, Y', strtotime($latestDate) ?: time());
        if ($slippage > 1.0) {
            $status = 'behind';
            $label = "As of {$dateLabel}: Target {$planned}% · Actual {$latestActual}% — {$slippage}% behind";
        } elseif ($slippage < -1.0) {
            $status = 'ahead';
            $ahead = round(abs($slippage), 2);
            $label = "As of {$dateLabel}: Target {$planned}% · Actual {$latestActual}% — {$ahead}% ahead";
        } else {
            $status = 'on_schedule';
            $label = "As of {$dateLabel}: Target {$planned}% · Actual {$latestActual}% — on schedule";
        }

        return [
            'status' => $status,
            'slippage_pct' => $slippage,
            'planned_pct' => round($planned, 2),
            'actual_pct' => round($latestActual, 2),
            'label' => $label,
        ];
    }

    /** @param array<int, array<string, mixed>> $points */
    public static function hasRevisedSchedule(array $points): bool
    {
        foreach ($points as $point) {
            $orig = $point['original_plan_pct'] ?? null;
            $cur = $point['current_plan_pct'] ?? null;
            if ($orig !== null && $cur !== null && abs((float)$orig - (float)$cur) > 0.01) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param array<int, array<string, mixed>> $points
     * @return list<array<string, mixed>>
     */
    public static function listSCurveSnapshots(PDO $pdo, int $projectId): array
    {
        $stmt = $pdo->prepare(
            "SELECT id, captured_at, trigger_type, trigger_label, schedule_status,
                    slippage_pct, planned_pct, actual_pct
             FROM s_curve_snapshots
             WHERE project_id = ? AND trigger_type != 'baseline'
             ORDER BY captured_at DESC, id DESC
             LIMIT 50"
        );
        $stmt->execute([$projectId]);
        $rows = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $rows[] = [
                'id' => (int)$row['id'],
                'captured_at' => (string)$row['captured_at'],
                'trigger_type' => (string)$row['trigger_type'],
                'trigger_label' => $row['trigger_label'] !== null ? (string)$row['trigger_label'] : null,
                'schedule_status' => $row['schedule_status'] !== null ? (string)$row['schedule_status'] : null,
                'slippage_pct' => $row['slippage_pct'] !== null ? (float)$row['slippage_pct'] : null,
                'planned_pct' => $row['planned_pct'] !== null ? (float)$row['planned_pct'] : null,
                'actual_pct' => $row['actual_pct'] !== null ? (float)$row['actual_pct'] : null,
            ];
        }
        return $rows;
    }

    /** @return array<int, array<string, mixed>>|null */
    public static function loadSCurveSnapshotPoints(PDO $pdo, int $projectId, int $snapshotId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT points_json FROM s_curve_snapshots WHERE id = ? AND project_id = ? LIMIT 1'
        );
        $stmt->execute([$snapshotId, $projectId]);
        $raw = $stmt->fetchColumn();
        if ($raw === false) {
            return null;
        }
        $points = json_decode((string)$raw, true);
        return is_array($points) ? $points : null;
    }

    /**
     * @param array<int, array<string, mixed>> $points
     */
    public static function captureSCurveSnapshot(
        PDO $pdo,
        int $projectId,
        array $points,
        string $triggerType,
        ?string $triggerLabel = null,
        ?array $status = null,
    ): void {
        if ($points === []) {
            return;
        }

        $status ??= self::computeScheduleStatus($points, null, null);
        $stmt = $pdo->prepare(
            'INSERT INTO s_curve_snapshots
             (project_id, trigger_type, trigger_label, schedule_status, slippage_pct, planned_pct, actual_pct, points_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $projectId,
            $triggerType,
            $triggerLabel,
            $status['status'] ?? null,
            $status['slippage_pct'] ?? null,
            $status['planned_pct'] ?? null,
            $status['actual_pct'] ?? null,
            json_encode($points),
        ]);
    }

    /** Freeze the first schedule as the Target Plan baseline (once per project). */
    public static function ensureBaselineSnapshot(PDO $pdo, int $projectId, array $points): void
    {
        $stmt = $pdo->prepare(
            "SELECT id FROM s_curve_snapshots WHERE project_id = ? AND trigger_type = 'baseline' LIMIT 1"
        );
        $stmt->execute([$projectId]);
        if ($stmt->fetchColumn() !== false || $points === []) {
            return;
        }
        self::captureSCurveSnapshot($pdo, $projectId, $points, 'baseline', 'Original Target Plan');
    }

    /** @param array<int, array<string, mixed>> $activities */
    /** @param array<int, array<string, mixed>> $dependencies */
    public static function calculateScheduled(array $activities, array $dependencies): array
    {
        if ($activities === []) {
            return ['activities' => [], 'projectDuration' => 0, 'criticalPath' => []];
        }
        $pdm = PdmSchedule::calculate($activities, $dependencies);
        if (isset($pdm['error'])) {
            return ['activities' => $activities, 'projectDuration' => 0, 'criticalPath' => [], 'error' => $pdm['error']];
        }
        return $pdm;
    }

    public static function syncDerivedViews(
        PDO $pdo,
        int $projectId,
        array $pdmResult,
        array $actualEndByName = [],
        ?string $snapshotTrigger = null,
        ?string $snapshotLabel = null,
    ): void {
        $scheduled = $pdmResult['activities'] ?? [];
        $pdmDuration = max(1, (int)($pdmResult['projectDuration'] ?? 0));
        $reportActuals = self::actualPointsFromReports($pdo, $projectId);
        $hasActual = $reportActuals !== [];
        $actuals = $hasActual ? $reportActuals : [];
        $timeline = self::projectTimeline($pdo, $projectId, $pdmDuration);
        $startDate = $timeline['start_date'];
        $endDate = $timeline['end_date'];
        $duration = $timeline['duration_days'];
        if ($scheduled !== [] && self::isReferenceProject($pdo, $projectId)) {
            $points = self::sCurveFromReferenceTargets($startDate, $pdmDuration, $actuals, null, $endDate);
        } else {
            $points = self::sCurveFromPdm($scheduled, $startDate, $pdmDuration, $actuals, $endDate);
        }
        if (!$hasActual) {
            foreach ($points as &$point) {
                $point['actual_pct'] = null;
            }
            unset($point);
        }

        $hadBaseline = self::loadBaselinePlanByDate($pdo, $projectId) !== [];
        self::ensureBaselineSnapshot($pdo, $projectId, $points);
        $points = self::mergeBaselineIntoPoints($pdo, $projectId, $points);
        self::saveSCurvePoints($pdo, $projectId, $points);

        $latestDate = $hasActual ? array_key_last($reportActuals) : null;
        $latestActual = $hasActual ? (float)$reportActuals[$latestDate] : null;
        $status = self::computeScheduleStatus($points, $latestActual, $latestDate);

        if ($snapshotTrigger !== null) {
            self::captureSCurveSnapshot($pdo, $projectId, $points, $snapshotTrigger, $snapshotLabel, $status);
        } elseif ($hadBaseline) {
            self::captureSCurveSnapshot($pdo, $projectId, $points, 'schedule_update', 'Schedule revised', $status);
        }
    }

    public static function isReferenceProject(PDO $pdo, int $projectId): bool
    {
        $stmt = $pdo->prepare('SELECT name FROM projects WHERE id = ?');
        $stmt->execute([$projectId]);
        $name = (string)($stmt->fetchColumn() ?: '');
        return str_contains($name, 'Remebella')
            || str_contains($name, 'Concreting of Barangay Road');
    }
}
