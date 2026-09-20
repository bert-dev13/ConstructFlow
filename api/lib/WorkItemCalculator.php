<?php
declare(strict_types=1);

namespace Peo;

class WorkItemCalculator
{
    public static function compute(array $items, float $advancePayment = 0, bool $showRevised = false): array
    {
        $totalContract = 0.0;
        foreach ($items as $item) {
            $totalContract += (float)($item['unitPrice'] ?? 0) * (float)($item['programmedQty'] ?? 0);
        }

        $totalRevised = 0.0;
        if ($showRevised) {
            foreach ($items as $item) {
                $unitPrice = (float)($item['unitPrice'] ?? 0);
                $programmedQty = (float)($item['programmedQty'] ?? 0);
                $revisedQty = (float)($item['revisedQty'] ?? $item['revised_qty'] ?? 0);
                $totalRevised += $revisedQty > 0 ? $unitPrice * $revisedQty : $unitPrice * $programmedQty;
            }
        }

        $computed = [];
        foreach ($items as $item) {
            $unitPrice = (float)($item['unitPrice'] ?? 0);
            $programmedQty = (float)($item['programmedQty'] ?? 0);
            $revisedQty = (float)($item['revisedQty'] ?? $item['revised_qty'] ?? 0);
            $previous = (float)($item['previous'] ?? 0);
            $thisPeriod = (float)($item['thisPeriod'] ?? 0);

            $contractAmount = $unitPrice * $programmedQty;
            $weightPct = $totalContract > 0 ? ($contractAmount / $totalContract) * 100 : 0;
            $useRevised = $showRevised && $revisedQty > 0;
            $revisedAmount = $useRevised
                ? $unitPrice * $revisedQty
                : ($showRevised ? $contractAmount : 0.0);
            $revisedWeightPct = ($showRevised && $totalRevised > 0)
                ? ($revisedAmount / $totalRevised) * 100
                : 0.0;

            $toDate = $previous + $thisPeriod;
            $baseQty = $useRevised ? $revisedQty : $programmedQty;
            $plannedWeight = $useRevised ? $revisedWeightPct : $weightPct;
            $accomplishmentWeightPct = $baseQty > 0 ? ($toDate / $baseQty) * $plannedWeight : 0;
            $status = self::remarksStatus($accomplishmentWeightPct, $plannedWeight);

            $computed[] = array_merge($item, [
                'revisedQty' => round($revisedQty, 2),
                'contractAmount' => round($contractAmount, 2),
                'weightPct' => round($weightPct, 2),
                'revisedAmount' => round($revisedAmount, 2),
                'revisedWeightPct' => round($revisedWeightPct, 2),
                'toDate' => round($toDate, 2),
                'accomplishmentWeightPct' => round($accomplishmentWeightPct, 2),
                'status' => $status,
            ]);
        }

        $totalToDateWeightPct = array_sum(array_column($computed, 'accomplishmentWeightPct'));
        $totalThisAccomplishment = 0.0;
        foreach ($computed as $row) {
            $totalThisAccomplishment += (float)$row['thisPeriod'] * (float)$row['unitPrice'];
        }
        $pctThisAccomplishment = $totalContract > 0 ? ($totalThisAccomplishment / $totalContract) * 100 : 0;

        return [
            'items' => $computed,
            'totals' => [
                'totalContractAmount' => round($totalContract, 2),
                'totalWeightPct' => round(array_sum(array_column($computed, 'weightPct')), 2),
                'totalRevisedAmount' => round(array_sum(array_column($computed, 'revisedAmount')), 2),
                'totalRevisedWeightPct' => round(array_sum(array_column($computed, 'revisedWeightPct')), 2),
                'totalToDateWeightPct' => round($totalToDateWeightPct, 2),
                'pctThisAccomplishment' => round($pctThisAccomplishment, 2),
                'totalThisAccomplishment' => round($totalThisAccomplishment, 2),
                'totalVoucher' => round($totalThisAccomplishment - $advancePayment, 2),
            ],
        ];
    }

    public static function formatMoney(float $n): string
    {
        return number_format($n, 2, '.', ',');
    }

    public static function remarksStatus(float $accomplishmentWeightPct, float $weightPct): string
    {
        if ($accomplishmentWeightPct <= 0) {
            return 'Not yet started.';
        }
        if ($weightPct > 0 && abs($accomplishmentWeightPct - $weightPct) < 0.005) {
            return 'COMPLETED.';
        }
        return 'ON-GOING.';
    }
}
