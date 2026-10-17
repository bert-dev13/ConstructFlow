<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/TemplateEngine.php';

$engine = new TemplateEngine();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $type = $_GET['type'] ?? null;
    $manifest = $engine->getManifest();

    if ($type) {
        if (!isset($manifest[$type])) {
            jsonError('Unknown report type', 404);
        }
        $path = $engine->getTemplatePath($type);
        jsonResponse([
            'type' => $type,
            'config' => $manifest[$type],
            'template_exists' => $path !== null,
            'template_path' => $path ? basename(dirname($path)) . '/' . basename($path) : null,
        ]);
    }

    jsonResponse(['templates' => $manifest]);
}

if ($method === 'POST') {
    $reportType = $_POST['report_type'] ?? '';
    if (!$reportType) {
        jsonError('report_type required');
    }

    if (!empty($_FILES['template_file']['tmp_name'])) {
        $content = file_get_contents($_FILES['template_file']['tmp_name']);
        $ext = strtolower(pathinfo($_FILES['template_file']['name'], PATHINFO_EXTENSION));

        if ($ext === 'html' || $ext === 'htm') {
            $saved = $engine->saveUploadedTemplate($reportType, $content);
            jsonResponse(['message' => 'Template uploaded', 'path' => basename($saved)]);
        }

        if ($ext === 'docx' || $ext === 'xlsx') {
            $dir = dirname(__DIR__) . '/templates/uploads';
            if (!is_dir($dir)) mkdir($dir, 0755, true);
            $dest = $dir . '/' . $reportType . '.' . $ext;
            move_uploaded_file($_FILES['template_file']['tmp_name'], $dest);
            jsonResponse([
                'message' => 'Original file saved. Convert to HTML with placeholders for auto-fill, or install PHPWord/PhpSpreadsheet.',
                'path' => 'uploads/' . $reportType . '.' . $ext,
            ]);
        }

        jsonError('Upload .html (ready) or .docx/.xlsx (stored for reference)');
    }

    $body = readJsonBody();
    if (!empty($body['html_content'])) {
        $saved = $engine->saveUploadedTemplate($reportType, $body['html_content']);
        jsonResponse(['message' => 'Template saved', 'path' => basename($saved)]);
    }

    jsonError('template_file or html_content required');
}

jsonError('Method not allowed', 405);
