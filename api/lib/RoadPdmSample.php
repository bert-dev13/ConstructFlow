<?php
declare(strict_types=1);

namespace Peo;

/**
 * Precedence diagram — Construction of Box Culvert along Cato-Conner Road, Tuao.
 *
 * Revision: B→E removed (marked MALI). E waits on C and D (FS).
 */
class RoadPdmSample
{
    public const PROJECT_TITLE = 'CONSTRUCTION OF BOX CULVERT ALONG CATO-CONNER ROAD, TUAO';

    public static function hasReference(): bool
    {
        return self::activities() !== [];
    }

    /** @return array{name:string,location:string,start_date:string,planned_end_date:string,duration_days:int}|null */
    public static function projectMeta(): ?array
    {
        if (!self::hasReference()) {
            return null;
        }

        return [
            'name' => self::PROJECT_TITLE,
            'location' => 'Cato-Conner Road, Tuao, Cagayan',
            'start_date' => '2025-07-01',
            'planned_end_date' => '2025-12-15',
            'duration_days' => 167,
        ];
    }

    /** @return list<array{key:string,number:string,name:string,duration:int,es_override?:int}> */
    public static function activities(): array
    {
        return [
            ['key' => 'a', 'number' => 'A', 'name' => 'Mobilization', 'duration' => 5, 'es_override' => 0],
            ['key' => 'b', 'number' => 'B', 'name' => 'Box Culvert Construction', 'duration' => 23],
            ['key' => 'c', 'number' => 'C', 'name' => 'Retaining Wall Construction', 'duration' => 10],
            ['key' => 'd', 'number' => 'D', 'name' => 'RCPC Installation', 'duration' => 9],
            ['key' => 'e', 'number' => 'E', 'name' => 'Sub-grade Preparation', 'duration' => 28],
            ['key' => 'f', 'number' => 'F', 'name' => 'Embankment', 'duration' => 27],
            ['key' => 'g', 'number' => 'G', 'name' => 'Aggregate Base Course', 'duration' => 22],
            ['key' => 'h', 'number' => 'H', 'name' => 'PCCP', 'duration' => 70],
            ['key' => 'i', 'number' => 'I', 'name' => 'Demobilization', 'duration' => 5],
        ];
    }

    /** @return list<array{from:string,to:string,type:string,lag:int}> */
    public static function dependencies(): array
    {
        $fs = static fn(string $from, string $to, int $lag = 0): array => [
            'from' => $from,
            'to' => $to,
            'type' => 'FS',
            'lag' => $lag,
        ];

        return [
            $fs('a', 'b'),
            $fs('a', 'c'),
            $fs('a', 'd'),
            $fs('c', 'e'),
            $fs('d', 'e'),
            $fs('e', 'f'),
            $fs('f', 'g'),
            $fs('g', 'h'),
            $fs('h', 'i'),
        ];
    }
}
