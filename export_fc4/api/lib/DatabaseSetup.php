<?php
declare(strict_types=1);

namespace Peo;

use PDO;

class DatabaseSetup
{
    public static function ensureSwaStewaTables(PDO $pdo): void
    {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS report_templates (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              report_type ENUM('SWA','STEWA') NOT NULL UNIQUE,
              original_filename VARCHAR(255),
              stored_path VARCHAR(500),
              html_template_path VARCHAR(500),
              uploaded_by INT UNSIGNED NULL,
              uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS swa_stewa_reports (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              report_number VARCHAR(40) NOT NULL UNIQUE,
              project_id INT UNSIGNED NOT NULL,
              report_type ENUM('SWA','STEWA') NOT NULL,
              report_data JSON NOT NULL,
              line_items JSON,
              pdf_file VARCHAR(500),
              qr_code VARCHAR(500),
              public_url VARCHAR(500),
              status ENUM('draft','pending_review','approved','rejected','generated') DEFAULT 'draft',
              created_by INT UNSIGNED NULL,
              approved_by INT UNSIGNED NULL,
              rejection_reason TEXT,
              prepared_by_name VARCHAR(150),
              checked_by_name VARCHAR(150),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              generated_at TIMESTAMP NULL
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS report_audit_log (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              report_id INT UNSIGNED NOT NULL,
              actor_id INT UNSIGNED NULL,
              action VARCHAR(50) NOT NULL,
              details JSON,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS report_revisions (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              report_id INT UNSIGNED NOT NULL,
              revision_number INT UNSIGNED NOT NULL,
              report_data JSON NOT NULL,
              line_items JSON,
              changed_by INT UNSIGNED NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ");

        // Add workflow statuses if table already existed
        try {
            $pdo->exec("
                ALTER TABLE swa_stewa_reports
                MODIFY status ENUM('draft','pending_review','with_engineer_3','with_engineer_4','approved','rejected','generated')
                DEFAULT 'draft'
            ");
        } catch (\Throwable) {
            // Column may already include these values
        }

        self::ensureScheduleTables($pdo);
        self::ensureIarReportType($pdo);
        ProjectInfo::ensureTables($pdo);

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

    public static function ensureIarReportType(PDO $pdo): void
    {
        foreach ([
            "ALTER TABLE report_templates MODIFY report_type ENUM('SWA','STEWA','IAR') NOT NULL",
            "ALTER TABLE swa_stewa_reports MODIFY report_type ENUM('SWA','STEWA','IAR') NOT NULL",
        ] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (\Throwable) {
                // ENUM may already include IAR
            }
        }
    }

    public static function ensureScheduleTables(PDO $pdo): void
    {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS projects (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              name VARCHAR(200) NOT NULL,
              contractor_id INT UNSIGNED NULL,
              location VARCHAR(255),
              start_date DATE NULL,
              planned_end_date DATE NULL,
              status ENUM('active','delayed','completed','on_hold') DEFAULT 'active',
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS pdm_activities (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              project_id INT UNSIGNED NOT NULL,
              activity_number VARCHAR(40) NOT NULL,
              activity_name VARCHAR(255) NOT NULL,
              duration INT UNSIGNED NOT NULL DEFAULT 1,
              es_override INT UNSIGNED NULL,
              es INT UNSIGNED DEFAULT 0,
              ef INT UNSIGNED DEFAULT 0,
              ls INT UNSIGNED DEFAULT 0,
              lf INT UNSIGNED DEFAULT 0,
              is_critical TINYINT(1) DEFAULT 0,
              pos_x INT DEFAULT 0,
              pos_y INT DEFAULT 0
            )
        ");

        try {
            $pdo->exec('ALTER TABLE pdm_activities ADD COLUMN es_override INT UNSIGNED NULL AFTER duration');
        } catch (\Throwable) {
            // Column already exists on upgraded databases
        }
        try {
            $pdo->exec(
                'ALTER TABLE pdm_activities ADD COLUMN extend_to_end TINYINT(1) NOT NULL DEFAULT 0 AFTER es_override'
            );
        } catch (\Throwable) {
            // Column already exists
        }
        try {
            $pdo->exec('ALTER TABLE pdm_activities MODIFY activity_number VARCHAR(40) NOT NULL');
        } catch (\Throwable) {
            // Ignore if the column is already wide enough
        }

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS pdm_dependencies (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              project_id INT UNSIGNED NOT NULL,
              from_activity_id INT UNSIGNED NOT NULL,
              to_activity_id INT UNSIGNED NOT NULL,
              dependency_type ENUM('FS','SS','FF','SF') NOT NULL DEFAULT 'FS',
              lag_days INT DEFAULT 0
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS bar_chart_tasks (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              project_id INT UNSIGNED NOT NULL,
              task_index INT UNSIGNED NOT NULL,
              task_name VARCHAR(255) NOT NULL,
              start_day INT UNSIGNED NOT NULL,
              end_day INT UNSIGNED NOT NULL,
              actual_end_day INT UNSIGNED NULL,
              duration_unit ENUM('day','week','month') DEFAULT 'day'
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS schedule_settings (
              project_id INT UNSIGNED PRIMARY KEY,
              bar_chart_total_days INT UNSIGNED DEFAULT 24,
              bar_chart_time_now INT UNSIGNED DEFAULT 10
            )
        ");

        $count = (int)$pdo->query('SELECT COUNT(*) FROM projects')->fetchColumn();
        if ($count === 0) {
            $pdo->exec("
                INSERT INTO projects (id, name, location, start_date, planned_end_date) VALUES
                (1, 'Provincial Capitol Annex', 'Cagayan Provincial Capitol', '2026-01-15', '2026-12-31'),
                (2, 'North Zone Pipe Replacement', 'Tuguegarao City', '2026-03-01', '2026-09-30')
            ");
        }
    }

    public static function seedScheduleIfEmpty(PDO $pdo): void
    {
        self::ensureAppSettings($pdo);
        self::migrateEsOverrideToZeroBased($pdo);
        self::migrateRootEsOverrideOneToZero($pdo);

        if (!RoadPdmSample::hasReference()) {
            self::wipeAllSchedulesIfPresent($pdo);
            return;
        }

        self::seedRoadReferenceIfNeeded($pdo);
    }

    /** Remove every PDM / bar chart / S-curve row while no reference is configured. */
    public static function wipeAllSchedulesIfPresent(PDO $pdo): void
    {
        $acts = (int)$pdo->query('SELECT COUNT(*) FROM pdm_activities')->fetchColumn();
        $deps = (int)$pdo->query('SELECT COUNT(*) FROM pdm_dependencies')->fetchColumn();
        $tasks = (int)$pdo->query('SELECT COUNT(*) FROM bar_chart_tasks')->fetchColumn();
        if ($acts === 0 && $deps === 0 && $tasks === 0) {
            return;
        }

        $pdo->exec('DELETE FROM pdm_dependencies');
        $pdo->exec('DELETE FROM pdm_activities');
        $pdo->exec('DELETE FROM bar_chart_tasks');
        $pdo->exec('DELETE FROM schedule_settings');
        $pdo->exec('DELETE FROM s_curve_points');
    }

    /** One-time: convert legacy 1-based es_override (1 = first day) to 0-based (0 = first day). */
    public static function migrateEsOverrideToZeroBased(PDO $pdo): void
    {
        self::ensureAppSettings($pdo);
        $done = $pdo->query(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'es_override_zero_v1'"
        )->fetchColumn();
        if ($done === '1') {
            return;
        }

        $pdo->exec(
            'UPDATE pdm_activities SET es_override = GREATEST(0, es_override - 1)
             WHERE es_override IS NOT NULL AND es_override > 0'
        );
        $pdo->prepare(
            "INSERT INTO app_settings (setting_key, setting_value) VALUES ('es_override_zero_v1', '1')
             ON DUPLICATE KEY UPDATE setting_value = '1'"
        )->execute();
    }

    /** Root activities with es_override = 1 meant legacy "first day" — store as 0. */
    public static function migrateRootEsOverrideOneToZero(PDO $pdo): void
    {
        self::ensureAppSettings($pdo);
        $done = $pdo->query(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'es_override_root_one_v1'"
        )->fetchColumn();
        if ($done === '1') {
            return;
        }

        $pdo->exec(
            'UPDATE pdm_activities a
             SET a.es_override = 0
             WHERE a.es_override = 1
               AND NOT EXISTS (
                 SELECT 1 FROM pdm_dependencies d WHERE d.to_activity_id = a.id
               )'
        );
        $pdo->prepare(
            "INSERT INTO app_settings (setting_key, setting_value) VALUES ('es_override_root_one_v1', '1')
             ON DUPLICATE KEY UPDATE setting_value = '1'"
        )->execute();
    }

    /** One-time: load reference PDM on project 1 when configured. */
    public static function seedRoadReferenceIfNeeded(PDO $pdo): void
    {
        if (!RoadPdmSample::hasReference()) {
            return;
        }

        self::ensureAppSettings($pdo);
        $done = $pdo->query(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'pdm_sample_af_v1'"
        )->fetchColumn();
        if ($done === '1') {
            return;
        }

        $exists = (int)$pdo->query('SELECT COUNT(*) FROM projects WHERE id = 1')->fetchColumn();
        if ($exists === 0) {
            $contractorId = (int)$pdo->query("SELECT id FROM users WHERE role = 'contractor' LIMIT 1")->fetchColumn();
            $meta = RoadPdmSample::projectMeta() ?? RoadProjectReference::meta();
            $pdo->prepare(
                'INSERT INTO projects (id, name, contractor_id, location, start_date, planned_end_date, status) VALUES (?,?,?,?,?,?,?)'
            )->execute([
                1,
                $meta['name'],
                $contractorId ?: null,
                $meta['location'],
                $meta['start_date'],
                $meta['planned_end_date'],
                'active',
            ]);
        }

        self::loadReferenceSchedule($pdo, 1);

        $pdo->prepare(
            "INSERT INTO app_settings (setting_key, setting_value) VALUES ('pdm_sample_af_v1', '1')
             ON DUPLICATE KEY UPDATE setting_value = '1'"
        )->execute();
    }

    public static function loadReferenceSchedule(PDO $pdo, int $projectId): void
    {
        $meta = RoadPdmSample::projectMeta() ?? RoadProjectReference::meta();
        $contractAmount = RoadPdmSample::projectMeta() !== null
            ? null
            : RoadProjectReference::CONTRACT_AMOUNT;

        if ($contractAmount !== null) {
            $pdo->prepare(
                'UPDATE projects SET name = ?, location = ?, start_date = ?, planned_end_date = ?,
                 contractor_id = COALESCE(contractor_id, (SELECT id FROM users WHERE role = \'contractor\' LIMIT 1)),
                 contract_amount = ?
                 WHERE id = ?'
            )->execute([
                $meta['name'],
                $meta['location'],
                $meta['start_date'],
                $meta['planned_end_date'],
                $contractAmount,
                $projectId,
            ]);
        } else {
            $pdo->prepare(
                'UPDATE projects SET name = ?, location = ?, start_date = ?, planned_end_date = ? WHERE id = ?'
            )->execute([
                $meta['name'],
                $meta['location'],
                $meta['start_date'],
                $meta['planned_end_date'],
                $projectId,
            ]);
        }

        $pdo->prepare('DELETE FROM pdm_dependencies WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM pdm_activities WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM bar_chart_tasks WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM schedule_settings WHERE project_id = ?')->execute([$projectId]);
        $pdo->prepare('DELETE FROM s_curve_points WHERE project_id = ?')->execute([$projectId]);

        self::insertRoadPdm($pdo, $projectId);
    }

    private static function ensureAppSettings(PDO $pdo): void
    {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS app_settings (
              setting_key VARCHAR(64) PRIMARY KEY,
              setting_value VARCHAR(255) NOT NULL
            )
        ");
    }

    public static function insertRoadPdm(PDO $pdo, int $projectId): void
    {
        if (!RoadPdmSample::hasReference()) {
            return;
        }

        $ids = [];
        $stmt = $pdo->prepare(
            'INSERT INTO pdm_activities (project_id, activity_number, activity_name, duration, es_override, pos_x, pos_y)
             VALUES (?,?,?,?,?,?,?)'
        );
        foreach (RoadPdmSample::activities() as $i => $a) {
            $stmt->execute([
                $projectId,
                $a['number'],
                $a['name'],
                $a['duration'],
                $a['es_override'] ?? null,
                120 + ($i % 4) * 180,
                80 + intdiv($i, 4) * 140,
            ]);
            $ids[$a['key']] = (int)$pdo->lastInsertId();
        }

        $depStmt = $pdo->prepare(
            'INSERT INTO pdm_dependencies (project_id, from_activity_id, to_activity_id, dependency_type, lag_days)
             VALUES (?,?,?,?,?)'
        );
        foreach (RoadPdmSample::dependencies() as $d) {
            $from = $ids[$d['from']] ?? 0;
            $to = $ids[$d['to']] ?? 0;
            if (!$from || !$to) {
                continue;
            }
            $depStmt->execute([$projectId, $from, $to, $d['type'], $d['lag']]);
        }

        $pdmInput = [];
        $actRows = $pdo->prepare(
            'SELECT id, activity_number AS number, activity_name AS name, duration, es_override
             FROM pdm_activities WHERE project_id = ? ORDER BY id'
        );
        $actRows->execute([$projectId]);
        foreach ($actRows->fetchAll() as $row) {
            $pdmInput[] = [
                'id' => (string)$row['id'],
                'number' => $row['number'],
                'name' => $row['name'],
                'duration' => (int)$row['duration'],
                'esOverride' => $row['es_override'] !== null ? (int)$row['es_override'] : null,
            ];
        }
        $dbDeps = $pdo->prepare(
            'SELECT from_activity_id AS fromId, to_activity_id AS toId, dependency_type AS type, lag_days AS `lag`
             FROM pdm_dependencies WHERE project_id = ?'
        );
        $dbDeps->execute([$projectId]);
        $depRows = [];
        foreach ($dbDeps->fetchAll() as $row) {
            $depRows[] = [
                'fromId' => (string)$row['fromId'],
                'toId' => (string)$row['toId'],
                'type' => $row['type'],
                'lag' => (int)$row['lag'],
            ];
        }
        $pdm = PdmSchedule::calculate($pdmInput, $depRows);
        $tasks = ScheduleSync::barChartFromPdm($pdm['activities'] ?? []);
        $taskStmt = $pdo->prepare(
            'INSERT INTO bar_chart_tasks (project_id, task_index, task_name, start_day, end_day, actual_end_day)
             VALUES (?,?,?,?,?,NULL)'
        );
        foreach ($tasks as $t) {
            $taskStmt->execute([$projectId, $t['index'], $t['name'], $t['startDay'], $t['endDay']]);
        }

        $duration = max(1, (int)($pdm['projectDuration'] ?? 110));
        $pdo->prepare(
            'INSERT INTO schedule_settings (project_id, bar_chart_total_days, bar_chart_time_now) VALUES (?,?,10)
             ON DUPLICATE KEY UPDATE bar_chart_total_days=VALUES(bar_chart_total_days)'
        )->execute([$projectId, $duration]);

        ScheduleSync::syncDerivedViews($pdo, $projectId, $pdm);
    }

    public static function seedDemoReportsIfEmpty(PDO $pdo): void
    {
        $count = (int)$pdo->query('SELECT COUNT(*) FROM swa_stewa_reports')->fetchColumn();
        if ($count > 0) {
            return;
        }

        $demo = [
            [
                'report_number' => 'STEWA-2026-0001',
                'project_id' => 1,
                'report_type' => 'STEWA',
                'status' => 'pending_review',
                'report_data' => [
                    'project_name' => 'Provincial Capitol Annex',
                    'location' => 'Cagayan Provincial Capitol',
                    'contractor' => 'TS Construction',
                    'contract_amount' => '2396212.40',
                    'period' => '2026-W30',
                    'prepared_by_name' => 'Engr. Juan Dela Cruz',
                    'percent_actual' => 85,
                    'percent_planned' => 90,
                ],
                'public_url' => APP_URL . '/reports/view/STEWA-2026-0001',
            ],
            [
                'report_number' => 'SWA-2026-0001',
                'project_id' => 2,
                'report_type' => 'SWA',
                'status' => 'generated',
                'report_data' => [
                    'project_name' => 'North Zone Pipe Replacement',
                    'location' => 'Tuguegarao City',
                    'contractor' => 'TS Construction',
                    'period' => '2026-W29',
                    'prepared_by_name' => 'Engr. Juan Dela Cruz',
                ],
                'public_url' => APP_URL . '/reports/view/SWA-2026-0001',
            ],
            [
                'report_number' => 'STEWA-2026-0002',
                'project_id' => 1,
                'report_type' => 'STEWA',
                'status' => 'rejected',
                'rejection_reason' => 'Please update actual percent complete for framing activity.',
                'report_data' => [
                    'project_name' => 'Administration Building Extension',
                    'location' => 'Iguig, Cagayan',
                    'contractor' => 'TS Construction',
                    'period' => '2026-W30',
                    'prepared_by_name' => 'Engr. Juan Dela Cruz',
                ],
                'public_url' => APP_URL . '/reports/view/STEWA-2026-0002',
            ],
        ];

        $stmt = $pdo->prepare(
            'INSERT INTO swa_stewa_reports (report_number, project_id, report_type, report_data, line_items, public_url, status, rejection_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );

        foreach ($demo as $row) {
            $stmt->execute([
                $row['report_number'],
                $row['project_id'],
                $row['report_type'],
                json_encode($row['report_data']),
                '[]',
                $row['public_url'],
                $row['status'],
                $row['rejection_reason'] ?? null,
            ]);
        }
    }

    public static function ensureUsersAndProjects(PDO $pdo): void
    {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS users (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              email VARCHAR(120) NOT NULL UNIQUE,
              password_hash VARCHAR(255) NOT NULL,
              full_name VARCHAR(150) NOT NULL,
              role ENUM('engineer_1','engineer_2','engineer_3','engineer_4','contractor') NOT NULL,
              is_active TINYINT(1) DEFAULT 1,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ");

        self::ensureScheduleTables($pdo);

        $hash = password_hash('demo123', PASSWORD_BCRYPT);
        $users = [
            ['constructflow.engineer1.1@gmail.com', 'Engr. Juan Dela Cruz', 'engineer_1'],
            ['constructflow.engineer1.2@gmail.com', 'Engr. Carlos Mendoza', 'engineer_1'],
            ['constructflow.engineer1.3@gmail.com', 'Engr. Sofia Ramirez', 'engineer_1'],
            ['constructflow.engineer2.1@gmail.com', 'Engr. Maria Santos', 'engineer_2'],
            ['constructflow.engineer2.2@gmail.com', 'Engr. Luis Garcia', 'engineer_2'],
            ['constructflow.engineer2.3@gmail.com', 'Engr. Elena Cruz', 'engineer_2'],
            ['constructflow.engineer3.1@gmail.com', 'Engr. Pedro Reyes', 'engineer_3'],
            ['constructflow.engineer4.1@gmail.com', 'Engr. Ana Lopez', 'engineer_4'],
            ['constructflow.contractor.1@gmail.com', 'ABC Construction Corp.', 'contractor'],
            ['constructflow.contractor.2@gmail.com', 'TS Construction', 'contractor'],
            ['constructflow.contractor.3@gmail.com', 'North Builders Inc.', 'contractor'],
            // keep legacy demo emails working
            ['engineer1@peo.local', 'Engr. Juan Dela Cruz', 'engineer_1'],
            ['engineer2@peo.local', 'Engr. Maria Santos', 'engineer_2'],
            ['engineer3@peo.local', 'Engr. Pedro Reyes', 'engineer_3'],
            ['engineer4@peo.local', 'Engr. Ana Lopez', 'engineer_4'],
            ['contractor@build.local', 'ABC Construction Corp.', 'contractor'],
        ];
        $stmt = $pdo->prepare(
            'INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name), role = VALUES(role)'
        );
        foreach ($users as [$email, $name, $role]) {
            $stmt->execute([$email, $hash, $name, $role]);
        }

        $count = (int)$pdo->query('SELECT COUNT(*) FROM projects')->fetchColumn();
        if ($count === 0) {
            $contractorId = (int)$pdo->query("SELECT id FROM users WHERE role = 'contractor' LIMIT 1")->fetchColumn();
            $pdo->prepare(
                'INSERT INTO projects (id, name, contractor_id, location, start_date, planned_end_date, status) VALUES (?,?,?,?,?,?,?)'
            )->execute([1, 'Provincial Capitol Annex', $contractorId ?: null, 'Cagayan Provincial Capitol', '2026-01-15', '2026-12-31', 'active']);
            $pdo->prepare(
                'INSERT INTO projects (id, name, contractor_id, location, start_date, planned_end_date, status) VALUES (?,?,?,?,?,?,?)'
            )->execute([2, 'North Zone Pipe Replacement', $contractorId ?: null, 'Tuguegarao City', '2026-03-01', '2026-09-30', 'active']);
        }
    }

    public static function ensureSCurveTable(PDO $pdo): void
    {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS s_curve_points (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              project_id INT UNSIGNED NOT NULL,
              point_date DATE NOT NULL,
              original_plan_pct DECIMAL(5,2) NULL,
              current_plan_pct DECIMAL(5,2) NULL,
              actual_pct DECIMAL(5,2) NULL,
              cumulative_cost DECIMAL(15,2) NULL,
              INDEX idx_project_date (project_id, point_date)
            )
        ");
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS s_curve_snapshots (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              project_id INT UNSIGNED NOT NULL,
              captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              trigger_type VARCHAR(32) NOT NULL,
              trigger_label VARCHAR(120) NULL,
              schedule_status VARCHAR(24) NULL,
              slippage_pct DECIMAL(6,2) NULL,
              planned_pct DECIMAL(5,2) NULL,
              actual_pct DECIMAL(5,2) NULL,
              points_json JSON NOT NULL,
              INDEX idx_project_captured (project_id, captured_at)
            )
        ");
    }

    public static function seedSCurveIfEmpty(PDO $pdo): void
    {
        $count = (int)$pdo->query('SELECT COUNT(*) FROM s_curve_points')->fetchColumn();
        if ($count > 0) {
            return;
        }
        $seed = [
            ['2026-01-15', 0, 0, null],
            ['2026-02-01', 5, 5, null],
            ['2026-03-01', 15, 14, null],
            ['2026-04-01', 28, 26, null],
            ['2026-05-01', 42, 38, null],
            ['2026-06-01', 55, 50, null],
            ['2026-07-01', 68, 62, null],
            ['2026-08-01', 80, 74, null],
            ['2026-09-01', 90, 86, null],
            ['2026-10-01', 100, 100, null],
        ];
        $stmt = $pdo->prepare(
            'INSERT INTO s_curve_points (project_id, point_date, original_plan_pct, current_plan_pct, actual_pct)
             VALUES (1, ?, ?, ?, ?)'
        );
        foreach ($seed as [$d, $o, $c, $a]) {
            $stmt->execute([$d, $o, $c, $a]);
        }
    }
}
