<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Peo\Auth;
use Peo\DatabaseSetup;

try {
    $pdo = db();
} catch (Throwable $e) {
    jsonError('Database connection failed: ' . $e->getMessage(), 500);
}

try {
    DatabaseSetup::ensureUsersAndProjects($pdo);
} catch (Throwable $e) {
    jsonError('Database setup failed: ' . $e->getMessage(), 500);
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($method === 'GET' ? 'me' : 'login');

if ($method === 'GET' && $action === 'me') {
    $user = Auth::user();
    if (!$user) {
        jsonResponse(['user' => null]);
    }
    jsonResponse(['user' => $user]);
}

if ($method === 'POST' && $action === 'logout') {
    Auth::logout();
    jsonResponse(['ok' => true]);
}

if ($method === 'POST') {
    $body = readJsonBody();
    $email = (string)($body['email'] ?? '');
    $password = (string)($body['password'] ?? '');
    $role = isset($body['role']) ? (string)$body['role'] : null;

    $user = Auth::login($pdo, $email, $password, $role ?: null);
    if (!$user) {
        jsonError('Invalid email or password for this role.', 401);
    }
    jsonResponse(['user' => $user]);
}

jsonError('Invalid request', 400);
