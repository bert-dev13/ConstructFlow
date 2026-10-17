-- SWA/STEWA Report Generator — run after install.sql
USE peo_monitoring;

CREATE TABLE IF NOT EXISTS report_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_type ENUM('SWA','STEWA') NOT NULL UNIQUE,
  original_filename VARCHAR(255),
  stored_path VARCHAR(500),
  html_template_path VARCHAR(500),
  uploaded_by INT UNSIGNED,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

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
  created_by INT UNSIGNED,
  approved_by INT UNSIGNED,
  rejection_reason TEXT,
  prepared_by_name VARCHAR(150),
  checked_by_name VARCHAR(150),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  generated_at TIMESTAMP NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS report_audit_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id INT UNSIGNED NOT NULL,
  actor_id INT UNSIGNED,
  action VARCHAR(50) NOT NULL,
  details JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES swa_stewa_reports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_revisions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id INT UNSIGNED NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  report_data JSON NOT NULL,
  line_items JSON,
  changed_by INT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES swa_stewa_reports(id) ON DELETE CASCADE
);
