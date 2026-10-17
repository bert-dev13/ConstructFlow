<?php
declare(strict_types=1);

namespace Peo;

/**
 * PDM forward/backward pass.
 * Day 0 baseline; first activity ES = 0; EF = ES + Duration.
 * FS/SS/FF/SF with lag (lead = negative lag). Multiple predecessors: latest required date.
 * Critical when total float (LS − ES / LF − EF) is 0.
 */
class PdmSchedule
{
    /** @param array<int, array<string, mixed>> $activities */
    /** @param array<int, array<string, mixed>> $dependencies */
    public static function calculate(array $activities, array $dependencies): array
    {
        $map = [];
        foreach ($activities as $a) {
            $map[(string)$a['id']] = $a;
        }

        $preds = [];
        $succs = [];
        foreach ($dependencies as $dep) {
            $from = (string)$dep['fromId'];
            $to = (string)$dep['toId'];
            $preds[$to][] = $dep;
            $succs[$from][] = $dep;
        }

        $inDegree = array_fill_keys(array_keys($map), 0);
        $adj = array_fill_keys(array_keys($map), []);
        foreach ($dependencies as $dep) {
            $from = (string)$dep['fromId'];
            $to = (string)$dep['toId'];
            $adj[$from][] = $to;
            $inDegree[$to]++;
        }

        $queue = array_keys(array_filter($inDegree, fn($d) => $d === 0));
        $topo = [];
        while ($queue) {
            $id = array_shift($queue);
            $topo[] = $id;
            foreach ($adj[$id] ?? [] as $next) {
                $inDegree[$next]--;
                if ($inDegree[$next] === 0) {
                    $queue[] = $next;
                }
            }
        }

        if (count($topo) !== count($map)) {
            return ['error' => 'Circular dependency detected'];
        }

        if ($map === []) {
            return ['activities' => [], 'projectDuration' => 0, 'criticalPath' => []];
        }

        foreach ($topo as $id) {
            $incoming = $preds[$id] ?? [];
            $extends = !empty($map[$id]['extendToEnd']) || !empty($map[$id]['extend_to_end']);
            $duration = $extends ? 1 : max(1, (int)$map[$id]['duration']);
            if ($incoming === []) {
                $es = 0;
            } else {
                $es = null;
                foreach ($incoming as $dep) {
                    $pred = $map[(string)$dep['fromId']];
                    $required = self::requiredSuccessorEs(
                        (string)($dep['type'] ?? 'FS'),
                        (int)($pred['es'] ?? 0),
                        (int)($pred['ef'] ?? 0),
                        $duration,
                        (int)($dep['lag'] ?? 0),
                    );
                    $es = $es === null ? $required : max($es, $required);
                }
                $es = (int)$es;
            }

            // Early Start (ES) override:
            // - No predecessor: use the typed day (0 = project start).
            // - Has predecessor: cannot start earlier than the formula; typed day may delay start.
            $override = self::normalizeRootEsOverride(
                $map[$id]['esOverride'] ?? $map[$id]['es_override'] ?? null,
                $incoming !== [],
            );
            if ($override !== null && $override !== '') {
                $day = (int)$override;
                if ($day >= 0) {
                    $es = $incoming === [] ? $day : max($es, $day);
                    $map[$id]['esOverride'] = $day;
                }
            }

            $map[$id]['es'] = $es;
            $map[$id]['duration'] = $duration;
            $map[$id]['ef'] = $es + $duration;
            $map[$id]['extendToEnd'] = $extends;
        }

        $coreEnds = [];
        foreach ($map as $a) {
            if (empty($a['extendToEnd'])) {
                $coreEnds[] = (int)$a['ef'];
            }
        }
        $projectEnd = $coreEnds !== []
            ? (int)max($coreEnds)
            : (int)max(array_column($map, 'ef') ?: [0]);

        foreach ($map as $id => &$row) {
            if (empty($row['extendToEnd'])) {
                continue;
            }
            $es = (int)$row['es'];
            $row['duration'] = max(1, $projectEnd - $es);
            $row['ef'] = $es + $row['duration'];
        }
        unset($row);

        $efValues = array_column($map, 'ef');
        $projectEnd = $efValues !== [] ? (int)max($efValues) : $projectEnd;

        foreach (array_reverse($topo) as $id) {
            $outgoing = $succs[$id] ?? [];
            $duration = (int)$map[$id]['duration'];
            if ($outgoing === []) {
                $map[$id]['lf'] = $projectEnd;
                $map[$id]['ls'] = $projectEnd - $duration;
            } else {
                $ls = null;
                foreach ($outgoing as $dep) {
                    $succ = $map[(string)$dep['toId']];
                    $required = self::requiredPredecessorLs(
                        (string)($dep['type'] ?? 'FS'),
                        (int)($succ['ls'] ?? $projectEnd),
                        (int)($succ['lf'] ?? $projectEnd),
                        $duration,
                        (int)($dep['lag'] ?? 0),
                    );
                    $ls = $ls === null ? $required : min($ls, $required);
                }
                $map[$id]['ls'] = (int)$ls;
                $map[$id]['lf'] = (int)$ls + $duration;
            }
            // Critical when total float is zero: (LF − EF) = 0 and (LS − ES) = 0.
            $es = (int)$map[$id]['es'];
            $ef = (int)$map[$id]['ef'];
            $lsVal = (int)$map[$id]['ls'];
            $lfVal = (int)$map[$id]['lf'];
            $extends = !empty($map[$id]['extendToEnd']);
            $map[$id]['isCritical'] = !$extends && ($lfVal - $ef) === 0 && ($lsVal - $es) === 0;
        }

        self::normalizeScheduleOriginToZero($map);

        $critical = array_values(array_filter($map, fn($a) => !empty($a['isCritical'])));
        usort($critical, static fn($a, $b) => ((int)($a['es'] ?? 0)) <=> ((int)($b['es'] ?? 0)));

        return [
            'activities' => array_values($map),
            'projectDuration' => $projectEnd,
            'criticalPath' => self::longestCriticalChain($map, $preds, $projectEnd),
        ];
    }

    /**
     * One continuous critical chain (paper style), not every zero-float parallel activity.
     *
     * @param array<string, array<string, mixed>> $map
     * @param array<string, list<array<string, mixed>>> $preds
     * @return list<string>
     */
    private static function longestCriticalChain(array $map, array $preds, int $projectEnd): array
    {
        $terminals = array_filter(
            $map,
            static fn(array $a): bool => !empty($a['isCritical']) && (int)($a['ef'] ?? 0) === $projectEnd,
        );
        if ($terminals === []) {
            return array_column(
                array_values(array_filter($map, static fn(array $a): bool => !empty($a['isCritical']))),
                'number',
            );
        }

        $best = [];
        foreach (array_keys($terminals) as $terminalId) {
            $chain = [];
            $id = (string)$terminalId;
            while (true) {
                $chain[] = $id;
                $criticalPreds = [];
                foreach ($preds[$id] ?? [] as $dep) {
                    $pid = (string)$dep['fromId'];
                    if (!empty($map[$pid]['isCritical'])) {
                        $criticalPreds[] = $dep;
                    }
                }
                if ($criticalPreds === []) {
                    break;
                }
                usort(
                    $criticalPreds,
                    static fn(array $a, array $b): int => ((int)($map[(string)$b['fromId']]['ef'] ?? 0))
                        <=> ((int)($map[(string)$a['fromId']]['ef'] ?? 0)),
                );
                $id = (string)$criticalPreds[0]['fromId'];
            }
            $chain = array_reverse($chain);
            if (count($chain) > count($best)) {
                $best = $chain;
            }
        }

        return array_map(static fn(string $id): string => (string)($map[$id]['number'] ?? ''), $best);
    }

    /** @param array<string, array<string, mixed>> $map */
    private static function normalizeScheduleOriginToZero(array &$map): void
    {
        if ($map === []) {
            return;
        }
        $minEs = min(array_map(static fn(array $a): int => (int)($a['es'] ?? 0), $map));
        if ($minEs <= 0) {
            return;
        }
        foreach ($map as &$a) {
            $a['es'] = (int)($a['es'] ?? 0) - $minEs;
            $a['ef'] = (int)($a['ef'] ?? 0) - $minEs;
            $a['ls'] = (int)($a['ls'] ?? 0) - $minEs;
            $a['lf'] = (int)($a['lf'] ?? 0) - $minEs;
        }
        unset($a);
    }

    private static function normalizeRootEsOverride(mixed $value, bool $hasPredecessors = false): mixed
    {
        if ($value === null || $value === '') {
            return $value;
        }
        $day = (int)$value;
        // Legacy 1-based "day 1 = first day" — only for root activities.
        if (!$hasPredecessors && $day === 1) {
            return 0;
        }
        return $value;
    }

    /** Required successor ES from one predecessor relationship (lead = negative lag). */
    private static function requiredSuccessorEs(
        string $type,
        int $predEs,
        int $predEf,
        int $successorDuration,
        int $lag,
    ): int {
        return match (strtoupper($type)) {
            'SS' => $predEs + $lag,
            'FF' => $predEf + $lag - $successorDuration,
            'SF' => $predEs + $lag - $successorDuration,
            default => $predEf + $lag,
        };
    }

    /** Required predecessor LS from one successor relationship (lead = negative lag). */
    private static function requiredPredecessorLs(
        string $type,
        int $succLs,
        int $succLf,
        int $predecessorDuration,
        int $lag,
    ): int {
        return match (strtoupper($type)) {
            'SS' => $succLs - $lag,
            'FF' => $succLf - $lag - $predecessorDuration,
            'SF' => $succLf - $lag,
            default => $succLs - $lag - $predecessorDuration,
        };
    }
}
