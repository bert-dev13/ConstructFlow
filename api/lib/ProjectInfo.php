<?php
declare(strict_types=1);

namespace Peo;

use PDO;

/**
 * Project general information, audit trail, and contract amount (VO) history.
 */
class ProjectInfo
{
    public static function ensureTables(PDO $pdo): void
    {
        try {
            $pdo->exec('ALTER TABLE projects ADD COLUMN contract_amount DECIMAL(15,2) NULL AFTER location');
        } catch (\Throwable) {
        }
        try {
            $pdo->exec(
                'ALTER TABLE projects ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
            );
        } catch (\Throwable) {
        }

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS project_audit_log (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              project_id INT UNSIGNED NOT NULL,
              actor_id INT UNSIGNED NULL,
              field_name VARCHAR(64) NOT NULL,
              old_value TEXT NULL,
              new_value TEXT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_project_audit (project_id, created_at)
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS project_contract_history (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              project_id INT UNSIGNED NOT NULL,
              contract_amount DECIMAL(15,2) NOT NULL,
              effective_date DATE NOT NULL,
              vo_reference VARCHAR(120) NULL,
              notes TEXT NULL,
              created_by INT UNSIGNED NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_project_contract (project_id, effective_date)
            )
        ");

        try {
            $pdo->exec("
                ALTER TABLE swa_stewa_reports
                MODIFY status ENUM(
                  'draft','pending_contractor','contractor_confirmed',
                  'pending_review','with_engineer_3','with_engineer_4',
                  'approved','rejected','generated'
                ) DEFAULT 'draft'
            ");
        } catch (\Throwable) {
        }

        foreach ([
            'ALTER TABLE swa_stewa_reports ADD COLUMN contractor_baseline JSON NULL',
            'ALTER TABLE swa_stewa_reports ADD COLUMN contractor_changes JSON NULL',
        ] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (\Throwable) {
            }
        }
    }

    /** @return array<string, mixed>|null */
    public static function fetch(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT p.id, p.name, p.location, p.status, p.start_date, p.planned_end_date,
                    p.contractor_id, p.contract_amount, p.created_at, p.updated_at,
                    u.full_name AS contractor_name, u.email AS contractor_email
             FROM projects p
             LEFT JOIN users u ON u.id = p.contractor_id
             WHERE p.id = ?'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** @return list<array<string, mixed>> */
    public static function auditLog(PDO $pdo, int $projectId): array
    {
        $stmt = $pdo->prepare(
            'SELECT a.id, a.field_name, a.old_value, a.new_value, a.created_at,
                    u.full_name AS actor_name
             FROM project_audit_log a
             LEFT JOIN users u ON u.id = a.actor_id
             WHERE a.project_id = ?
             ORDER BY a.created_at DESC, a.id DESC'
        );
        $stmt->execute([$projectId]);
        return $stmt->fetchAll() ?: [];
    }

    /** @return list<array<string, mixed>> */
    public static function contractHistory(PDO $pdo, int $projectId): array
    {
        $stmt = $pdo->prepare(
            'SELECT h.id, h.contract_amount, h.effective_date, h.vo_reference, h.notes, h.created_at,
                    u.full_name AS created_by_name
             FROM project_contract_history h
             LEFT JOIN users u ON u.id = h.created_by
             WHERE h.project_id = ?
             ORDER BY h.effective_date ASC, h.id ASC'
        );
        $stmt->execute([$projectId]);
        return $stmt->fetchAll() ?: [];
    }

    public static function logFieldChange(
        PDO $pdo,
        int $projectId,
        ?int $actorId,
        string $field,
        ?string $old,
        ?string $new,
    ): void {
        if ($old === $new) {
            return;
        }
        $pdo->prepare(
            'INSERT INTO project_audit_log (project_id, actor_id, field_name, old_value, new_value)
             VALUES (?, ?, ?, ?, ?)'
        )->execute([$projectId, $actorId, $field, $old, $new]);
    }

    public static function recordContractAmount(
        PDO $pdo,
        int $projectId,
        float $amount,
        string $effectiveDate,
        ?int $actorId,
        ?string $voReference = null,
        ?string $notes = null,
    ): void {
        $pdo->prepare(
            'INSERT INTO project_contract_history
             (project_id, contract_amount, effective_date, vo_reference, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$projectId, $amount, $effectiveDate, $voReference, $notes, $actorId]);
    }

    /** @param array<string, mixed> $before */
    /** @param array<string, mixed> $after */
    public static function auditProjectUpdate(PDO $pdo, int $projectId, ?int $actorId, array $before, array $after): void
    {
        $fields = [
            'name' => 'Project title',
            'location' => 'Location',
            'start_date' => 'Project start date',
            'planned_end_date' => 'Planned end date',
            'contractor_id' => 'Contractor',
            'contract_amount' => 'Contract amount',
            'status' => 'Status',
        ];
        foreach ($fields as $key => $label) {
            $old = isset($before[$key]) ? (string)$before[$key] : null;
            $new = isset($after[$key]) ? (string)$after[$key] : null;
            if ($old !== $new) {
                self::logFieldChange($pdo, $projectId, $actorId, $label, $old, $new);
            }
        }

        $oldAmt = isset($before['contract_amount']) ? (float)$before['contract_amount'] : null;
        $newAmt = isset($after['contract_amount']) ? (float)$after['contract_amount'] : null;
        if ($newAmt !== null && $newAmt > 0 && $oldAmt !== $newAmt) {
            self::recordContractAmount(
                $pdo,
                $projectId,
                $newAmt,
                date('Y-m-d'),
                $actorId,
                null,
                $oldAmt !== null ? 'Contract amount updated' : 'Initial contract amount',
            );
        }
    }

    /** @return array{contractor:string,start_date:?string,contract_amount:?string,project_name:string,location:?string} */
    public static function reportDefaults(PDO $pdo, int $projectId): array
    {
        $row = self::fetch($pdo, $projectId);
        if (!$row) {
            return [
                'contractor' => '',
                'start_date' => null,
                'contract_amount' => null,
                'project_name' => '',
                'location' => null,
            ];
        }
        return [
            'contractor' => (string)($row['contractor_name'] ?? ''),
            'start_date' => $row['start_date'] ? (string)$row['start_date'] : null,
            'contract_amount' => $row['contract_amount'] !== null
                ? number_format((float)$row['contract_amount'], 2, '.', '')
                : null,
            'project_name' => (string)$row['name'],
            'location' => $row['location'] !== null ? (string)$row['location'] : null,
        ];
    }
}
