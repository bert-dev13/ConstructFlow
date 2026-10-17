<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/TemplateEngine.php';
require_once __DIR__ . '/mail.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method not allowed', 405);
}

$body = readJsonBody();
$reportType = $body['report_type'] ?? '';
$projectId = (int)($body['project_id'] ?? 0);
$submittedBy = (int)($body['submitted_by'] ?? 0);
$period = $body['period_label'] ?? '';
$fields = $body['fields'] ?? [];
$submit = (bool)($body['submit'] ?? false);

if (!$reportType || !$projectId || !$period) {
    jsonError('report_type, project_id, and period_label are required');
}

$engine = new TemplateEngine();
$manifest = $engine->getManifest();
if (!isset($manifest[$reportType])) {
    jsonError('Invalid report type');
}

// Validate required fields
foreach ($manifest[$reportType]['fields'] as $field) {
    if (!empty($field['required']) && empty($fields[$field['key']])) {
        jsonError('Missing required field: ' . $field['label']);
    }
}

$qr = 'PEO-RPT-' . strtoupper(bin2hex(random_bytes(6)));

try {
    $html = $engine->render($reportType, $fields, $qr);
} catch (RuntimeException $e) {
    jsonError($e->getMessage(), 500);
}

$storageDir = dirname(__DIR__) . '/storage/reports';
if (!is_dir($storageDir)) {
    mkdir($storageDir, 0755, true);
}

$fileName = $qr . '.html';
$filePath = $storageDir . '/' . $fileName;
file_put_contents($filePath, $html);

$pdo = db();
$status = $submit ? 'with_engineer_2' : 'draft';

$stmt = $pdo->prepare(
    'INSERT INTO progress_reports (project_id, report_type, period_label, status, submitted_by, qr_code, pdf_path, report_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $projectId,
    $reportType,
    $period,
    $status,
    $submittedBy ?: null,
    $qr,
    'storage/reports/' . $fileName,
    json_encode($fields),
]);
$reportId = (int)$pdo->lastInsertId();

$pdo->prepare('INSERT INTO document_verification (qr_code, report_id) VALUES (?, ?)')
    ->execute([$qr, $reportId]);

if ($submit && $submittedBy) {
    queueApprovalEmail($pdo, $reportId, $qr);
}

jsonResponse([
    'id' => $reportId,
    'qr_code' => $qr,
    'status' => $status,
    'preview_url' => APP_URL . '/storage/reports/' . $fileName,
    'verify_url' => APP_URL . '/verify?qr=' . urlencode($qr),
], 201);
