<?php
declare(strict_types=1);

class TemplateEngine
{
    private string $templatesDir;

    public function __construct()
    {
        $this->templatesDir = dirname(__DIR__) . '/templates';
    }

    public function getManifest(): array
    {
        $path = $this->templatesDir . '/manifest.json';
        if (!is_file($path)) {
            return [];
        }
        return json_decode(file_get_contents($path), true) ?? [];
    }

    public function getTemplatePath(string $reportType): ?string
    {
        $manifest = $this->getManifest();
        if (!isset($manifest[$reportType])) {
            return null;
        }

        $uploaded = $this->templatesDir . '/uploads/' . $reportType . '.html';
        if (is_file($uploaded)) {
            return $uploaded;
        }

        $relative = $manifest[$reportType]['template_file'] ?? '';
        $full = $this->templatesDir . '/' . str_replace(['../', '..\\'], '', $relative);
        return is_file($full) ? $full : null;
    }

    public function render(string $reportType, array $data, string $qrCode): string
    {
        $path = $this->getTemplatePath($reportType);
        if (!$path) {
            throw new RuntimeException("Template not found for type: {$reportType}");
        }

        $html = file_get_contents($path);

        if ($reportType === 'STEWA') {
            $planned = (float)($data['percent_planned'] ?? 0);
            $actual = (float)($data['percent_actual'] ?? 0);
            $data['variance_pct'] = round($planned - $actual, 2);
        }

        $data['generated_date'] = date('F j, Y');
        $data['qr_code'] = $qrCode;
        $data['verify_url'] = APP_URL . '/verify?qr=' . urlencode($qrCode);

        foreach ($data as $key => $value) {
            $safe = htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
            $html = str_replace('{{' . $key . '}}', nl2br($safe), $html);
        }

        // Remove unfilled optional placeholders
        return preg_replace('/\{\{[a-z0-9_]+\}\}/i', '—', $html) ?? $html;
    }

    public function saveUploadedTemplate(string $reportType, string $htmlContent): string
    {
        $allowed = ['SWA', 'STEWA', 'IAR', 'PROGRESS'];
        if (!in_array($reportType, $allowed, true)) {
            throw new InvalidArgumentException('Invalid report type');
        }

        $dir = $this->templatesDir . '/uploads';
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $path = $dir . '/' . $reportType . '.html';
        file_put_contents($path, $htmlContent);
        return $path;
    }
}
