<?php
declare(strict_types=1);

namespace Peo;

use PDO;

/**
 * Links STEWA progress fields to the SWA report on the same date.
 */
class SwaStewaLinkage
{
    public static function lessAmount(array $data): float
    {
        if (isset($data['less_amount']) && $data['less_amount'] !== '' && $data['less_amount'] !== null) {
            return (float)$data['less_amount'];
        }
        return (float)($data['advance_payment'] ?? 0);
    }

    public static function lessReason(array $data): string
    {
        $reason = trim((string)($data['less_reason'] ?? ''));
        if ($reason !== '') {
            return $reason;
        }
        return self::lessAmount($data) > 0 ? 'Advance Payment' : '';
    }

    /** Whether SWA should include REVISED quantity/amount/weight columns. */
    public static function showRevisedQuantity(array $data): bool
    {
        $v = $data['show_revised_quantity'] ?? $data['showRevisedQuantity'] ?? false;
        if (is_bool($v)) {
            return $v;
        }
        if (is_int($v) || is_float($v)) {
            return ((float)$v) !== 0.0;
        }
        $s = strtolower(trim((string)$v));
        return in_array($s, ['1', 'true', 'yes', 'on'], true);
    }

    public static function stewaSlippage(float $actual, float $planned): float
    {
        return round($actual - $planned, 2);
    }

    /**
     * @return array{percent_actual: float|null, percent_planned: float|null, swa_report_number: string|null}
     */
    public static function stewaPercentsFromSwa(PDO $pdo, int $projectId, string $stewaDate): array
    {
        $swa = self::findSwaForDate($pdo, $projectId, $stewaDate);
        if ($swa === null) {
            return [
                'percent_actual' => null,
                'percent_planned' => null,
                'swa_report_number' => null,
            ];
        }

        return array_merge(
            self::swaProgressPercents($pdo, $projectId, $swa),
            ['swa_report_number' => (string)$swa['report_number']],
        );
    }

    /**
     * @param array<string, mixed> $reportData
     * @return array<string, mixed>
     */
    public static function applyStewaFromSwa(PDO $pdo, int $projectId, array $reportData): array
    {
        $date = ScheduleSync::parseReportDate($reportData['report_date'] ?? null);
        if ($date === null) {
            return $reportData;
        }

        $fromSwa = self::stewaPercentsFromSwa($pdo, $projectId, $date);
        if ($fromSwa['percent_actual'] !== null) {
            $reportData['percent_actual'] = $fromSwa['percent_actual'];
        }
        if ($fromSwa['percent_planned'] !== null) {
            $reportData['percent_planned'] = $fromSwa['percent_planned'];
        }
        if ($fromSwa['swa_report_number'] !== null) {
            $reportData['swa_source_report'] = $fromSwa['swa_report_number'];
        }

        $actual = (float)($reportData['percent_actual'] ?? 0);
        $planned = (float)($reportData['percent_planned'] ?? 0);
        $reportData['slippage'] = self::stewaSlippage($actual, $planned);

        return $reportData;
    }

    /**
     * Store planned/actual % on SWA for STEWA to reference.
     *
     * @param array<string, mixed> $reportData
     * @param array<int, array<string, mixed>> $lineItems
     * @return array<string, mixed>
     */
    public static function enrichSwaReportData(PDO $pdo, int $projectId, array $reportData, array $lineItems): array
    {
        $less = self::lessAmount($reportData);
        if ($lineItems !== []) {
            $calc = WorkItemCalculator::compute(
                $lineItems,
                $less,
                self::showRevisedQuantity($reportData),
            );
            $reportData['computed_totals'] = $calc['totals'];
            $reportData['percent_actual'] = $calc['totals']['totalToDateWeightPct'];
        }

        $reportDate = ScheduleSync::parseReportDate($reportData['report_date'] ?? null);
        if ($reportDate !== null) {
            $reportData['percent_planned'] = self::plannedPercentForProjectDate($pdo, $projectId, $reportDate);
        }

        return $reportData;
    }

    public static function plannedPercentForProjectDate(PDO $pdo, int $projectId, string $date): float
    {
        $pdm = ScheduleSync::loadPdmResult($pdo, $projectId);
        $scheduled = $pdm['activities'] ?? [];
        if ($scheduled === []) {
            return 0.0;
        }

        $pdmDuration = max(1, (int)($pdm['projectDuration'] ?? 0));
        $timeline = ScheduleSync::projectTimeline($pdo, $projectId, $pdmDuration);
        if (ScheduleSync::isReferenceProject($pdo, $projectId)) {
            $points = ScheduleSync::sCurveFromReferenceTargets(
                $timeline['start_date'],
                $pdmDuration,
                [],
                null,
                $timeline['end_date'],
            );
        } else {
            $points = ScheduleSync::sCurveFromPdm(
                $scheduled,
                $timeline['start_date'],
                $pdmDuration,
                [],
                $timeline['end_date'],
            );
        }
        $points = ScheduleSync::mergeBaselineIntoPoints($pdo, $projectId, $points);

        return ScheduleSync::plannedPercentAtDate($points, $date, 'original_plan_pct') ?? 0.0;
    }

    /** @return array<string, mixed>|null */
    private static function findSwaForDate(PDO $pdo, int $projectId, string $targetDate): ?array
    {
        $stmt = $pdo->prepare(
            "SELECT report_number, report_data, line_items
             FROM swa_stewa_reports
             WHERE project_id = ? AND report_type = 'SWA'
             ORDER BY updated_at DESC, id DESC"
        );
        $stmt->execute([$projectId]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $data = json_decode((string)($row['report_data'] ?? '{}'), true);
            if (!is_array($data)) {
                continue;
            }
            $date = ScheduleSync::parseReportDate(
                $data['report_date'] ?? $data['period_covered'] ?? null,
            );
            if ($date === $targetDate) {
                return $row;
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $swaRow
     * @return array{percent_actual: float|null, percent_planned: float|null}
     */
    private static function swaProgressPercents(PDO $pdo, int $projectId, array $swaRow): array
    {
        $data = json_decode((string)($swaRow['report_data'] ?? '{}'), true);
        if (!is_array($data)) {
            $data = [];
        }

        $lineItems = json_decode((string)($swaRow['line_items'] ?? '[]'), true);
        if (!is_array($lineItems)) {
            $lineItems = [];
        }

        $actual = null;
        $totals = $data['computed_totals'] ?? null;
        if (is_array($totals) && isset($totals['totalToDateWeightPct'])) {
            $actual = (float)$totals['totalToDateWeightPct'];
        } elseif ($lineItems !== []) {
            $calc = WorkItemCalculator::compute(
                $lineItems,
                self::lessAmount($data),
                self::showRevisedQuantity($data),
            );
            $actual = (float)$calc['totals']['totalToDateWeightPct'];
        } elseif (isset($data['percent_actual']) && $data['percent_actual'] !== '') {
            $actual = (float)$data['percent_actual'];
        }

        $planned = null;
        if (isset($data['percent_planned']) && $data['percent_planned'] !== '') {
            $planned = (float)$data['percent_planned'];
        } else {
            $reportDate = ScheduleSync::parseReportDate($data['report_date'] ?? null);
            if ($reportDate !== null) {
                $planned = self::plannedPercentForProjectDate($pdo, $projectId, $reportDate);
            }
        }

        return [
            'percent_actual' => $actual,
            'percent_planned' => $planned,
        ];
    }
}
