<?php
declare(strict_types=1);

/** @return array<string, mixed>|null */
function getSwaReportForMail(PDO $pdo, int $reportId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM swa_stewa_reports WHERE id = ?');
    $stmt->execute([$reportId]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    $row['report_data'] = json_decode($row['report_data'], true) ?: [];
    return $row;
}

function ensureSwaEmailQueue(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS swa_email_queue (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          report_id INT UNSIGNED NOT NULL,
          recipient_email VARCHAR(120) NOT NULL,
          subject VARCHAR(255) NOT NULL,
          body_html TEXT NOT NULL,
          pdf_path VARCHAR(500),
          approve_token VARCHAR(64),
          revise_token VARCHAR(64),
          status ENUM('pending','sent','failed') DEFAULT 'pending',
          sent_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ");
}

/**
 * @param list<string> $attachmentAbsPaths
 */
function sendHtmlEmailWithAttachments(string $to, string $subject, string $html, array $attachmentAbsPaths = []): bool
{
    $boundary = '=_PEO_' . bin2hex(random_bytes(8));
    $headers = 'From: ' . MAIL_FROM . "\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/mixed; boundary=\"{$boundary}\"\r\n";

    $body = "--{$boundary}\r\n";
    $body .= "Content-Type: text/html; charset=UTF-8\r\n\r\n";
    $body .= $html . "\r\n";

    foreach ($attachmentAbsPaths as $pdfAbsPath) {
        if (!$pdfAbsPath || !is_file($pdfAbsPath)) {
            continue;
        }
        $filename = basename($pdfAbsPath);
        $pdfData = chunk_split(base64_encode((string)file_get_contents($pdfAbsPath)));
        $body .= "--{$boundary}\r\n";
        $body .= "Content-Type: application/pdf; name=\"{$filename}\"\r\n";
        $body .= "Content-Transfer-Encoding: base64\r\n";
        $body .= "Content-Disposition: attachment; filename=\"{$filename}\"\r\n\r\n";
        $body .= $pdfData . "\r\n";
    }

    $body .= "--{$boundary}--";

    return @mail($to, $subject, $body, $headers);
}

function sendHtmlEmailWithPdf(string $to, string $subject, string $html, ?string $pdfAbsPath = null): bool
{
    return sendHtmlEmailWithAttachments($to, $subject, $html, $pdfAbsPath ? [$pdfAbsPath] : []);
}

/** @return list<string> */
function emailsForRoles(PDO $pdo, array $roles): array
{
    if (!$roles) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($roles), '?'));
    $stmt = $pdo->prepare(
        "SELECT DISTINCT email, role FROM users WHERE is_active = 1 AND role IN ({$placeholders}) ORDER BY role, email"
    );
    $stmt->execute(array_values($roles));
    $emails = [];
    foreach ($stmt->fetchAll() as $row) {
        $email = trim((string)$row['email']);
        if ($email !== '' && !str_ends_with($email, '@peo.local') && !str_ends_with($email, '@build.local')) {
            $emails[] = $email;
        }
    }
    // If only legacy local emails exist, still use them so queue records work in demo
    if (!$emails) {
        $stmt->execute(array_values($roles));
        foreach ($stmt->fetchAll() as $row) {
            $email = trim((string)$row['email']);
            if ($email !== '') {
                $emails[] = $email;
            }
        }
    }
    return array_values(array_unique($emails));
}

/**
 * @param list<string|null> $pdfRelPaths
 */
function queueSwaEmail(
    PDO $pdo,
    int $reportId,
    string $recipient,
    string $subject,
    string $html,
    ?string $pdfRelPath = null,
    ?string $approveToken = null,
    ?string $reviseToken = null,
    array $extraPdfRelPaths = [],
): void {
    ensureSwaEmailQueue($pdo);
    $primary = $pdfRelPath;
    $pdo->prepare(
        'INSERT INTO swa_email_queue (report_id, recipient_email, subject, body_html, pdf_path, approve_token, revise_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([$reportId, $recipient, $subject, $html, $primary, $approveToken, $reviseToken]);

    $absList = [];
    foreach (array_merge($primary ? [$primary] : [], $extraPdfRelPaths) as $rel) {
        if (!$rel) {
            continue;
        }
        $abs = dirname(__DIR__) . '/' . ltrim((string)$rel, '/');
        if (is_file($abs)) {
            $absList[] = $abs;
        }
    }
    $sent = sendHtmlEmailWithAttachments($recipient, $subject, $html, $absList);

    $pdo->prepare(
        "UPDATE swa_email_queue SET status=?, sent_at=NOW() WHERE report_id=? ORDER BY id DESC LIMIT 1"
    )->execute([$sent ? 'sent' : 'failed', $reportId]);
}

function swaReportSummary(array $report): string
{
    $d = $report['report_data'] ?? [];
    $name = htmlspecialchars((string)($d['project_name'] ?? $d['project_title'] ?? ''));
    $type = htmlspecialchars((string)($report['report_type'] ?? ''));
    $num = htmlspecialchars((string)($report['report_number'] ?? ''));
    $week = htmlspecialchars((string)($d['week_covered'] ?? $d['report_date'] ?? ''));
    return "<p><strong>{$type}</strong> report <code>{$num}</code><br>Project: {$name}<br>Week: {$week}</p>";
}

function swaWorkflowLink(int $reportId): string
{
    return APP_URL . '/workflow?report=' . $reportId;
}

function swaVerifyLink(array $report): string
{
    $num = urlencode((string)($report['report_number'] ?? ''));
    return APP_URL . '/reports/view/' . $num;
}

function swaReviewEmailLink(int $reportId, string $action, string $token): string
{
    return APP_URL . '/reviews?report=' . $reportId . '&action=' . $action . '&token=' . urlencode($token);
}

/** Engineer I submitted → email all Engineer II accounts */
function mailSwaSubmitToEngineer2(PDO $pdo, int $reportId, ?string $pdfRelPath): void
{
    $report = getSwaReportForMail($pdo, $reportId);
    if (!$report) {
        return;
    }

    $approveToken = bin2hex(random_bytes(16));
    $reviseToken = bin2hex(random_bytes(16));
    $approveUrl = swaReviewEmailLink($reportId, 'approve', $approveToken);
    $reviseUrl = swaReviewEmailLink($reportId, 'revise', $reviseToken);
    $workflowUrl = swaWorkflowLink($reportId);
    $verifyUrl = swaVerifyLink($report);

    $html = swaReportSummary($report);
    $html .= '<h2>Report Pending Your Review (Engineer II)</h2>';
    $html .= '<p>Engineer I submitted a report for your approval. The PDF is attached.</p>';
    $html .= '<p>';
    $html .= '<a href="' . $approveUrl . '" style="background:#4a6353;color:#fff;padding:10px 20px;text-decoration:none;border-radius:8px;margin-right:8px;">Approve</a>';
    $html .= '<a href="' . $reviseUrl . '" style="background:#e5e0d5;color:#333;padding:10px 20px;text-decoration:none;border-radius:8px;">Revise</a>';
    $html .= '</p>';
    $html .= '<p><a href="' . $workflowUrl . '">Open For Approval in ConstructFlow / PEO Monitoring</a></p>';
    $html .= '<p><a href="' . $verifyUrl . '">Verify document (after final approval)</a></p>';

    $recipients = emailsForRoles($pdo, ['engineer_2']);
    foreach ($recipients as $to) {
        queueSwaEmail(
            $pdo,
            $reportId,
            $to,
            'PEO Monitoring — ' . $report['report_type'] . ' Report Pending Approval',
            $html,
            $pdfRelPath,
            $approveToken,
            $reviseToken,
        );
    }
}

/** Engineer II approved → email Engineer III */
function mailSwaForwardToEngineer3(PDO $pdo, int $reportId, ?string $pdfRelPath): void
{
    $report = getSwaReportForMail($pdo, $reportId);
    if (!$report) {
        return;
    }

    $html = swaReportSummary($report);
    $html .= '<h2>Checking Required (Engineer III)</h2>';
    $html .= '<p>Engineer II has reviewed and forwarded this report for your acceptance.</p>';
    $html .= '<p><a href="' . swaWorkflowLink($reportId) . '">Open For Approval</a></p>';

    foreach (emailsForRoles($pdo, ['engineer_3']) as $to) {
        queueSwaEmail(
            $pdo,
            $reportId,
            $to,
            'PEO Monitoring — Report Forwarded for Checking',
            $html,
            $pdfRelPath,
        );
    }
}

/**
 * Final Eng IV acceptance → email Eng1–4 + Contractors with the report PDF only.
 *
 * @param list<array{label:string,path:string}> $extraAttachments Unused; kept for call-site compatibility.
 */
function mailFinalApprovedPackage(PDO $pdo, int $reportId, string $iarPdfRel, array $extraAttachments = []): void
{
    $report = getSwaReportForMail($pdo, $reportId);
    if (!$report) {
        return;
    }

    $type = (string)($report['report_type'] ?? 'Report');
    $html = swaReportSummary($report);
    $html .= '<h2>' . htmlspecialchars($type) . ' Fully Approved</h2>';
    $html .= '<p>Engineer II, Engineer III, and Engineer IV have accepted this report for the reporting week.</p>';
    $html .= '<p>Attachment: <strong>' . htmlspecialchars($type) . ' PDF</strong></p>';
    $html .= '<p><a href="' . swaVerifyLink($report) . '">View verified report online</a></p>';

    $subject = 'PEO Monitoring — Approved ' . $type . ' ' . ($report['report_number'] ?? '');
    $recipients = emailsForRoles($pdo, ['engineer_1', 'engineer_2', 'engineer_3', 'engineer_4', 'contractor']);
    foreach ($recipients as $to) {
        queueSwaEmail($pdo, $reportId, $to, $subject, $html, $iarPdfRel, null, null, []);
    }
}

/** @deprecated use mailFinalApprovedPackage */
function mailSwaNotifyContractor(PDO $pdo, int $reportId, string $pdfRelPath): void
{
    mailFinalApprovedPackage($pdo, $reportId, $pdfRelPath, []);
}

/** Revision requested → email Engineer I accounts */
function mailSwaNotifyRevision(PDO $pdo, int $reportId, string $comment, ?string $pdfRelPath = null): void
{
    $report = getSwaReportForMail($pdo, $reportId);
    if (!$report) {
        return;
    }

    $html = swaReportSummary($report);
    $html .= '<h2>Revision Required</h2>';
    $html .= '<p>Engineer II requested revisions on your report:</p>';
    $html .= '<blockquote>' . nl2br(htmlspecialchars($comment)) . '</blockquote>';
    $html .= '<p><a href="' . APP_URL . '/swa-stewa/edit/' . $reportId . '">Open report</a></p>';

    foreach (emailsForRoles($pdo, ['engineer_1']) as $to) {
        queueSwaEmail(
            $pdo,
            $reportId,
            $to,
            'PEO Monitoring — Revision Required',
            $html,
            $pdfRelPath,
        );
    }
}

function validateSwaEmailToken(PDO $pdo, int $reportId, string $action, string $token): bool
{
    ensureSwaEmailQueue($pdo);
    $col = $action === 'approve' ? 'approve_token' : 'revise_token';
    $stmt = $pdo->prepare(
        "SELECT id FROM swa_email_queue WHERE report_id=? AND {$col}=? ORDER BY id DESC LIMIT 1"
    );
    $stmt->execute([$reportId, $token]);
    return (bool)$stmt->fetchColumn();
}

function queueApprovalEmail(PDO $pdo, int $reportId, string $qrCode): void
{
    mailSwaSubmitToEngineer2($pdo, $reportId, null);
}

function queueEngineer3Email(PDO $pdo, int $reportId): void
{
    mailSwaForwardToEngineer3($pdo, $reportId, null);
}

function notifyContractor(PDO $pdo, int $reportId): void
{
    $report = getSwaReportForMail($pdo, $reportId);
    if ($report && !empty($report['pdf_file'])) {
        mailFinalApprovedPackage($pdo, $reportId, $report['pdf_file'], []);
    }
}

function notifyRevision(PDO $pdo, int $reportId, string $comment): void
{
    mailSwaNotifyRevision($pdo, $reportId, $comment);
}
