<?php
declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/**
 * Read an environment variable with a local/XAMPP fallback.
 */
function env(string $key, string $default = ''): string
{
    $value = getenv($key);
    if ($value === false || $value === '') {
        $value = $_ENV[$key] ?? $_SERVER[$key] ?? '';
    }
    return ($value === false || $value === '') ? $default : (string)$value;
}

// MySQL connection (MYSQL* env overrides, otherwise local XAMPP defaults).
define('DB_HOST', env('MYSQLHOST', env('DB_HOST', 'localhost')));
define('DB_PORT', env('MYSQLPORT', env('DB_PORT', '3306')));
define('DB_NAME', env('MYSQLDATABASE', env('DB_NAME', 'peo_monitoring')));
define('DB_USER', env('MYSQLUSER', env('DB_USER', 'root')));
define('DB_PASS', env('MYSQLPASSWORD', env('DB_PASS', '')));

// Public app URL (no trailing slash).
define('APP_URL', rtrim(env('APP_URL', 'http://localhost/ConstructFlow'), '/'));
define('APP_BASE_PATH', env('APP_BASE_PATH', str_ends_with(APP_URL, '/ConstructFlow') ? '/ConstructFlow/' : '/'));
define('MAIL_FROM', env('MAIL_FROM', 'peo-monitoring@cagayan.gov.ph'));

if (session_status() === PHP_SESSION_NONE) {
    session_start([
        'cookie_path' => APP_BASE_PATH,
        'cookie_httponly' => true,
        'cookie_samesite' => 'Lax',
        'cookie_secure' => str_starts_with(APP_URL, 'https://'),
    ]);
}

require_once __DIR__ . '/lib/MysqlPdo.php';

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            DB_HOST,
            DB_PORT,
            DB_NAME
        );
        $options = mysql_pdo_options(DB_HOST, env('MYSQL_SSL', ''), [
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo = new PDO(
            $dsn,
            DB_USER,
            DB_PASS,
            $options
        );
    }
    return $pdo;
}

function jsonResponse(mixed $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonError(string $message, int $code = 400): void
{
    jsonResponse(['error' => $message], $code);
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    return $raw ? (json_decode($raw, true) ?? []) : [];
}
