<?php
declare(strict_types=1);

namespace Peo;

class ReportTemplateRenderer
{
    private string $templatesDir;

    public function __construct()
    {
        $this->templatesDir = dirname(__DIR__, 2) . '/templates';
    }

    private function logoPath(string $which): ?string
    {
        $root = dirname(__DIR__, 2);
        $candidates = match ($which) {
            'pgc' => [
                $root . '/img/pgc.jpg',
                $root . '/templates/assets/pgc.jpg',
                $root . '/templates/assets/cagayan-seal.png',
                $root . '/templates/assets/cagayan-seal.jpeg',
            ],
            'peo' => [
                $root . '/img/PEO.webp',
                $root . '/public/img/peo.webp',
                $root . '/templates/assets/peo.webp',
            ],
            default => [],
        };
        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }
        if ($which === 'pgc') {
            $this->extractLogoFromExcelTemplate();
            foreach ($candidates as $candidate) {
                if (is_file($candidate)) {
                    return $candidate;
                }
            }
        }
        return null;
    }

    private function logoImgSrc(string $which): string
    {
        $path = $this->logoPath($which);
        if (!$path) {
            return '';
        }
        $root = realpath(dirname(__DIR__, 2)) ?: dirname(__DIR__, 2);
        $relative = str_replace('\\', '/', substr($path, strlen($root) + 1));
        return $relative;
    }

    private function logoDataUri(string $which): string
    {
        $path = $this->logoPath($which);
        if (!$path) {
            return '';
        }
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        // Dompdf cannot render WebP unless GD/Imagick can convert it first.
        if ($ext === 'webp') {
            if (function_exists('imagecreatefromwebp')) {
                $img = @imagecreatefromwebp($path);
                if ($img !== false) {
                    ob_start();
                    imagepng($img);
                    $png = (string)ob_get_clean();
                    imagedestroy($img);
                    if ($png !== '') {
                        return 'data:image/png;base64,' . base64_encode($png);
                    }
                }
            }
            return '';
        }

        $mime = match ($ext) {
            'png' => 'image/png',
            'jpeg', 'jpg' => 'image/jpeg',
            default => 'image/jpeg',
        };
        return 'data:' . $mime . ';base64,' . base64_encode((string)file_get_contents($path));
    }

    private function logoReplacements(bool $forPdf): array
    {
        // Always embed as data URIs so Dompdf can render seals without path/WebP issues.
        unset($forPdf);
        $pgc = $this->logoDataUri('pgc');
        $peo = $this->logoDataUri('peo');

        $pgcImg = $pgc !== ''
            ? '<img src="' . $pgc . '" width="58" height="58" style="width:58px;height:58px;border:0" />'
            : '&nbsp;';
        $peoImg = $peo !== ''
            ? '<img src="' . $peo . '" width="58" height="58" style="width:58px;height:58px;border:0" />'
            : '&nbsp;';

        // PGC left, PEO right — report number must NOT use position:fixed top-right (it covers the PEO seal).
        $swaLetterhead = '<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 10px 0">'
            . '<tr>'
            . '<td width="64" align="left" valign="middle" style="width:64px;border:none;padding:0;text-align:left">' . $pgcImg . '</td>'
            . '<td align="center" valign="middle" style="border:none;padding:0 10px;text-align:center">'
            . '<div style="font-size:7pt">Republic of the Philippines</div>'
            . '<div style="font-size:9pt;font-weight:bold">PROVINCE OF CAGAYAN</div>'
            . '<div style="font-size:7pt">Capitol Hills, Tuguegarao City</div>'
            . '<div style="font-size:8pt;font-weight:bold;text-decoration:underline">PROVINCIAL ENGINEER\'S OFFICE</div>'
            . '</td>'
            . '<td width="64" align="right" valign="middle" style="width:64px;border:none;padding:0;text-align:right">' . $peoImg . '</td>'
            . '</tr></table>';

        $stewaLetterhead = '<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 10px 0">'
            . '<tr>'
            . '<td width="64" align="left" valign="middle" style="width:64px;border:none;padding:0;text-align:left">' . $pgcImg . '</td>'
            . '<td align="center" valign="middle" style="border:none;padding:0 10px;text-align:center">'
            . '<div style="border-top:2px solid #7b1e1e;border-bottom:1px solid #7b1e1e;height:0;margin:0 0 5px"></div>'
            . '<div style="font-size:9.5pt">Republic of the Philippines</div>'
            . '<div style="font-size:11pt;font-weight:bold">PROVINCE OF CAGAYAN</div>'
            . '<div style="font-size:9.5pt">Capitol Hills, Tuguegarao City</div>'
            . '<div style="font-size:10pt;font-weight:bold;text-decoration:underline">PROVINCIAL ENGINEER\'S OFFICE</div>'
            . '<div style="border-top:2px solid #7b1e1e;border-bottom:1px solid #7b1e1e;height:0;margin:5px 0 0"></div>'
            . '</td>'
            . '<td width="64" align="right" valign="middle" style="width:64px;border:none;padding:0;text-align:right">' . $peoImg . '</td>'
            . '</tr></table>';

        $pgcOnly = $pgc !== ''
            ? '<img src="' . $pgc . '" width="48" height="48" style="width:48px;height:48px;border:0" />'
            : '';

        return [
            'pgc_logo_img' => $pgc,
            'peo_logo_img' => $peo,
            'logo_img' => $pgc,
            'swa_letterhead' => $swaLetterhead,
            'stewa_letterhead' => $stewaLetterhead,
            'iar_seal_block' => $pgcOnly,
            'seal_pgc_cell' => '',
            'seal_peo_cell' => '',
        ];
    }


    private function extractLogoFromExcelTemplate(): void
    {
        $xlsx = $this->templatesDir . '/excel/STEWA.xlsx';
        if (!is_file($xlsx)) {
            return;
        }
        $zip = new \ZipArchive();
        if ($zip->open($xlsx) !== true) {
            return;
        }
        $candidates = ['xl/media/image2.png', 'xl/media/image1.jpeg'];
        $assetsDir = $this->templatesDir . '/assets';
        if (!is_dir($assetsDir)) {
            mkdir($assetsDir, 0755, true);
        }
        foreach ($candidates as $entry) {
            $contents = $zip->getFromName($entry);
            if ($contents !== false) {
                $ext = pathinfo($entry, PATHINFO_EXTENSION);
                file_put_contents($assetsDir . '/cagayan-seal.' . $ext, $contents);
                break;
            }
        }
        $zip->close();
    }

    public function renderStewa(array $data, string $qrDataUri, bool $forPdf = true): string
    {
        $html = $this->loadTemplate('STEWA/official.html');
        $replacements = array_merge($this->logoReplacements($forPdf), [
            'report_date' => htmlspecialchars($this->formatStewaDate($data['report_date'] ?? null)),
            'project_name' => htmlspecialchars($data['project_name'] ?? ''),
            'location' => htmlspecialchars($data['location'] ?? ''),
            'contract_amount' => WorkItemCalculator::formatMoney((float)($data['contract_amount'] ?? 0)),
            'contractor' => htmlspecialchars($data['contractor'] ?? ''),
            'period_covered' => htmlspecialchars($data['period_covered'] ?? ''),
            'contract_duration' => htmlspecialchars((string)($data['contract_duration'] ?? '')),
            'notice_to_proceed' => htmlspecialchars($this->formatStewaDate($data['notice_to_proceed'] ?? null, true)),
            'expiry_date' => htmlspecialchars($this->formatStewaDate($data['expiry_date'] ?? null, true)),
            'approved_time_extension' => htmlspecialchars($this->stewaDash($data['approved_time_extension'] ?? '')),
            'approved_time_suspension' => htmlspecialchars($this->stewaDash($data['approved_time_suspension'] ?? '')),
            'total_time_extension' => htmlspecialchars($this->stewaDash($data['total_time_extension'] ?? '')),
            'revised_contract_duration' => htmlspecialchars($this->stewaDash($data['revised_contract_duration'] ?? '')),
            'revised_expiry_date' => htmlspecialchars($this->formatStewaDate($data['revised_expiry_date'] ?? null, true)),
            'calendar_days_elapsed' => htmlspecialchars((string)($data['calendar_days_elapsed'] ?? '')),
            'percent_actual' => number_format((float)($data['percent_actual'] ?? 0), 2),
            'percent_planned' => number_format((float)($data['percent_planned'] ?? 0), 2),
            'slippage' => number_format((float)($data['slippage'] ?? 0), 2),
            'remarks' => nl2br(htmlspecialchars($data['remarks'] ?? '')),
            'submitted_by_name' => htmlspecialchars($data['submitted_by_name'] ?? ''),
            'submitted_by_title' => htmlspecialchars($data['submitted_by_title'] ?? 'Engineer II'),
            'noted_by_name' => htmlspecialchars($data['noted_by_name'] ?? ''),
            'noted_by_title' => htmlspecialchars($data['noted_by_title'] ?? 'Engineer IV (Chief-Construction Division)'),
            'report_number' => htmlspecialchars($data['report_number'] ?? ''),
            'qr_code_img' => $qrDataUri,
        ]);
        foreach ($replacements as $key => $val) {
            $html = str_replace('{{' . $key . '}}', $val, $html);
        }
        return $html;
    }

    public function renderIar(array $data, string $qrDataUri, bool $forPdf = true): string
    {
        $accomplishmentItems = array_slice(array_values($data['accomplishment_items'] ?? []), 0, 10);
        $variationItems = array_slice(array_values($data['variation_items'] ?? []), 0, 4);
        $manpower = array_slice(array_values($data['manpower'] ?? []), 0, 4);
        $equipment = array_slice(array_values($data['equipment'] ?? []), 0, 4);

        $rows = '';
        foreach ($this->padRows($accomplishmentItems, 10) as $item) {
            $rows .= '<tr>';
            $rows .= '<td>' . htmlspecialchars((string)($item['item_no'] ?? $item['itemNo'] ?? '')) . '</td>';
            $rows .= '<td>' . htmlspecialchars((string)($item['description'] ?? '')) . '</td>';
            $rows .= '<td>' . htmlspecialchars((string)($item['location'] ?? '')) . '</td>';
            $rows .= '<td class="right">' . htmlspecialchars((string)($item['physical_qty'] ?? $item['physicalQty'] ?? '')) . '</td>';
            $rows .= '<td class="right">' . htmlspecialchars((string)($item['billable_qty'] ?? $item['billableQty'] ?? '')) . '</td>';
            $rows .= '<td>' . htmlspecialchars((string)($item['unit'] ?? '')) . '</td>';
            $rows .= '</tr>';
        }

        $variationRows = '';
        foreach ($this->padRows($variationItems, 4) as $item) {
            $variationRows .= '<tr>';
            $variationRows .= '<td>' . htmlspecialchars((string)($item['item_no'] ?? $item['itemNo'] ?? '')) . '</td>';
            $variationRows .= '<td>' . htmlspecialchars((string)($item['description'] ?? '')) . '</td>';
            $variationRows .= '<td class="right">' . htmlspecialchars((string)($item['quantity'] ?? '')) . '</td>';
            $variationRows .= '<td>' . htmlspecialchars((string)($item['unit'] ?? '')) . '</td>';
            $variationRows .= '<td>' . htmlspecialchars((string)($item['additive'] ?? '')) . '</td>';
            $variationRows .= '<td>' . htmlspecialchars((string)($item['deductive'] ?? '')) . '</td>';
            $variationRows .= '<td>' . htmlspecialchars((string)($item['new_item'] ?? $item['newItem'] ?? '')) . '</td>';
            $variationRows .= '</tr>';
        }

        $manpowerRows = '';
        foreach ($this->padRows($manpower, 4) as $row) {
            $manpowerRows .= '<tr>';
            $manpowerRows .= '<td>' . htmlspecialchars((string)($row['description'] ?? '')) . '</td>';
            $manpowerRows .= '<td class="right">' . htmlspecialchars((string)($row['quantity'] ?? '')) . '</td>';
            $manpowerRows .= '</tr>';
        }

        $equipmentRows = '';
        foreach ($this->padRows($equipment, 4) as $row) {
            $equipmentRows .= '<tr>';
            $equipmentRows .= '<td>' . htmlspecialchars((string)($row['description'] ?? '')) . '</td>';
            $equipmentRows .= '<td class="right">' . htmlspecialchars((string)($row['quantity'] ?? '')) . '</td>';
            $equipmentRows .= '</tr>';
        }

        $activities = $this->linedListHtml($data['activities'] ?? []);
        $instructions = $this->linedListHtml($data['field_instructions'] ?? []);

        $html = $this->loadTemplate('IAR/official.html');
        $replacements = array_merge($this->logoReplacements($forPdf), [
            'contract_number' => htmlspecialchars($data['contract_number'] ?? ''),
            'project_title' => htmlspecialchars($data['project_title'] ?? $data['project_name'] ?? ''),
            'municipality' => htmlspecialchars($data['municipality'] ?? ''),
            'week_covered' => htmlspecialchars($data['week_covered'] ?? $data['period_covered'] ?? ''),
            'contractor' => htmlspecialchars($data['contractor'] ?? ''),
            'accomplishment_rows' => $rows,
            'variation_rows' => $variationRows,
            'activities_list' => $activities,
            'field_instructions_list' => $instructions,
            'problems_remarks' => nl2br(htmlspecialchars($data['problems_remarks'] ?? $data['remarks'] ?? '')),
            'manpower_rows' => $manpowerRows,
            'equipment_rows' => $equipmentRows,
            'orig_target' => htmlspecialchars((string)($data['orig_target'] ?? '')),
            'rev_target' => htmlspecialchars((string)($data['rev_target'] ?? '')),
            'actual_progress' => htmlspecialchars((string)($data['actual_progress'] ?? $data['percent_complete'] ?? '')),
            'variance' => htmlspecialchars((string)($data['variance'] ?? '')),
            'progress_remarks' => htmlspecialchars((string)($data['progress_remarks'] ?? '')),
            'prepared_by_name' => htmlspecialchars($data['prepared_by_name'] ?? ''),
            'checked_by_name' => htmlspecialchars($data['checked_by_name'] ?? ''),
            'noted_by_name' => htmlspecialchars($data['noted_by_name'] ?? ''),
            'contractor_representative' => htmlspecialchars($data['contractor_representative'] ?? ''),
            'report_number' => htmlspecialchars($data['report_number'] ?? ''),
            'qr_code_img' => $qrDataUri,
        ]);
        foreach ($replacements as $key => $val) {
            $html = str_replace('{{' . $key . '}}', $val, $html);
        }
        return $html;
    }

    /** @param array<int, mixed> $items */
    private function padRows(array $items, int $min): array
    {
        $padded = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $padded[] = $item;
        }
        while (count($padded) < $min) {
            $padded[] = [];
        }
        return $padded;
    }

    /** @param array<int, string> $lines */
    private function linedListHtml(array $lines): string
    {
        $filtered = array_values(array_filter(array_map('strval', $lines), fn($l) => trim($l) !== ''));
        if ($filtered === []) {
            return str_repeat('<p>&nbsp;</p>', 3);
        }
        $html = '';
        foreach ($filtered as $line) {
            $html .= '<p>' . htmlspecialchars($line) . '</p>';
        }
        while (substr_count($html, '<p>') < 3) {
            $html .= '<p>&nbsp;</p>';
        }
        return $html;
    }

    public function renderSwa(array $data, array $lineItems, float $lessAmount, string $qrDataUri, bool $forPdf = true): string
    {
        $showRevised = SwaStewaLinkage::showRevisedQuantity($data);
        $calc = WorkItemCalculator::compute($lineItems, $lessAmount, $showRevised);
        $rows = '';
        foreach ($calc['items'] as $row) {
            $section = !empty($row['isSection']);
            $rows .= '<tr>';
            $rows .= '<td>' . htmlspecialchars($row['itemNo'] ?? '') . '</td>';
            $rows .= '<td class="left">' . htmlspecialchars($row['description'] ?? '') . '</td>';
            if ($section) {
                $blank = $showRevised ? 13 : 10;
                $rows .= str_repeat('<td></td>', $blank);
                $rows .= '</tr>';
                continue;
            }
            $rows .= '<td class="right">' . number_format((float)$row['programmedQty'], 2) . '</td>';
            $rows .= '<td class="right">' . WorkItemCalculator::formatMoney((float)$row['unitPrice']) . '</td>';
            $rows .= '<td>' . htmlspecialchars($row['unit'] ?? '') . '</td>';
            $rows .= '<td class="right">' . WorkItemCalculator::formatMoney((float)$row['contractAmount']) . '</td>';
            $rows .= '<td class="right">' . number_format((float)$row['weightPct'], 2) . '</td>';
            if ($showRevised) {
                $rq = (float)($row['revisedQty'] ?? 0);
                $rows .= '<td class="right">' . ($rq > 0 ? number_format($rq, 2) : '') . '</td>';
                $rows .= '<td class="right">' . WorkItemCalculator::formatMoney((float)($row['revisedAmount'] ?? 0)) . '</td>';
                $rows .= '<td class="right">' . number_format((float)($row['revisedWeightPct'] ?? 0), 2) . '</td>';
            }
            $rows .= '<td class="right">' . ($row['previous'] ? number_format((float)$row['previous'], 2) : '') . '</td>';
            $rows .= '<td class="right">' . number_format((float)$row['thisPeriod'], 2) . '</td>';
            $rows .= '<td class="right">' . number_format((float)$row['toDate'], 2) . '</td>';
            $rows .= '<td class="right">' . number_format((float)$row['accomplishmentWeightPct'], 2) . '</td>';
            $rows .= '<td>' . htmlspecialchars($row['status'] ?? '') . '</td>';
            $rows .= '</tr>';
        }

        $t = $calc['totals'];
        $html = $this->loadTemplate('SWA/official.html');
        $replacements = array_merge($this->logoReplacements($forPdf), [
            'report_date' => htmlspecialchars($this->formatReportDate($data['report_date'] ?? null)),
            'project_name' => htmlspecialchars($data['project_name'] ?? ''),
            'location' => htmlspecialchars($data['location'] ?? ''),
            'contractor' => htmlspecialchars($data['contractor'] ?? ''),
            'report_number' => htmlspecialchars($data['report_number'] ?? ''),
            'revised_header_group' => $showRevised ? '<th colspan="3">REVISED</th>' : '',
            'revised_subheader' => $showRevised
                ? '<th>QUANTITY</th><th>AMOUNT</th><th>WEIGHT %</th>'
                : '',
            'revised_total_cells' => $showRevised
                ? '<td></td><td class="right">' . WorkItemCalculator::formatMoney((float)$t['totalRevisedAmount'])
                    . '</td><td class="right">' . number_format((float)$t['totalRevisedWeightPct'], 2) . '</td>'
                : '',
            'line_items_rows' => $rows,
            'total_contract_amount' => WorkItemCalculator::formatMoney($t['totalContractAmount']),
            'total_weight_pct' => number_format($t['totalWeightPct'], 2),
            'total_accomplishment_weight' => number_format($t['totalToDateWeightPct'], 2),
            'pct_this_accomplishment' => number_format($t['pctThisAccomplishment'], 2),
            'total_project_cost' => WorkItemCalculator::formatMoney($t['totalContractAmount']),
            'total_this_accomplishment' => WorkItemCalculator::formatMoney($t['totalThisAccomplishment']),
            'less_reason' => htmlspecialchars(\Peo\SwaStewaLinkage::lessReason($data)),
            'less_amount' => WorkItemCalculator::formatMoney($lessAmount),
            'advance_payment' => WorkItemCalculator::formatMoney($lessAmount),
            'total_voucher' => WorkItemCalculator::formatMoney($t['totalVoucher']),
            'prepared_by_name' => htmlspecialchars($data['prepared_by_name'] ?? ''),
            'prepared_by_title' => htmlspecialchars($data['prepared_by_title'] ?? 'Engineer I'),
            'checked_by_name' => htmlspecialchars($data['checked_by_name'] ?? ''),
            'checked_by_title' => htmlspecialchars($data['checked_by_title'] ?? 'Chief of Construction Division'),
            'recommending_name' => htmlspecialchars($data['recommending_name'] ?? ''),
            'recommending_title' => htmlspecialchars($data['recommending_title'] ?? 'Provincial Engineer'),
            'approved_by_name' => htmlspecialchars($data['approved_by_name'] ?? ''),
            'approved_by_title' => htmlspecialchars($data['approved_by_title'] ?? 'Governor'),
            'qr_code_img' => $qrDataUri,
        ]);
        foreach ($replacements as $key => $val) {
            $html = str_replace('{{' . $key . '}}', $val, $html);
        }
        return $html;
    }

    private function formatStewaDate(?string $value, bool $allowEmpty = false): string
    {
        if ($value === null || $value === '') {
            return $allowEmpty ? '' : date('F d, Y');
        }
        $ts = strtotime($value);
        return $ts !== false ? date('F d, Y', $ts) : $value;
    }

    private function stewaDash($value): string
    {
        $raw = trim((string) $value);
        if ($raw === '' || $raw === '-' || $raw === '—' || (is_numeric(str_replace(',', '', $raw)) && (float) str_replace(',', '', $raw) == 0.0)) {
            return '—';
        }
        return $raw;
    }

    private function formatReportDate(?string $value, bool $allowEmpty = false): string
    {
        if ($value === null || $value === '') {
            return $allowEmpty ? '' : date('F j, Y');
        }
        $ts = strtotime($value);
        return $ts !== false ? date('F j, Y', $ts) : $value;
    }

    private function loadTemplate(string $relative): string
    {
        $uploaded = $this->templatesDir . '/uploads/' . pathinfo($relative, PATHINFO_FILENAME) . '.html';
        if (is_file($uploaded)) {
            return file_get_contents($uploaded);
        }
        $path = $this->templatesDir . '/' . $relative;
        if (!is_file($path)) {
            throw new \RuntimeException("Template not found: {$relative}");
        }
        return file_get_contents($path);
    }
}
