<?php
declare(strict_types=1);

/**
 * Wipe all PDM schedules (browser or CLI). Safe while awaiting new reference data.
 */
require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Peo\DatabaseSetup;

$isCli = PHP_SAPI === 'cli';

if (!$isCli) {
    header('Content-Type: text/plain; charset=utf-8');
}

try {
    $pdo = db();
    DatabaseSetup::ensureScheduleTables($pdo);
    DatabaseSetup::wipeAllSchedulesIfPresent($pdo);
    echo "OK: all PDM activities, dependencies, bar chart, and S-curve data deleted.\n";
    exit(0);
} catch (Throwable $e) {
    echo 'ERROR: ' . $e->getMessage() . "\n";
    exit($isCli ? 1 : 1);
}
