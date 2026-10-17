<?php
declare(strict_types=1);

namespace Peo;

use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\Drawing;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

class ExcelTemplateService
{
    private string $excelDir;

    public function __construct()
    {
        $this->excelDir = dirname(__DIR__, 2) . '/templates/excel';
    }

    public function hasTemplate(string $reportType): bool
    {
        return is_file($this->templatePath($reportType));
    }

    public function templatePath(string $reportType): string
    {
        return $this->excelDir . '/' . $reportType . '.xlsx';
    }

    /**
     * Load Excel template, replace {{placeholders}}, fill SWA item rows, embed QR, save .xlsx
     */
    public function generate(
        string $reportType,
        array $data,
        array $lineItems,
        string $qrPublicUrl,
        string $outputBasePath,
    ): array {
        $template = $this->templatePath($reportType);
        if (!is_file($template)) {
            throw new \RuntimeException("Excel template not found: templates/excel/{$reportType}.xlsx");
        }

        $spreadsheet = IOFactory::load($template);

        if ($reportType === 'SWA' && $lineItems) {
            $less = SwaStewaLinkage::lessAmount($data);
            $calc = WorkItemCalculator::compute(
                $lineItems,
                $less,
                SwaStewaLinkage::showRevisedQuantity($data),
            );
            $data = array_merge($data, $this->flattenTotals($calc['totals']));
            $data['less_reason'] = SwaStewaLinkage::lessReason($data);
            $data['less_amount'] = WorkItemCalculator::formatMoney($less);
            $data['advance_payment'] = $data['less_amount'];
            $this->fillSwaItemRows($spreadsheet, $calc['items']);
        }

        if ($reportType === 'STEWA') {
            $actual = (float)($data['percent_actual'] ?? 0);
            $planned = (float)($data['percent_planned'] ?? 0);
            $data['slippage'] = SwaStewaLinkage::stewaSlippage($actual, $planned);
        }

        $this->replacePlaceholders($spreadsheet, $data);
        $this->embedQrOnAllSheets($spreadsheet, $qrPublicUrl);

        $xlsxPath = $outputBasePath . '.xlsx';
        $dir = dirname($xlsxPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $writer = IOFactory::createWriter($spreadsheet, 'Xlsx');
        $writer->save($xlsxPath);

        return [
            'xlsx' => $xlsxPath,
            'pdf' => null,
        ];
    }

    private function replacePlaceholders(Spreadsheet $spreadsheet, array $data): void
    {
        foreach ($spreadsheet->getAllSheets() as $sheet) {
            foreach ($sheet->getRowIterator() as $row) {
                foreach ($row->getCellIterator() as $cell) {
                    $value = $cell->getValue();
                    if (!is_string($value) || !str_contains($value, '{{')) {
                        continue;
                    }
                    $replaced = $value;
                    foreach ($data as $key => $val) {
                        $replaced = str_replace('{{' . $key . '}}', (string)$val, $replaced);
                    }
                    $replaced = preg_replace('/\{\{[a-z0-9_]+\}\}/i', '', $replaced) ?? $replaced;
                    $cell->setValue($replaced);
                }
            }
        }
    }

    /**
     * Find a template row containing {{item_no}} and duplicate for each work item.
     */
    private function fillSwaItemRows(Spreadsheet $spreadsheet, array $items): void
    {
        foreach ($spreadsheet->getAllSheets() as $sheet) {
            $templateRow = $this->findItemTemplateRow($sheet);
            if ($templateRow === null) {
                continue;
            }

            $templateValues = [];
            $highestCol = $sheet->getHighestColumn($templateRow);
            $colIndex = Coordinate::columnIndexFromString($highestCol);

            for ($c = 1; $c <= $colIndex; $c++) {
                $col = Coordinate::stringFromColumnIndex($c);
                $templateValues[$col] = $sheet->getCell($col . $templateRow)->getValue();
            }

            $sheet->removeRow($templateRow);

            $insertAt = $templateRow;
            foreach ($items as $item) {
                $sheet->insertNewRowBefore($insertAt, 1);
                $rowData = $this->mapItemToPlaceholders($item);
                foreach ($templateValues as $col => $tpl) {
                    if (!is_string($tpl)) {
                        continue;
                    }
                    $val = $tpl;
                    foreach ($rowData as $key => $v) {
                        $val = str_replace('{{' . $key . '}}', (string)$v, $val);
                    }
                    $val = preg_replace('/\{\{[a-z0-9_]+\}\}/i', '', $val) ?? $val;
                    $sheet->setCellValue($col . $insertAt, $val);
                }
                $insertAt++;
            }
            break;
        }
    }

    private function findItemTemplateRow(Worksheet $sheet): ?int
    {
        foreach ($sheet->getRowIterator() as $row) {
            foreach ($row->getCellIterator() as $cell) {
                $v = $cell->getValue();
                if (is_string($v) && str_contains($v, '{{item_no}}')) {
                    return (int)$row->getRowIndex();
                }
            }
        }
        return null;
    }

    private function mapItemToPlaceholders(array $item): array
    {
        return [
            'item_no' => $item['itemNo'] ?? $item['item_no'] ?? '',
            'item_description' => $item['description'] ?? '',
            'unit' => $item['unit'] ?? '',
            'unit_price' => WorkItemCalculator::formatMoney((float)($item['unitPrice'] ?? $item['unit_price'] ?? 0)),
            'programmed_qty' => $item['programmedQty'] ?? $item['programmed_qty'] ?? '',
            'contract_amount' => WorkItemCalculator::formatMoney((float)($item['contractAmount'] ?? 0)),
            'weight_pct' => number_format((float)($item['weightPct'] ?? 0), 2),
            'revised_qty' => $item['revisedQty'] ?? $item['revised_qty'] ?? '',
            'revised_amount' => WorkItemCalculator::formatMoney((float)($item['revisedAmount'] ?? 0)),
            'revised_weight_pct' => number_format((float)($item['revisedWeightPct'] ?? 0), 2),
            'previous' => $item['previous'] ?? '',
            'this_period' => $item['thisPeriod'] ?? $item['this_period'] ?? '',
            'to_date' => $item['toDate'] ?? $item['to_date'] ?? '',
            'accomplishment_weight_pct' => number_format((float)($item['accomplishmentWeightPct'] ?? 0), 2),
            'remarks' => $item['remarks'] ?? $item['status'] ?? '',
        ];
    }

    private function flattenTotals(array $totals): array
    {
        return [
            'total_contract_amount' => WorkItemCalculator::formatMoney($totals['totalContractAmount']),
            'total_weight_pct' => number_format($totals['totalWeightPct'], 2),
            'total_accomplishment_weight' => number_format($totals['totalToDateWeightPct'], 2),
            'pct_this_accomplishment' => number_format($totals['pctThisAccomplishment'], 2),
            'total_project_cost' => WorkItemCalculator::formatMoney($totals['totalContractAmount']),
            'total_this_accomplishment' => WorkItemCalculator::formatMoney($totals['totalThisAccomplishment']),
            'total_voucher' => WorkItemCalculator::formatMoney($totals['totalVoucher']),
        ];
    }

    public function embedQrOnAllSheets(Spreadsheet $spreadsheet, string $url): void
    {
        $qrPng = dirname(__DIR__, 2) . '/storage/temp_qr.png';
        QrCodeService::savePng($url, $qrPng);

        foreach ($spreadsheet->getAllSheets() as $sheet) {
            $drawing = new Drawing();
            $drawing->setName('QR');
            $drawing->setPath($qrPng);
            $drawing->setHeight(70);
            $drawing->setWidth(70);
            $drawing->setCoordinates('A1');
            $drawing->setOffsetX(5);
            $drawing->setOffsetY(5);
            $drawing->setWorksheet($sheet);
        }
    }

    private function trySpreadsheetPdf(Spreadsheet $spreadsheet, string $pdfPath): bool
    {
        try {
            if (!class_exists(\PhpOffice\PhpSpreadsheet\Writer\Pdf\Dompdf::class)) {
                return false;
            }
            $writer = IOFactory::createWriter($spreadsheet, 'Pdf');
            $writer->save($pdfPath);
            return is_file($pdfPath);
        } catch (\Throwable) {
            return false;
        }
    }
}
