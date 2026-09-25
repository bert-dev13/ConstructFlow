<?php
declare(strict_types=1);

namespace Peo;

class WorkItemCalculator
{
    public static function compute(array $items, float $advancePayment = 0, bool $showRevised = false): array
    {
        // Section headings stay on the form but do not enter Total Project Cost.
        $billable = array_values(array_filter(
            $items,
            static fn (array $item): bool => !self::isSectionRow($item),
        ));
        $totalProjectCost = 0.0;
        foreach ($billable as $item) {
            $totalProjectCost += (float)($item['unitPrice'] ?? 0) * (float)($item['programmedQty'] ?? 0);
        }

        $totalRevised = 0.0;
        if ($showRevised) {
            foreach ($billable as $item) {
                $unitPrice = (float)($item['unitPrice'] ?? 0);
                $programmedQty = (float)($item['programmedQty'] ?? 0);
                $revisedQty = (float)($item['revisedQty'] ?? $item['revised_qty'] ?? 0);
                $totalRevised += $revisedQty > 0 ? $unitPrice * $revisedQty : $unitPrice * $programmedQty;
            }
        }

        $computed = [];
        foreach ($items as $item) {
            if (self::isSectionRow($item)) {
                $computed[] = array_merge($item, [
                    'previous' => round((float)($item['previous'] ?? 0), 2),
                    'thisPeriod' => 0.0,
                    'revisedQty' => round((float)($item['revisedQty'] ?? $item['revised_qty'] ?? 0), 2),
                    'contractAmount' => 0.0,
                    'weightPct' => 0.0,
                    'revisedAmount' => 0.0,
                    'revisedWeightPct' => 0.0,
                    'toDate' => 0.0,
                    'accomplishmentWeightPct' => 0.0,
                    'status' => '',
                    'remarks' => trim((string)($item['remarks'] ?? '')) !== '' ? $item['remarks'] : '',
                    'isSection' => true,
                ]);
                continue;
            }
            $unitPrice = (float)($item['unitPrice'] ?? 0);
            $programmedQty = (float)($item['programmedQty'] ?? 0);
            $revisedQty = (float)($item['revisedQty'] ?? $item['revised_qty'] ?? 0);
            $previous = (float)($item['previous'] ?? 0);

            $contractAmount = $unitPrice * $programmedQty;
            // WEIGHT % = (Contract Amount / Total Project Cost) × 100
            $weightPct = self::weightPct($contractAmount, $totalProjectCost);
            $useRevised = $showRevised && $revisedQty > 0;
            $revisedAmount = $useRevised
                ? $unitPrice * $revisedQty
                : ($showRevised ? $contractAmount : 0.0);
            $revisedWeightPct = $showRevised
                ? self::weightPct($revisedAmount, $totalRevised)
                : 0.0;

            // L.S.: (Prog. Qty / 2) × Unit Price. Other units: Contract Amount.
            $unit = (string)($item['snapshotUnit'] ?? $item['unit'] ?? '');
            $toDate = self::toDateAmount($programmedQty, $unitPrice, $unit);
            // THIS PERIOD = TO DATE − PREVIOUS
            $thisPeriod = $toDate - $previous;

            // WEIGHT % ACCOMPLISHMENT = (TO DATE / Total Project Cost) × 100
            $accomplishmentWeightPct = self::weightPct($toDate, $totalProjectCost);
            $plannedWeight = $useRevised ? $revisedWeightPct : $weightPct;
            $status = self::remarksStatus($accomplishmentWeightPct, $plannedWeight);

            $computed[] = array_merge($item, [
                'previous' => round($previous, 2),
                'thisPeriod' => round($thisPeriod, 2),
                'revisedQty' => round($revisedQty, 2),
                'contractAmount' => round($contractAmount, 2),
                'weightPct' => round($weightPct, 2),
                'revisedAmount' => round($revisedAmount, 2),
                'revisedWeightPct' => round($revisedWeightPct, 2),
                'toDate' => round($toDate, 2),
                'accomplishmentWeightPct' => round($accomplishmentWeightPct, 2),
                'status' => $status,
                'remarks' => $status,
            ]);
        }

        $billableComputed = array_values(array_filter(
            $computed,
            static fn (array $row): bool => empty($row['isSection']),
        ));
        $totalToDateWeightPct = array_sum(array_column($billableComputed, 'accomplishmentWeightPct'));
        $totalThisAccomplishment = 0.0;
        foreach ($billableComputed as $row) {
            $totalThisAccomplishment += (float)$row['thisPeriod'];
        }
        $pctThisAccomplishment = $totalProjectCost > 0
            ? ($totalThisAccomplishment / $totalProjectCost) * 100
            : 0;

        return [
            'items' => $computed,
            'totals' => [
                'totalContractAmount' => round($totalProjectCost, 2),
                'totalWeightPct' => round(array_sum(array_column($billableComputed, 'weightPct')), 2),
                'totalRevisedAmount' => round(array_sum(array_column($billableComputed, 'revisedAmount')), 2),
                'totalRevisedWeightPct' => round(array_sum(array_column($billableComputed, 'revisedWeightPct')), 2),
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

    /** Roman-numeral headings such as "I. OTHER GENERAL REQUIREMENTS", "II.", or "III.". */
    private static function isSectionRow(array $item): bool
    {
        $itemNo = trim((string)($item['snapshotItemNo'] ?? $item['itemNo'] ?? $item['item_no'] ?? ''));
        $description = trim((string)($item['snapshotDescription'] ?? $item['description'] ?? ''));
        if (self::isSectionHeading($itemNo)) {
            return true;
        }
        return $itemNo === '' && self::isSectionHeading($description);
    }

    private static function isSectionHeading(string $text): bool
    {
        $text = trim($text);
        if ($text === '') {
            return false;
        }
        if (preg_match('/^[IVXLCDM]+(?:\s*[.\-:\x{2013}\x{2014}])?\s*$/iu', $text)) {
            return self::isRomanNumeral((string)preg_replace('/[^IVXLCDM]/i', '', $text));
        }
        if (preg_match('/^([IVXLCDM]+)\s*[.\-:\x{2013}\x{2014}]\s+[A-Za-z]/u', $text, $match)) {
            return self::isRomanNumeral($match[1]);
        }
        return false;
    }

    private static function isRomanNumeral(string $token): bool
    {
        return (bool)preg_match(
            '/^(?=[IVXLCDM])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i',
            $token,
        );
    }

    /** L.S. uses half the contract. Every other unit uses the full contract amount. */
    private static function toDateAmount(float $programmedQty, float $unitPrice, string $unit): float
    {
        if (self::isLumpSumUnit($unit)) {
            return ($programmedQty / 2.0) * $unitPrice;
        }
        return $programmedQty * $unitPrice;
    }

    private static function isLumpSumUnit(string $unit): bool
    {
        $normalized = strtolower((string)preg_replace('/[^a-z]/', '', $unit));
        return $normalized === 'ls' || $normalized === 'lumpsum';
    }

    /**
     * Excel: ROUND(amount / Total Contract Amount, 5), then × 100 for the percent.
     */
    private static function weightPct(float $amount, float $totalProjectCost): float
    {
        if ($totalProjectCost <= 0) {
            return 0.0;
        }
        $rounded = round($amount / $totalProjectCost, 5);
        return $rounded * 100;
    }

    /**
     * Excel: IF(L=H,"COMPLETED",IF(L=0,"Not Yet Started","On going"))
     */
    public static function remarksStatus(float $accomplishmentWeightPct, float $weightPct): string
    {
        $accompFrac = round($accomplishmentWeightPct / 100, 5);
        $plannedFrac = round($weightPct / 100, 5);
        if ($accompFrac == 0.0) {
            return 'Not Yet Started';
        }
        if ($plannedFrac > 0 && $accompFrac == $plannedFrac) {
            return 'COMPLETED';
        }
        return 'On going';
    }
}
