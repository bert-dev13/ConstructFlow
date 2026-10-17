<?php
declare(strict_types=1);

namespace Peo;

use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

class IarExcelService
{
    private const TEMPLATE_SHEET = '4 - 1-5 - 2024';

    private string $sourcePath;

    public function __construct()
    {
        $this->sourcePath = dirname(__DIR__, 2) . '/templates/excel/IAR.xlsx';
    }

    public function hasTemplate(): bool
    {
        return is_file($this->sourcePath);
    }

    public function generate(array $data, string $qrPublicUrl, string $outputBasePath): string
    {
        if (!is_file($this->sourcePath)) {
            throw new \RuntimeException('IAR Excel template not found at templates/excel/IAR.xlsx');
        }

        $spreadsheet = IOFactory::load($this->sourcePath);
        $sheet = $spreadsheet->getSheetByName(self::TEMPLATE_SHEET);
        if (!$sheet) {
            $sheet = $spreadsheet->getSheet(0);
        }

        for ($i = $spreadsheet->getSheetCount() - 1; $i >= 0; $i--) {
            if ($spreadsheet->getSheet($i)->getTitle() !== $sheet->getTitle()) {
                $spreadsheet->removeSheetByIndex($i);
            }
        }
        $sheet->setTitle('IAR');

        $this->fill($sheet, $data);

        (new ExcelTemplateService())->embedQrOnAllSheets($spreadsheet, $qrPublicUrl);

        $xlsxPath = $outputBasePath . '.xlsx';
        $dir = dirname($xlsxPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $writer = IOFactory::createWriter($spreadsheet, 'Xlsx');
        $writer->save($xlsxPath);

        return $xlsxPath;
    }

    private function fill(Worksheet $sheet, array $data): void
    {
        $this->set($sheet, 'B3', $data['contract_number'] ?? '');
        $this->set($sheet, 'B4', $data['project_title'] ?? $data['project_name'] ?? '');
        $this->set($sheet, 'B5', $data['location_line1'] ?? $data['location'] ?? '');
        $this->set($sheet, 'K5', $data['municipality'] ?? '');
        $this->set($sheet, 'B6', $data['contractor'] ?? '');
        $this->set($sheet, 'K6', $data['week_covered'] ?? $data['period_covered'] ?? '');

        $this->fillAccomplishment($sheet, $data['accomplishment_items'] ?? []);
        $this->fillVariation($sheet, $data['variation_items'] ?? []);
        $this->fillListColumn($sheet, 'A', 40, 50, $data['activities'] ?? []);
        $this->fillListColumn($sheet, 'H', 40, 50, $data['field_instructions'] ?? []);
        $this->set($sheet, 'A53', $data['problems_remarks'] ?? $data['remarks'] ?? '');

        $this->fillManpowerEquipment($sheet, $data['manpower'] ?? [], $data['equipment'] ?? []);

        $progressRow = 67;
        $this->set($sheet, 'B' . $progressRow, $data['orig_target'] ?? '');
        $this->set($sheet, 'D' . $progressRow, $data['rev_target'] ?? '');
        $this->set($sheet, 'F' . $progressRow, $data['actual_progress'] ?? $data['percent_complete'] ?? '');
        $this->set($sheet, 'H' . $progressRow, $data['variance'] ?? '');
        $this->set($sheet, 'J' . $progressRow, $data['progress_remarks'] ?? '');

        $this->set($sheet, 'A72', $data['prepared_by_name'] ?? $data['inspected_by_name'] ?? '');
        $this->set($sheet, 'D72', $data['checked_by_name'] ?? '');
        $this->set($sheet, 'H72', $data['noted_by_name'] ?? '');
        $this->set($sheet, 'K72', $data['contractor_representative'] ?? '');
    }

    private function set(Worksheet $sheet, string $cell, mixed $value): void
    {
        if ($value === null || $value === '') {
            return;
        }
        $sheet->setCellValue($cell, $value);
    }

    /** @param array<int, array<string, mixed>> $items */
    private function fillAccomplishment(Worksheet $sheet, array $items): void
    {
        $row = 13;
        foreach ($items as $item) {
            if ($row > 31) {
                break;
            }
            $this->set($sheet, 'A' . $row, $item['item_no'] ?? $item['itemNo'] ?? '');
            $this->set($sheet, 'B' . $row, $item['description'] ?? '');
            $this->set($sheet, 'G' . $row, $item['location'] ?? '');
            $this->set($sheet, 'J' . $row, $item['physical_qty'] ?? $item['physicalQty'] ?? '');
            $this->set($sheet, 'K' . $row, $item['billable_qty'] ?? $item['billableQty'] ?? '');
            $this->set($sheet, 'L' . $row, $item['unit'] ?? '');
            $row++;
        }
    }

    /** @param array<int, array<string, mixed>> $items */
    private function fillVariation(Worksheet $sheet, array $items): void
    {
        $row = 34;
        foreach ($items as $item) {
            if ($row > 38) {
                break;
            }
            $this->set($sheet, 'A' . $row, $item['item_no'] ?? '');
            $this->set($sheet, 'B' . $row, $item['description'] ?? '');
            $this->set($sheet, 'G' . $row, $item['quantity'] ?? '');
            $this->set($sheet, 'I' . $row, $item['unit'] ?? '');
            $this->set($sheet, 'J' . $row, $item['additive'] ?? '');
            $this->set($sheet, 'K' . $row, $item['deductive'] ?? '');
            $this->set($sheet, 'L' . $row, $item['new_item'] ?? '');
            $row++;
        }
    }

    /** @param array<int, string> $lines */
    private function fillListColumn(Worksheet $sheet, string $col, int $start, int $end, array $lines): void
    {
        $row = $start;
        foreach ($lines as $line) {
            if ($row > $end || trim((string) $line) === '') {
                continue;
            }
            $this->set($sheet, $col . $row, $line);
            $row++;
        }
    }

    /** @param array<int, array<string, mixed>> $manpower */
    /** @param array<int, array<string, mixed>> $equipment */
    private function fillManpowerEquipment(Worksheet $sheet, array $manpower, array $equipment): void
    {
        $row = 55;
        foreach ($manpower as $m) {
            if ($row > 62) {
                break;
            }
            $this->set($sheet, 'H' . $row, $m['description'] ?? '');
            $this->set($sheet, 'J' . $row, $m['quantity'] ?? '');
            $row++;
        }
        $row = 55;
        foreach ($equipment as $e) {
            if ($row > 62) {
                break;
            }
            $this->set($sheet, 'K' . $row, $e['description'] ?? '');
            $this->set($sheet, 'L' . $row, $e['quantity'] ?? '');
            $row++;
        }
    }
}
