<?php
declare(strict_types=1);

namespace Peo;

/**
 * Tracks contractor edits on SWA/STEWA for Engineer I review.
 */
class ReportChangeTracker
{
    private const TRACKED_SCALAR = [
        'project_name', 'location', 'contract_amount', 'contractor',
        'report_date', 'period_covered', 'notice_to_proceed', 'percent_actual', 'percent_planned',
    ];

    /** @param array<string, mixed> $before */
    /** @param array<string, mixed> $after */
    /** @param list<array<string, mixed>>|null $lineItemsBefore */
    /** @param list<array<string, mixed>>|null $lineItemsAfter */
    public static function diff(
        array $before,
        ?array $lineItemsBefore,
        array $after,
        ?array $lineItemsAfter,
    ): array {
        $changes = [];
        foreach (self::TRACKED_SCALAR as $key) {
            $old = isset($before[$key]) ? trim((string)$before[$key]) : '';
            $new = isset($after[$key]) ? trim((string)$after[$key]) : '';
            if ($old !== $new) {
                $changes[] = [
                    'field' => $key,
                    'label' => ucwords(str_replace('_', ' ', $key)),
                    'old' => $old,
                    'new' => $new,
                ];
            }
        }

        if ($lineItemsBefore !== null && $lineItemsAfter !== null) {
            $max = max(count($lineItemsBefore), count($lineItemsAfter));
            for ($i = 0; $i < $max; $i++) {
                $b = $lineItemsBefore[$i] ?? null;
                $a = $lineItemsAfter[$i] ?? null;
                if ($b === null || $a === null) {
                    continue;
                }
                foreach (['itemNo', 'description', 'unit', 'unitPrice', 'programmedQty', 'revisedQty', 'previous', 'thisPeriod'] as $f) {
                    $old = isset($b[$f]) ? trim((string)$b[$f]) : '';
                    $new = isset($a[$f]) ? trim((string)$a[$f]) : '';
                    if ($old !== $new) {
                        $itemNo = (string)($a['itemNo'] ?? $b['itemNo'] ?? ('Row ' . ($i + 1)));
                        $changes[] = [
                            'field' => "line_items.{$i}.{$f}",
                            'label' => "Line item {$itemNo} — " . ucwords(preg_replace('/([A-Z])/', ' $1', $f) ?? $f),
                            'old' => $old,
                            'new' => $new,
                        ];
                    }
                }
            }
        }

        return $changes;
    }
}
