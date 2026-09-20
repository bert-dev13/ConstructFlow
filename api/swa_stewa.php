<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/mail.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Peo\Auth;
use Peo\ChartAttachmentService;
use Peo\DatabaseSetup;
use Peo\ExcelTemplateService;
use Peo\IarExcelService;
use Peo\PdfReportService;
use Peo\ProjectInfo;
use Peo\QrCodeService;
use Peo\ReportChangeTracker;
use Peo\ReportTemplateRenderer;
use Peo\ScheduleSync;
use Peo\SwaStewaLinkage;
use Peo\WorkItemCalculator;

set_exception_handler(static function (Throwable $e): void {
    jsonError('Server error: ' . $e->getMessage(), 500);
});

$pdo = db();
try {
    DatabaseSetup::ensureSwaStewaTables($pdo);
    DatabaseSetup::ensureUsersAndProjects($pdo);
    DatabaseSetup::seedDemoReportsIfEmpty($pdo);
} catch (Throwable $e) {
    jsonError('Database setup failed: ' . $e->getMessage(), 500);
}
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($method === 'GET' ? 'list' : '');

/**
 * Build a report number of the form TYPE-YEAR-MON-STARTDAY-ENDDAY, e.g. IAR-2026-JAN-6-12.
 * The week is derived from the report date entered by Engineer I: the entered date is
 * treated as the start of the week and the end is start + 6 days (a 7-day span).
 * A numeric suffix is appended only if the same week already has a report of this type.
 */
function nextReportNumber(PDO $pdo, string $type, ?string $reportDate = null): string
{
    $ts = $reportDate ? strtotime($reportDate) : false;
    if ($ts === false) {
        $ts = time();
    }
    $year = date('Y', $ts);
    $month = strtoupper(date('M', $ts));
    $startDay = (int)date('j', $ts);
    $endDay = (int)date('j', $ts + 6 * 86400);
    $base = sprintf('%s-%s-%s-%d-%d', $type, $year, $month, $startDay, $endDay);

    $check = $pdo->prepare('SELECT COUNT(*) FROM swa_stewa_reports WHERE report_number = ?');
    $candidate = $base;
    $suffix = 1;
    while (true) {
        $check->execute([$candidate]);
        if ((int)$check->fetchColumn() === 0) {
            return $candidate;
        }
        $suffix++;
        $candidate = $base . '-' . $suffix;
    }
}

function audit(PDO $pdo, int $reportId, ?int $actorId, string $action, array $details = []): void
{
    $pdo->prepare('INSERT INTO report_audit_log (report_id, actor_id, action, details) VALUES (?, ?, ?, ?)')
        ->execute([$reportId, $actorId, $action, json_encode($details)]);
}

function publicUrl(string $reportNumber): string
{
    return APP_URL . '/reports/view/' . urlencode($reportNumber);
}

/**
 * @param array{role:string} $user
 * Edit rules by report type:
 *  - Engineer I: all report types
 *  - Engineer II: SWA and STEWA only
 *  - Contractor: IAR; SWA/STEWA during contractor review
 */
function assertCanEditReportType(array $user, string $type): void
{
    $role = $user['role'];
    if ($role === 'engineer_1') {
        return;
    }
    if ($role === 'engineer_2') {
        if ($type !== 'SWA' && $type !== 'STEWA') {
            jsonError('Engineer II can only edit SWA and STEWA reports', 403);
        }
        return;
    }
    if ($role === 'contractor') {
        if ($type === 'IAR') {
            return;
        }
        if ($type === 'SWA' || $type === 'STEWA') {
            return;
        }
        jsonError('Contractors can only edit IAR, SWA, and STEWA reports', 403);
    }
    jsonError('You do not have permission to edit this report', 403);
}

/** @param array{role:string} $user */
/** @param array<string, mixed> $report */
function assertCanEditReport(array $user, array $report): void
{
    assertCanEditReportType($user, (string)$report['report_type']);
    $role = $user['role'];
    $status = (string)$report['status'];
    $type = (string)$report['report_type'];

    $locked = ['pending_review', 'with_engineer_3', 'with_engineer_4', 'approved', 'generated'];
    if (in_array($status, $locked, true)) {
        jsonError('This report cannot be edited in its current status');
    }

    if ($role === 'contractor') {
        if ($type === 'IAR') {
            if (!in_array($status, ['draft', 'rejected'], true)) {
                jsonError('IAR can only be edited while draft or rejected');
            }
            return;
        }
        if (!in_array($status, ['pending_contractor', 'rejected'], true)) {
            jsonError('SWA/STEWA can only be edited during contractor review');
        }
        return;
    }

    if ($role === 'engineer_2') {
        if (!in_array($status, ['draft', 'rejected'], true)) {
            jsonError('Engineer II can only edit draft or rejected reports');
        }
        return;
    }

    // Engineer I
    if (!in_array($status, ['draft', 'rejected', 'pending_contractor', 'contractor_confirmed'], true)) {
        jsonError('Report cannot be edited in current status');
    }
}

function getReport(PDO $pdo, string $idOrNumber): ?array
{
    $stmt = $pdo->prepare(
        'SELECT r.*, p.name AS project_name_db, p.location AS project_location
         FROM swa_stewa_reports r
         JOIN projects p ON p.id = r.project_id
         WHERE r.id = ? OR r.report_number = ?'
    );
    $stmt->execute([$idOrNumber, $idOrNumber]);
    $row = $stmt->fetch();
    if ($row) {
        $row['report_data'] = json_decode($row['report_data'], true);
        $row['line_items'] = json_decode($row['line_items'] ?? '[]', true);
        $row['contractor_baseline'] = json_decode($row['contractor_baseline'] ?? 'null', true);
        $row['contractor_changes'] = json_decode($row['contractor_changes'] ?? '[]', true);
    }
    return $row ?: null;
}

function syncScurveFromReports(PDO $pdo, int $projectId, ?string $reportLabel = null): void
{
    try {
        $pdm = ScheduleSync::loadPdmResult($pdo, $projectId);
        if (($pdm['activities'] ?? []) === []) {
            return;
        }
        ScheduleSync::syncDerivedViews(
            $pdo,
            $projectId,
            $pdm,
            [],
            'report_progress',
            $reportLabel ?? 'Progress report approved',
        );
    } catch (\Throwable) {
        // Non-fatal
    }
}

function patchReportData(PDO $pdo, int $reportId, array $patch): array
{
    $report = getReport($pdo, (string)$reportId);
    if (!$report) {
        jsonError('Not found', 404);
    }
    $data = array_merge($report['report_data'] ?? [], $patch);
    $pdo->prepare('UPDATE swa_stewa_reports SET report_data=?, updated_at=NOW() WHERE id=?')
        ->execute([json_encode($data), $reportId]);
    return getReport($pdo, (string)$reportId) ?? $report;
}

function contractorNameForProject(PDO $pdo, int $projectId): string
{
    $stmt = $pdo->prepare(
        "SELECT u.full_name FROM projects p
         LEFT JOIN users u ON u.id = p.contractor_id
         WHERE p.id = ? LIMIT 1"
    );
    $stmt->execute([$projectId]);
    $name = trim((string)($stmt->fetchColumn() ?: ''));
    if ($name !== '') {
        return $name;
    }
    $fallback = $pdo->query(
        "SELECT full_name FROM users WHERE role='contractor' AND is_active=1 ORDER BY id LIMIT 1"
    )->fetchColumn();
    return trim((string)($fallback ?: 'Contractor Representative'));
}

function applyIarSubmitSignatures(PDO $pdo, array $user, int $reportId): array
{
    $report = getReport($pdo, (string)$reportId);
    if (!$report || $report['report_type'] !== 'IAR') {
        return $report ?? [];
    }
    $name = trim((string)($user['full_name'] ?? $user['name'] ?? ''));
    $patch = [];
    if ($name !== '') {
        $patch['prepared_by_name'] = $name;
    }
    $patch['contractor_representative'] = contractorNameForProject($pdo, (int)$report['project_id']);
    return patchReportData($pdo, $reportId, $patch);
}

function generateOfficialPdf(array $report): array
{
    $reportNumber = $report['report_number'];
    $publicUrl = publicUrl($reportNumber);
    $qrUri = QrCodeService::toDataUri($publicUrl);
    $data = array_merge($report['report_data'], ['report_number' => $reportNumber]);
    $basePath = dirname(__DIR__) . '/storage/reports/' . $reportNumber;
    $xlsxRel = null;

    // Excel template → downloadable .xlsx only (spreadsheet PDF export drops embedded logos)
    if ($report['report_type'] === 'IAR') {
        $iar = new IarExcelService();
        if ($iar->hasTemplate()) {
            try {
                $iar->generate($data, $publicUrl, $basePath);
                $xlsxRel = 'storage/reports/' . $reportNumber . '.xlsx';
            } catch (Throwable) {
                $xlsxRel = null;
            }
        }
    } else {
        $excel = new ExcelTemplateService();
        if ($excel->hasTemplate($report['report_type'])) {
            try {
                $excel->generate(
                    $report['report_type'],
                    $data,
                    $report['line_items'] ?? [],
                    $publicUrl,
                    $basePath,
                );
                $xlsxRel = 'storage/reports/' . $reportNumber . '.xlsx';
            } catch (Throwable) {
                $xlsxRel = null;
            }
        }
    }

    // Official PDF always from HTML template (includes provincial seal + QR)
    $renderer = new ReportTemplateRenderer();
    $html = match ($report['report_type']) {
        'STEWA' => $renderer->renderStewa($data, $qrUri),
        'IAR' => $renderer->renderIar($data, $qrUri),
        default => $renderer->renderSwa(
            $data,
            $report['line_items'] ?? [],
            SwaStewaLinkage::lessAmount($report['report_data'] ?? []),
            $qrUri,
        ),
    };

    $pdfPath = $basePath . '.pdf';
    $orientation = $report['report_type'] === 'SWA' ? 'landscape' : 'portrait';
    (new PdfReportService())->generateFromHtml($html, $pdfPath, $orientation);
    return ['pdf' => 'storage/reports/' . $reportNumber . '.pdf', 'xlsx' => $xlsxRel];
}

function getTemplateStatus(): array
{
    $types = ['STEWA', 'SWA', 'IAR'];
    $result = [];
    $excelDir = dirname(__DIR__) . '/templates/excel';

    foreach ($types as $type) {
        $path = $excelDir . '/' . $type . '.xlsx';
        $entry = [
            'report_type' => $type,
            'exists' => false,
            'filename' => null,
            'stored_path' => null,
            'file_size' => null,
            'file_size_label' => null,
            'uploaded_at' => null,
            'download_url' => null,
        ];

        if (is_file($path)) {
            $bytes = filesize($path) ?: 0;
            $entry['exists'] = true;
            $entry['filename'] = $type . '.xlsx';
            $entry['stored_path'] = 'templates/excel/' . $type . '.xlsx';
            $entry['file_size'] = $bytes;
            $entry['file_size_label'] = $bytes >= 1048576
                ? round($bytes / 1048576, 1) . ' MB'
                : round($bytes / 1024, 1) . ' KB';
            $entry['uploaded_at'] = date('M j, Y g:i A', filemtime($path) ?: time());
            $entry['download_url'] = APP_URL . '/templates/excel/' . $type . '.xlsx';
        }

        $result[] = $entry;
    }

    return $result;
}

// ─── GET list / single / public view ───
if ($method === 'GET') {
    if ($action === 'templates' || isset($_GET['templates'])) {
        Auth::requireRoles(['engineer_4']);
        jsonResponse(['templates' => getTemplateStatus()]);
    }

    if ($action === 'stewa_from_swa') {
        Auth::requireAuth();
        $projectId = (int)($_GET['project_id'] ?? 0);
        $dateRaw = (string)($_GET['report_date'] ?? '');
        if (!$projectId || $dateRaw === '') {
            jsonError('project_id and report_date required');
        }
        $date = ScheduleSync::parseReportDate($dateRaw);
        if ($date === null) {
            jsonError('Invalid report_date');
        }
        $fromSwa = SwaStewaLinkage::stewaPercentsFromSwa($pdo, $projectId, $date);
        $actual = $fromSwa['percent_actual'];
        $planned = $fromSwa['percent_planned'];
        jsonResponse([
            'percent_actual' => $actual,
            'percent_planned' => $planned,
            'swa_report_number' => $fromSwa['swa_report_number'],
            'slippage' => ($actual !== null && $planned !== null)
                ? SwaStewaLinkage::stewaSlippage($actual, $planned)
                : null,
        ]);
    }

    if ($action === 'revisions' && isset($_GET['report_id'])) {
        Auth::requireAuth();
        $reportId = (int)$_GET['report_id'];
        $stmt = $pdo->prepare(
            'SELECT r.revision_number, r.report_data, r.line_items, r.created_at, u.full_name AS changed_by_name
             FROM report_revisions r
             LEFT JOIN users u ON u.id = r.changed_by
             WHERE r.report_id = ?
             ORDER BY r.revision_number DESC'
        );
        $stmt->execute([$reportId]);
        $revs = [];
        foreach ($stmt->fetchAll() as $row) {
            $revs[] = [
                'revision_number' => (int)$row['revision_number'],
                'report_data' => json_decode((string)$row['report_data'], true),
                'line_items' => json_decode((string)($row['line_items'] ?? '[]'), true),
                'created_at' => $row['created_at'],
                'changed_by_name' => $row['changed_by_name'],
            ];
        }
        jsonResponse(['revisions' => $revs]);
    }

    if ($action === 'audit' && isset($_GET['report_id'])) {
        Auth::requireAuth();
        $reportId = (int)$_GET['report_id'];
        $stmt = $pdo->prepare(
            'SELECT a.action, a.details, a.created_at, u.full_name AS actor_name
             FROM report_audit_log a
             LEFT JOIN users u ON u.id = a.actor_id
             WHERE a.report_id = ?
             ORDER BY a.created_at ASC, a.id ASC'
        );
        $stmt->execute([$reportId]);
        jsonResponse(['audit' => $stmt->fetchAll() ?: []]);
    }

    if ($action === 'verify' || isset($_GET['qr'])) {
        $qr = trim((string)($_GET['qr'] ?? ''));
        $report = getReport($pdo, $qr);
        if (!$report && str_contains($qr, 'reports/view/')) {
            $parts = explode('/', $qr);
            $report = getReport($pdo, urldecode(end($parts)));
        }
        if (!$report) {
            jsonResponse(['valid' => false, 'message' => 'QR code not found'], 404);
        }
        jsonResponse([
            'valid' => true,
            'verified' => in_array($report['status'], ['approved', 'generated'], true),
            'report' => $report,
        ]);
    }

    if ($action === 'pdf') {
        $num = trim((string)($_GET['report_number'] ?? ''));
        $report = getReport($pdo, $num);
        if (!$report) {
            jsonError('Record Not Found', 404);
        }
        if (!in_array((string)$report['status'], ['approved', 'generated'], true)) {
            jsonError('Official PDF is available after approval.', 403);
        }

        $rel = (string)($report['pdf_file'] ?? ('storage/reports/' . $report['report_number'] . '.pdf'));
        $abs = dirname(__DIR__) . '/' . ltrim($rel, '/');
        if (!is_file($abs)) {
            try {
                $files = generateOfficialPdf($report);
                $rel = $files['pdf'];
                $abs = dirname(__DIR__) . '/' . $rel;
                $pdo->prepare('UPDATE swa_stewa_reports SET pdf_file=?, generated_at=COALESCE(generated_at, NOW()) WHERE id=?')
                    ->execute([$rel, (int)$report['id']]);
            } catch (Throwable $e) {
                jsonError('Could not generate PDF: ' . $e->getMessage(), 500);
            }
        }
        if (!is_file($abs)) {
            jsonError('PDF file is missing.', 404);
        }

        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . basename($abs) . '"');
        header('Content-Length: ' . (string)filesize($abs));
        header('Cache-Control: private, max-age=60');
        readfile($abs);
        exit;
    }

    if ($action === 'view' || isset($_GET['report_number'])) {
        $num = $_GET['report_number'] ?? '';
        $report = getReport($pdo, $num);
        if (!$report) {
            jsonResponse(['valid' => false, 'message' => 'Record Not Found'], 404);
        }
        $verified = in_array($report['status'], ['approved', 'generated'], true);
        $pdfUrl = $verified
            ? APP_URL . '/api/swa_stewa.php?action=pdf&report_number=' . rawurlencode((string)$report['report_number'])
                . '&v=' . rawurlencode((string)($report['updated_at'] ?? $report['generated_at'] ?? time()))
            : null;
        jsonResponse([
            'valid' => true,
            'verified' => $verified,
            'report' => $report,
            'pdf_url' => $pdfUrl,
            'public_url' => $report['public_url'],
        ]);
    }

    if (isset($_GET['id'])) {
        Auth::requireAuth();
        $report = getReport($pdo, $_GET['id']);
        if (!$report) jsonError('Not found', 404);
        jsonResponse(['report' => $report]);
    }

    Auth::requireAuth();

    $where = [];
    $params = [];
    if (!empty($_GET['project_id'])) {
        $where[] = 'r.project_id = ?';
        $params[] = $_GET['project_id'];
    }
    if (!empty($_GET['status'])) {
        $where[] = 'r.status = ?';
        $params[] = $_GET['status'];
    }
    if (!empty($_GET['type'])) {
        $where[] = 'r.report_type = ?';
        $params[] = $_GET['type'];
    }
    if (!empty($_GET['q'])) {
        $where[] = '(r.report_number LIKE ? OR p.name LIKE ?)';
        $params[] = '%' . $_GET['q'] . '%';
        $params[] = '%' . $_GET['q'] . '%';
    }

    $sql = 'SELECT r.id, r.report_number, r.report_type, r.status, r.created_at, r.generated_at,
                   r.project_id, r.report_data, r.rejection_reason, r.public_url,
                   p.name AS project_name
            FROM swa_stewa_reports r
            JOIN projects p ON p.id = r.project_id';
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY r.created_at DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        $row['report_data'] = json_decode((string)($row['report_data'] ?? '{}'), true) ?: [];
    }
    unset($row);
    jsonResponse(['reports' => $rows]);
}

// ─── POST actions ───
if ($method === 'POST') {
    // Multipart template upload
    if (!empty($_FILES['template_file']['tmp_name']) && !empty($_POST['report_type'])) {
        Auth::requireRoles(['engineer_4']);
        $type = $_POST['report_type'];
        if (!in_array($type, ['SWA', 'STEWA', 'IAR'], true)) {
            jsonError('Invalid type');
        }

        if ($_FILES['template_file']['error'] !== UPLOAD_ERR_OK) {
            jsonError('Upload failed (error code ' . $_FILES['template_file']['error'] . ')');
        }

        $dir = dirname(__DIR__) . '/templates/uploads';
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $ext = strtolower(pathinfo($_FILES['template_file']['name'], PATHINFO_EXTENSION));
        if (in_array($ext, ['xlsx', 'xls'], true)) {
            $excelDir = dirname(__DIR__) . '/templates/excel';
            if (!is_dir($excelDir)) {
                mkdir($excelDir, 0755, true);
            }
            $dest = $excelDir . '/' . $type . '.xlsx';
            $stored = 'templates/excel/' . $type . '.xlsx';
            // Replace any previous template so the new file (with formulas) is used.
            if (is_file($dest)) {
                unlink($dest);
            }
        } else {
            $dest = $dir . '/' . $type . '.' . $ext;
            $stored = 'templates/uploads/' . $type . '.' . $ext;
            if (is_file($dest)) {
                unlink($dest);
            }
        }

        if (!move_uploaded_file($_FILES['template_file']['tmp_name'], $dest)) {
            jsonError('Could not save file to ' . $dest);
        }

        try {
            $pdo->prepare(
                'INSERT INTO report_templates (report_type, original_filename, stored_path)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE original_filename=VALUES(original_filename), stored_path=VALUES(stored_path), uploaded_at=NOW()'
            )->execute([$type, $_FILES['template_file']['name'], $stored]);
        } catch (Throwable $e) {
            // File is saved; DB log is optional
        }

        $msg = match ($ext) {
            'xlsx', 'xls' => 'Excel template uploaded successfully. Reports will use this file on approval.',
            'html', 'htm' => 'HTML template active for PDF generation.',
            default => 'Template stored.',
        };
        jsonResponse(['message' => $msg, 'path' => $stored]);
    }

    $body = readJsonBody();
    $action = $body['action'] ?? 'save';

    if ($action === 'save' || $action === 'preview') {
        $user = Auth::requireRoles(['engineer_1', 'engineer_2', 'contractor']);
        $reportId = (int)($body['id'] ?? 0);
        $type = $body['report_type'] ?? '';
        if ($reportId) {
            $existingType = getReport($pdo, (string)$reportId);
            if ($existingType) {
                $type = (string)$existingType['report_type'];
            }
        }
        assertCanEditReportType($user, $type);
        $projectId = (int)($body['project_id'] ?? 0);
        $reportData = $body['report_data'] ?? [];
        $lineItems = $body['line_items'] ?? [];
        $createdBy = Auth::actorId() ?? (int)($body['created_by'] ?? 0);

        if (!in_array($type, ['SWA', 'STEWA', 'IAR'], true) || !$projectId) {
            jsonError('report_type and project_id required');
        }

        if ($type === 'SWA' && $lineItems) {
            $reportData = SwaStewaLinkage::enrichSwaReportData($pdo, $projectId, $reportData, $lineItems);
        }
        if ($type === 'STEWA') {
            $reportData = SwaStewaLinkage::applyStewaFromSwa($pdo, $projectId, $reportData);
        }

        if ($reportId) {
            $existing = getReport($pdo, (string)$reportId);
            if (!$existing) jsonError('Report not found', 404);
            assertCanEditReport($user, $existing);

            $rev = $pdo->prepare('SELECT COALESCE(MAX(revision_number),0)+1 FROM report_revisions WHERE report_id=?');
            $rev->execute([$reportId]);
            $revNum = (int)$rev->fetchColumn();
            $pdo->prepare('INSERT INTO report_revisions (report_id, revision_number, report_data, line_items, changed_by) VALUES (?,?,?,?,?)')
                ->execute([$reportId, $revNum, json_encode($existing['report_data']), json_encode($existing['line_items']), $createdBy]);

            $contractorChanges = $existing['contractor_changes'] ?? [];
            if ($user['role'] === 'contractor' && in_array($existing['status'], ['pending_contractor', 'rejected'], true)) {
                $baseline = is_array($existing['contractor_baseline'] ?? null)
                    ? $existing['contractor_baseline']
                    : ['report_data' => $existing['report_data'], 'line_items' => $existing['line_items']];
                $newChanges = ReportChangeTracker::diff(
                    $baseline['report_data'] ?? [],
                    $baseline['line_items'] ?? [],
                    $reportData,
                    $lineItems,
                );
                $contractorChanges = $newChanges;
            }

            $pdo->prepare(
                'UPDATE swa_stewa_reports SET report_data=?, line_items=?, contractor_changes=?, updated_at=NOW() WHERE id=?'
            )->execute([json_encode($reportData), json_encode($lineItems), json_encode($contractorChanges), $reportId]);
            audit($pdo, $reportId, $createdBy, 'updated', ['changed_fields' => count($contractorChanges)]);
            $report = getReport($pdo, (string)$reportId);
        } else {
            $reportNumber = nextReportNumber($pdo, $type, $reportData['report_date'] ?? null);
            $public = publicUrl($reportNumber);
            $stmt = $pdo->prepare(
                'INSERT INTO swa_stewa_reports (report_number, project_id, report_type, report_data, line_items, public_url, status, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([
                $reportNumber, $projectId, $type,
                json_encode($reportData), json_encode($lineItems),
                $public, 'draft', $createdBy ?: null,
            ]);
            $reportId = (int)$pdo->lastInsertId();
            audit($pdo, $reportId, $createdBy, 'created');

            // Auto-fill from current project record when fields are empty
            $defaults = ProjectInfo::reportDefaults($pdo, $projectId);
            $prefill = [];
            if (empty($reportData['project_name'])) {
                $prefill['project_name'] = $defaults['project_name'];
            }
            if (empty($reportData['location']) && $defaults['location']) {
                $prefill['location'] = $defaults['location'];
            }
            if (empty($reportData['contractor']) && $defaults['contractor']) {
                $prefill['contractor'] = $defaults['contractor'];
            }
            if (empty($reportData['contract_amount']) && $defaults['contract_amount']) {
                $prefill['contract_amount'] = $defaults['contract_amount'];
            }
            if ($type === 'STEWA' && empty($reportData['notice_to_proceed']) && $defaults['start_date']) {
                $prefill['notice_to_proceed'] = $defaults['start_date'];
            }
            if ($prefill !== []) {
                $reportData = array_merge($reportData, $prefill);
                $pdo->prepare('UPDATE swa_stewa_reports SET report_data=? WHERE id=?')
                    ->execute([json_encode($reportData), $reportId]);
            }

            $report = getReport($pdo, (string)$reportId);
        }

        $previewHtml = null;
        if ($action === 'preview') {
            $qrUri = QrCodeService::toDataUri($report['public_url']);
            $renderer = new ReportTemplateRenderer();
            $data = array_merge($reportData, ['report_number' => $report['report_number']]);
            $previewHtml = match ($type) {
                'STEWA' => $renderer->renderStewa($data, $qrUri, false),
                'IAR' => $renderer->renderIar($data, $qrUri, false),
                default => $renderer->renderSwa(
                    $data,
                    $lineItems,
                    SwaStewaLinkage::lessAmount($reportData),
                    $qrUri,
                    false,
                ),
            };
        }

        jsonResponse(['report' => $report, 'preview_html' => $previewHtml]);
    }

    if ($action === 'send_to_contractor') {
        $user = Auth::requireRoles(['engineer_1']);
        $reportId = (int)($body['report_id'] ?? 0);
        $report = getReport($pdo, (string)$reportId);
        if (!$report) jsonError('Not found', 404);
        if (!in_array($report['report_type'], ['SWA', 'STEWA'], true)) {
            jsonError('Only SWA and STEWA can be sent to the contractor');
        }
        if (!in_array($report['status'], ['draft', 'rejected'], true)) {
            jsonError('Report must be draft or rejected to send to contractor');
        }
        $baseline = [
            'report_data' => $report['report_data'],
            'line_items' => $report['line_items'],
        ];
        $pdo->prepare(
            "UPDATE swa_stewa_reports SET status='pending_contractor', contractor_baseline=?, contractor_changes='[]', updated_at=NOW() WHERE id=?"
        )->execute([json_encode($baseline), $reportId]);
        audit($pdo, $reportId, Auth::actorId(), 'sent_to_contractor');
        jsonResponse(['status' => 'pending_contractor']);
    }

    if ($action === 'contractor_confirm') {
        $user = Auth::requireRoles(['contractor']);
        $reportId = (int)($body['report_id'] ?? 0);
        $report = getReport($pdo, (string)$reportId);
        if (!$report) jsonError('Not found', 404);
        if ($report['status'] !== 'pending_contractor') {
            jsonError('Report is not awaiting contractor confirmation');
        }
        $pdo->prepare("UPDATE swa_stewa_reports SET status='contractor_confirmed', updated_at=NOW() WHERE id=?")
            ->execute([$reportId]);
        audit($pdo, $reportId, Auth::actorId(), 'contractor_confirmed', [
            'changes' => $report['contractor_changes'] ?? [],
        ]);
        jsonResponse(['status' => 'contractor_confirmed', 'report' => getReport($pdo, (string)$reportId)]);
    }

    if ($action === 'submit') {
        $user = Auth::requireRoles(['engineer_1', 'engineer_2', 'contractor']);
        $reportId = (int)($body['report_id'] ?? 0);
        $report = getReport($pdo, (string)$reportId);
        if (!$report) jsonError('Not found', 404);
        assertCanEditReportType($user, (string)$report['report_type']);

        if ($user['role'] === 'contractor') {
            jsonError('Contractors must use Confirm — not Submit');
        }
        if ($user['role'] === 'engineer_1' && in_array($report['report_type'], ['SWA', 'STEWA'], true)) {
            if (!in_array($report['status'], ['draft', 'contractor_confirmed', 'rejected'], true)) {
                jsonError('Send to contractor for review, or wait for contractor confirmation before submitting to Engineer II');
            }
        } elseif (!in_array($report['status'], ['draft', 'rejected'], true)) {
            jsonError('Only draft or rejected reports can be submitted');
        }
        if ($report['report_type'] === 'IAR') {
            $report = applyIarSubmitSignatures($pdo, $user, $reportId);
        }
        $pdo->prepare("UPDATE swa_stewa_reports SET status='pending_review', updated_at=NOW() WHERE id=?")
            ->execute([$reportId]);
        audit($pdo, $reportId, Auth::actorId(), 'submitted');
        $report = getReport($pdo, (string)$reportId);
        try {
            $preview = generateOfficialPdf($report);
            mailSwaSubmitToEngineer2($pdo, $reportId, $preview['pdf']);
        } catch (Throwable $e) {
            audit($pdo, $reportId, null, 'email_failed', ['step' => 'submit', 'error' => $e->getMessage()]);
        }
        jsonResponse(['status' => 'pending_review']);
    }

    if ($action === 'email_approve') {
        $reportId = (int)($body['report_id'] ?? 0);
        $token = (string)($body['token'] ?? '');
        if (!$reportId || $token === '' || !validateSwaEmailToken($pdo, $reportId, 'approve', $token)) {
            jsonError('Invalid or expired approval link', 403);
        }
        $report = getReport($pdo, (string)$reportId);
        if (!$report) jsonError('Not found', 404);
        if ($report['status'] !== 'pending_review') {
            jsonError('Report is not pending Engineer II review');
        }
        if ($report['report_type'] === 'IAR') {
            $eng2 = $pdo->query(
                "SELECT full_name FROM users WHERE role='engineer_2' AND is_active=1 ORDER BY id LIMIT 1"
            )->fetchColumn();
            if ($eng2) {
                patchReportData($pdo, $reportId, ['checked_by_name' => (string)$eng2]);
            }
        }
        $pdo->prepare("UPDATE swa_stewa_reports SET status='with_engineer_3', updated_at=NOW() WHERE id=?")
            ->execute([$reportId]);
        audit($pdo, $reportId, 2, 'email_approved_forwarded');
        $report = getReport($pdo, (string)$reportId);
        try {
            $preview = generateOfficialPdf($report);
            mailSwaForwardToEngineer3($pdo, $reportId, $preview['pdf']);
        } catch (Throwable) {
            mailSwaForwardToEngineer3($pdo, $reportId, null);
        }
        jsonResponse(['status' => 'with_engineer_3', 'message' => 'Approved via email — forwarded to Engineer III']);
    }

    if ($action === 'email_revise') {
        $reportId = (int)($body['report_id'] ?? 0);
        $token = (string)($body['token'] ?? '');
        $reason = trim((string)($body['reason'] ?? ''));
        if (!$reportId || $token === '' || !validateSwaEmailToken($pdo, $reportId, 'revise', $token)) {
            jsonError('Invalid or expired revision link', 403);
        }
        if ($reason === '') {
            jsonError('Revision comments are required');
        }
        $pdo->prepare("UPDATE swa_stewa_reports SET status='rejected', rejection_reason=?, updated_at=NOW() WHERE id=?")
            ->execute([$reason, $reportId]);
        audit($pdo, $reportId, 2, 'email_revision_requested', ['reason' => $reason]);
        mailSwaNotifyRevision($pdo, $reportId, $reason);
        jsonResponse(['status' => 'rejected', 'message' => 'Revision request sent to Engineer I']);
    }

    if ($action === 'approve') {
        $user = Auth::requireRoles(['engineer_2', 'engineer_3', 'engineer_4']);
        $reportId = (int)($body['report_id'] ?? 0);
        $actorId = Auth::actorId() ?? 0;
        $actorRole = $user['role'];
        $report = getReport($pdo, (string)$reportId);
        if (!$report) jsonError('Not found', 404);

        // Engineer II forwards to Engineer III (no Documents yet). Stores generate options + signature.
        if ($actorRole === 'engineer_2') {
            if ($report['status'] !== 'pending_review') {
                jsonError('Report is not pending Engineer II review');
            }
            $gen = $body['generate'] ?? [];
            $patch = [
                'generate_s_curve' => !empty($gen['s_curve']),
                'generate_pdm' => !empty($gen['pdm']),
                'generate_bar_chart' => !empty($gen['bar_chart']),
            ];
            $eng2Name = trim((string)($user['full_name'] ?? $user['name'] ?? ''));
            if ($eng2Name !== '' && $report['report_type'] === 'IAR') {
                $patch['checked_by_name'] = $eng2Name;
            }
            $report = patchReportData($pdo, $reportId, $patch);

            $pdo->prepare("UPDATE swa_stewa_reports SET status='with_engineer_3', approved_by=?, updated_at=NOW() WHERE id=?")
                ->execute([$actorId, $reportId]);
            audit($pdo, $reportId, $actorId, 'forwarded_to_engineer_3', $patch);
            $report = getReport($pdo, (string)$reportId);
            try {
                $preview = generateOfficialPdf($report);
                mailSwaForwardToEngineer3($pdo, $reportId, $preview['pdf']);
            } catch (Throwable) {
                mailSwaForwardToEngineer3($pdo, $reportId, $report['pdf_file'] ?? null);
            }
            jsonResponse(['status' => 'with_engineer_3', 'message' => 'Forwarded to Engineer III for checking']);
        }

        // Engineer III accepts → Engineer IV (adds Eng III signature on IAR; no Eng IV signature)
        if ($actorRole === 'engineer_3') {
            if ($report['status'] !== 'with_engineer_3') {
                jsonError('Report is not pending Engineer III review');
            }
            $eng3Name = trim((string)($user['full_name'] ?? $user['name'] ?? ''));
            if ($eng3Name !== '' && $report['report_type'] === 'IAR') {
                $report = patchReportData($pdo, $reportId, ['noted_by_name' => $eng3Name]);
            }
            $pdo->prepare("UPDATE swa_stewa_reports SET status='with_engineer_4', approved_by=?, updated_at=NOW() WHERE id=?")
                ->execute([$actorId, $reportId]);
            audit($pdo, $reportId, $actorId, 'forwarded_to_engineer_4');
            jsonResponse(['status' => 'with_engineer_4', 'message' => 'Forwarded to Engineer IV for final approval']);
        }

        // Engineer IV acceptance only — final PDF + email to all with IAR (+ optional charts)
        if ($actorRole !== 'engineer_4') {
            jsonError('Only Engineer IV can finalize reports');
        }
        if ($report['status'] !== 'with_engineer_4' && $report['status'] !== 'with_engineer_3') {
            jsonError('Report is not ready for final approval');
        }

        $pdo->prepare("UPDATE swa_stewa_reports SET status='approved', approved_by=?, updated_at=NOW() WHERE id=?")
            ->execute([$actorId, $reportId]);
        audit($pdo, $reportId, $actorId, 'approved');

        $report = getReport($pdo, (string)$reportId);
        $files = generateOfficialPdf($report);
        $pdfRel = $files['pdf'];
        $reportData = $report['report_data'];
        if ($files['xlsx']) {
            $reportData['excel_file'] = $files['xlsx'];
        }

        $chartFlags = [
            's_curve' => !empty($reportData['generate_s_curve']),
            'pdm' => !empty($reportData['generate_pdm']),
            'bar_chart' => !empty($reportData['generate_bar_chart']),
        ];
        $extraAttachments = [];
        try {
            $extraAttachments = ChartAttachmentService::generateSelected($pdo, $report, $chartFlags);
            $reportData['generated_attachments'] = $extraAttachments;
        } catch (Throwable $e) {
            audit($pdo, $reportId, $actorId, 'chart_generate_failed', ['error' => $e->getMessage()]);
        }

        $pdo->prepare("UPDATE swa_stewa_reports SET status='generated', pdf_file=?, qr_code=?, report_data=?, generated_at=NOW() WHERE id=?")
            ->execute([$pdfRel, $report['public_url'], json_encode($reportData), $reportId]);
        audit($pdo, $reportId, $actorId, 'pdf_generated', $files);
        if (in_array($report['report_type'], ['SWA', 'STEWA', 'IAR'], true)) {
            syncScurveFromReports(
                $pdo,
                (int)$report['project_id'],
                (string)$report['report_type'] . ' · ' . (string)$report['report_number'],
            );
        }
        try {
            mailFinalApprovedPackage($pdo, $reportId, $pdfRel, $extraAttachments);
        } catch (Throwable $e) {
            audit($pdo, $reportId, $actorId, 'email_failed', ['step' => 'final_package', 'error' => $e->getMessage()]);
        }

        jsonResponse([
            'status' => 'generated',
            'pdf_url' => APP_URL . '/' . $pdfRel,
            'xlsx_url' => $files['xlsx'] ? APP_URL . '/' . $files['xlsx'] : null,
            'public_url' => $report['public_url'],
            'attachments' => $extraAttachments,
        ]);
    }

    if ($action === 'regenerate_pdf') {
        Auth::requireRoles(['engineer_4']);
        $reportId = (int)($body['report_id'] ?? 0);
        $reportNumber = trim((string)($body['report_number'] ?? ''));
        $lookup = $reportId > 0 ? (string)$reportId : $reportNumber;
        if ($lookup === '') {
            jsonError('report_id or report_number required');
        }
        $report = getReport($pdo, $lookup);
        if (!$report) {
            jsonError('Not found', 404);
        }
        $reportId = (int)$report['id'];
        if (!in_array($report['status'], ['approved', 'generated'], true)) {
            jsonError('PDF can only be regenerated for approved reports');
        }
        $files = generateOfficialPdf($report);
        $reportData = $report['report_data'];
        if ($files['xlsx']) {
            $reportData['excel_file'] = $files['xlsx'];
        }
        $pdo->prepare("UPDATE swa_stewa_reports SET pdf_file=?, report_data=?, generated_at=NOW() WHERE id=?")
            ->execute([$files['pdf'], json_encode($reportData), $reportId]);
        audit($pdo, $reportId, Auth::actorId(), 'pdf_regenerated', $files);
        jsonResponse([
            'status' => 'generated',
            'pdf_url' => APP_URL . '/' . $files['pdf'],
            'xlsx_url' => $files['xlsx'] ? APP_URL . '/' . $files['xlsx'] : null,
        ]);
    }

    if ($action === 'reject') {
        Auth::requireRoles(['engineer_2']);
        $reportId = (int)($body['report_id'] ?? 0);
        $reason = $body['reason'] ?? '';
        $pdo->prepare("UPDATE swa_stewa_reports SET status='rejected', rejection_reason=?, updated_at=NOW() WHERE id=?")
            ->execute([$reason, $reportId]);
        audit($pdo, $reportId, Auth::actorId(), 'rejected', ['reason' => $reason]);
        $report = getReport($pdo, (string)$reportId);
        try {
            $pdf = $report ? ($report['pdf_file'] ?? null) : null;
            mailSwaNotifyRevision($pdo, $reportId, $reason, $pdf);
        } catch (Throwable) {
            // queue logged in swa_email_queue
        }
        jsonResponse(['status' => 'rejected']);
    }

    if ($action === 'clear_template') {
        Auth::requireRoles(['engineer_4']);
        $type = strtoupper(trim((string)($body['report_type'] ?? '')));
        if (!in_array($type, ['SWA', 'STEWA', 'IAR'], true)) {
            jsonError('Invalid report_type');
        }

        $excelPath = dirname(__DIR__) . '/templates/excel/' . $type . '.xlsx';
        $removed = [];
        if (is_file($excelPath)) {
            if (!unlink($excelPath)) {
                jsonError('Could not delete Excel template file.');
            }
            $removed[] = 'templates/excel/' . $type . '.xlsx';
        }

        $uploadDir = dirname(__DIR__) . '/templates/uploads';
        foreach (['xlsx', 'xls', 'html', 'htm'] as $ext) {
            $path = $uploadDir . '/' . $type . '.' . $ext;
            if (is_file($path)) {
                unlink($path);
                $removed[] = 'templates/uploads/' . $type . '.' . $ext;
            }
        }

        try {
            $pdo->prepare('DELETE FROM report_templates WHERE report_type = ?')->execute([$type]);
        } catch (Throwable) {
            // Table may not exist on older installs
        }

        jsonResponse([
            'message' => $type . ' template cleared. You can upload a new Excel file with formulas.',
            'removed' => $removed,
            'templates' => getTemplateStatus(),
        ]);
    }

    if ($action === 'delete') {
        Auth::requireRoles(['engineer_4']);
        $reportId = (int)($body['report_id'] ?? 0);
        $report = getReport($pdo, (string)$reportId);
        if ($report && $report['pdf_file']) {
            $path = dirname(__DIR__) . '/' . $report['pdf_file'];
            if (is_file($path)) unlink($path);
        }
        $pdo->prepare('DELETE FROM swa_stewa_reports WHERE id=?')->execute([$reportId]);
        jsonResponse(['deleted' => true]);
    }

    jsonError('Unknown action');
}

jsonError('Method not allowed', 405);
