-- PEO Progress Monitoring System — Database Schema
-- Safe to re-import: uses IF NOT EXISTS and skips duplicate seed rows.
--
-- phpMyAdmin: select database "peo_monitoring", then Import this file.
-- For clean setup use install.sql instead (drops old tables + creates fresh).

CREATE DATABASE IF NOT EXISTS peo_monitoring
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE peo_monitoring;

-- Users (Engineer I–IV, Contractor)
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('engineer_1','engineer_2','engineer_3','engineer_4','contractor') NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  contractor_id INT UNSIGNED,
  location VARCHAR(255),
  start_date DATE,
  planned_end_date DATE,
  status ENUM('active','delayed','completed','on_hold') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contractor_id) REFERENCES users(id)
);

-- PDM Activities
CREATE TABLE IF NOT EXISTS pdm_activities (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  activity_number VARCHAR(20) NOT NULL,
  activity_name VARCHAR(255) NOT NULL,
  duration INT UNSIGNED NOT NULL DEFAULT 1,
  es_override INT UNSIGNED NULL,
  es INT UNSIGNED DEFAULT 0,
  ef INT UNSIGNED DEFAULT 0,
  ls INT UNSIGNED DEFAULT 0,
  lf INT UNSIGNED DEFAULT 0,
  is_critical TINYINT(1) DEFAULT 0,
  pos_x INT DEFAULT 0,
  pos_y INT DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- PDM Dependencies (FS, SS, FF, SF)
CREATE TABLE IF NOT EXISTS pdm_dependencies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  from_activity_id INT UNSIGNED NOT NULL,
  to_activity_id INT UNSIGNED NOT NULL,
  dependency_type ENUM('FS','SS','FF','SF') NOT NULL DEFAULT 'FS',
  lag_days INT DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (from_activity_id) REFERENCES pdm_activities(id) ON DELETE CASCADE,
  FOREIGN KEY (to_activity_id) REFERENCES pdm_activities(id) ON DELETE CASCADE
);

-- Bar chart schedule tasks
CREATE TABLE IF NOT EXISTS bar_chart_tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  task_index INT UNSIGNED NOT NULL,
  task_name VARCHAR(255) NOT NULL,
  start_day INT UNSIGNED NOT NULL,
  end_day INT UNSIGNED NOT NULL,
  actual_end_day INT UNSIGNED,
  duration_unit ENUM('day','week','month') DEFAULT 'day',
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- S-curve data points
CREATE TABLE IF NOT EXISTS s_curve_points (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  point_date DATE NOT NULL,
  original_plan_pct DECIMAL(5,2),
  current_plan_pct DECIMAL(5,2),
  actual_pct DECIMAL(5,2),
  cumulative_cost DECIMAL(15,2),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Progress reports (SWA, STEWA, PROGRESS)
CREATE TABLE IF NOT EXISTS progress_reports (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  report_type ENUM('SWA','STEWA','PROGRESS') NOT NULL,
  period_label VARCHAR(30) NOT NULL,
  status ENUM('draft','submitted','with_engineer_2','revision_requested','with_engineer_3','approved') DEFAULT 'draft',
  submitted_by INT UNSIGNED,
  qr_code VARCHAR(64) UNIQUE,
  pdf_path VARCHAR(500),
  report_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (submitted_by) REFERENCES users(id)
);

-- Approval workflow log
CREATE TABLE IF NOT EXISTS report_workflow_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id INT UNSIGNED NOT NULL,
  actor_id INT UNSIGNED NOT NULL,
  action ENUM('submit','approve','revise','forward','reject') NOT NULL,
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES progress_reports(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

-- Email queue for automated notifications
CREATE TABLE IF NOT EXISTS email_queue (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id INT UNSIGNED,
  recipient_email VARCHAR(120) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body_html TEXT NOT NULL,
  approve_token VARCHAR(64),
  revise_token VARCHAR(64),
  status ENUM('pending','sent','failed') DEFAULT 'pending',
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES progress_reports(id)
);

-- QR verification registry
CREATE TABLE IF NOT EXISTS document_verification (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  qr_code VARCHAR(64) NOT NULL UNIQUE,
  report_id INT UNSIGNED NOT NULL,
  verified_at TIMESTAMP NULL,
  FOREIGN KEY (report_id) REFERENCES progress_reports(id)
);

-- Seed demo users (password: demo123) — skips if email already exists
INSERT IGNORE INTO users (email, password_hash, full_name, role) VALUES
  ('engineer1@peo.local', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Engr. Juan Dela Cruz', 'engineer_1'),
  ('engineer2@peo.local', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Engr. Maria Santos', 'engineer_2'),
  ('engineer3@peo.local', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Engr. Pedro Reyes', 'engineer_3'),
  ('engineer4@peo.local', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Engr. Ana Lopez', 'engineer_4'),
  ('contractor@build.local', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'ABC Construction Corp.', 'contractor');

INSERT IGNORE INTO projects (id, name, contractor_id, location, start_date, planned_end_date) VALUES
  (1, 'Provincial Capitol Annex', 5, 'Cagayan Provincial Capitol', '2026-01-15', '2026-12-31'),
  (2, 'North Zone Pipe Replacement', 5, 'Tuguegarao City', '2026-03-01', '2026-09-30');
