<?php
declare(strict_types=1);

namespace Peo;

/**
 * Contractor reference — Remebella, Buguey, Cagayan road project.
 * Source: PERT/CPM (110 days) + Target Plan / S-Curve bar chart (Reyrose Construction, 2025).
 */
class RoadProjectReference
{
    public const PROJECT_TITLE = RoadPdmSample::PROJECT_TITLE;

    public const CONTRACT_AMOUNT = 5991119.01;

    public const CONTRACTOR = 'Reyrose Construction';

    public const LOCATION = 'Remebella, Buguey, Cagayan';

    /** @return array{name:string,location:string,contractor:string,contract_amount:float,start_date:string,planned_end_date:string,duration_days:int} */
    public static function meta(): array
    {
        return [
            'name' => self::PROJECT_TITLE,
            'location' => self::LOCATION,
            'contractor' => self::CONTRACTOR,
            'contract_amount' => self::CONTRACT_AMOUNT,
            'start_date' => '2025-07-01',
            'planned_end_date' => '2025-10-19',
            'duration_days' => 110,
        ];
    }

    /**
     * Bill of quantities — each row links to a PDM activity key for schedule weighting.
     *
     * @return list<array{pdm_key:string,item_no:string,description:string,unit:string,qty:float,unit_cost:float,amount:float,weight_pct:float}>
     */
    public static function boqItems(): array
    {
        return [
            ['pdm_key' => 'a111', 'item_no' => 'A.1.1(11)', 'description' => 'Provision of Furnitures/Fixtures, etc. for the Field Office for the Engineer', 'unit' => 'L.S.', 'qty' => 1.0, 'unit_cost' => 118125.00, 'amount' => 118125.00, 'weight_pct' => 1.972],
            ['pdm_key' => 'b5', 'item_no' => 'B.5', 'description' => 'Project Billboard', 'unit' => 'each', 'qty' => 2.0, 'unit_cost' => 5055.28, 'amount' => 10110.56, 'weight_pct' => 0.169],
            ['pdm_key' => 'b7', 'item_no' => 'B.7', 'description' => 'Construction Safety & Health Program', 'unit' => 'L.S.', 'qty' => 1.0, 'unit_cost' => 44176.86, 'amount' => 44176.86, 'weight_pct' => 0.737],
            ['pdm_key' => 'b9', 'item_no' => 'B.9', 'description' => 'Mobilization / Demobilization', 'unit' => 'L.S.', 'qty' => 1.0, 'unit_cost' => 42997.50, 'amount' => 42997.50, 'weight_pct' => 0.718],
            ['pdm_key' => 'r1013', 'item_no' => '101(3)b3', 'description' => 'Removal of Actual Structures/Obstructions, 0.23m thk. PCCP (Unreinforced)', 'unit' => 'sq.m.', 'qty' => 11.25, 'unit_cost' => 1021.47, 'amount' => 11491.54, 'weight_pct' => 0.192],
            ['pdm_key' => 'r1014', 'item_no' => '101(4)a1', 'description' => 'Removal of Actual Structures/Obstructions, 610mm dia. RCPC', 'unit' => 'ln.m.', 'qty' => 7.0, 'unit_cost' => 2080.55, 'amount' => 14563.85, 'weight_pct' => 0.243],
            ['pdm_key' => 'e1041', 'item_no' => '104(1)a', 'description' => 'Embankment from Roadway Excavation (Common Soil)', 'unit' => 'cu.m.', 'qty' => 269.48, 'unit_cost' => 632.98, 'amount' => 170582.79, 'weight_pct' => 2.847],
            ['pdm_key' => 'e1042', 'item_no' => '104(2)a', 'description' => 'Embankment (From Borrow, Common Soil)', 'unit' => 'cu.m.', 'qty' => 147.96, 'unit_cost' => 1098.72, 'amount' => 162568.61, 'weight_pct' => 2.713],
            ['pdm_key' => 'e103', 'item_no' => '103(1)a', 'description' => 'Structure Excavation (Common Soil)', 'unit' => 'cu.m.', 'qty' => 230.87, 'unit_cost' => 611.08, 'amount' => 141080.04, 'weight_pct' => 2.355],
            ['pdm_key' => 'e105', 'item_no' => '105(1)', 'description' => 'Sub-Grade Preparation (Common Material)', 'unit' => 'sq.m.', 'qty' => 2035.0, 'unit_cost' => 34.29, 'amount' => 69817.18, 'weight_pct' => 1.165],
            ['pdm_key' => 'e200', 'item_no' => '200(1)', 'description' => 'Aggregate Sub-Base Course', 'unit' => 'cu.m.', 'qty' => 564.54, 'unit_cost' => 1075.64, 'amount' => 607236.64, 'weight_pct' => 10.136],
            ['pdm_key' => 'p311u', 'item_no' => '311(1)c1', 'description' => 'Portland Cement Concrete Pavement (Unreinforced), 0.23m thk. 14 days', 'unit' => 'sq.m.', 'qty' => 1695.73, 'unit_cost' => 1522.40, 'amount' => 2581540.76, 'weight_pct' => 43.089],
            ['pdm_key' => 'p311r', 'item_no' => '311(2)e1', 'description' => 'Portland Cement Concrete Pavement (Reinforced), 0.28m thk. 14 days', 'unit' => 'sq.m.', 'qty' => 23.0, 'unit_cost' => 2439.64, 'amount' => 56111.72, 'weight_pct' => 0.937],
            ['pdm_key' => 'r404a', 'item_no' => '404(1)a', 'description' => 'Reinforcing Steel, Grade 40 (ø10mm)', 'unit' => 'kg', 'qty' => 19.10, 'unit_cost' => 108.88, 'amount' => 2079.61, 'weight_pct' => 0.035],
            ['pdm_key' => 'r404b', 'item_no' => '404(1)b', 'description' => 'Reinforcing Steel, Grade 60 (ø12mm)', 'unit' => 'kg', 'qty' => 38.92, 'unit_cost' => 84.17, 'amount' => 3275.90, 'weight_pct' => 0.055],
            ['pdm_key' => 'r405c', 'item_no' => '405(1)a3', 'description' => 'Structural Concrete Class A, 20.68MPa @ 28 days (culvert)', 'unit' => 'cu.m.', 'qty' => 3.25, 'unit_cost' => 6879.28, 'amount' => 22357.66, 'weight_pct' => 0.373],
            ['pdm_key' => 'r500', 'item_no' => '500(1)a3', 'description' => 'Reinforced Concrete Pipe Culvert, 910mm dia. Class IV', 'unit' => 'ln.m.', 'qty' => 19.0, 'unit_cost' => 5036.99, 'amount' => 95702.81, 'weight_pct' => 1.597],
            ['pdm_key' => 'r404a2', 'item_no' => '404(1)a', 'description' => 'Reinforcing Steel, Grade 40 (Retaining Wall)', 'unit' => 'kg', 'qty' => 5739.87, 'unit_cost' => 72.19, 'amount' => 414361.22, 'weight_pct' => 6.916],
            ['pdm_key' => 'r404b2', 'item_no' => '404(1)b', 'description' => 'Reinforcing Steel, Grade 60 (Retaining Wall)', 'unit' => 'kg', 'qty' => 5306.46, 'unit_cost' => 68.71, 'amount' => 364606.87, 'weight_pct' => 6.086],
            ['pdm_key' => 'r405p', 'item_no' => '405(1)a3', 'description' => 'Structural Concrete Class A, 20.68MPa @ 28 days (Retaining Wall)', 'unit' => 'cu.m.', 'qty' => 170.74, 'unit_cost' => 6198.63, 'amount' => 1058354.09, 'weight_pct' => 17.665],
        ];
    }

    /** Target cumulative accomplishment % at end of each 10-day period (from contractor bar chart). */
    public static function targetCumulativeByDay(): array
    {
        return [
            10 => 2.925,
            20 => 4.279,
            30 => 9.418,
            40 => 13.912,
            50 => 18.933,
            60 => 23.621,
            70 => 31.873,
            80 => 44.585,
            90 => 62.0,
            100 => 82.0,
            110 => 100.0,
        ];
    }

    /** @return array<string, float> pdm_key => weight_pct */
    public static function weightByPdmKey(): array
    {
        $map = [];
        foreach (self::boqItems() as $row) {
            $map[$row['pdm_key']] = (float)$row['weight_pct'];
        }
        return $map;
    }

    /** @return list<array<string, mixed>> SWA line-item shape */
    public static function swaLineItems(): array
    {
        $items = [];
        foreach (self::boqItems() as $i => $row) {
            $items[] = [
                'id' => 'ref-' . ($i + 1),
                'itemNo' => $row['item_no'],
                'description' => $row['description'],
                'unit' => $row['unit'],
                'unitPrice' => $row['unit_cost'],
                'programmedQty' => $row['qty'],
                'previous' => 0,
                'thisPeriod' => 0,
                'remarks' => '',
            ];
        }
        return $items;
    }
}
