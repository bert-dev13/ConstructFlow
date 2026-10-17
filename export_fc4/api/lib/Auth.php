<?php
declare(strict_types=1);

namespace Peo;

use PDO;

class Auth
{
    /** @return array{id:int,email:string,full_name:string,name:string,role:string}|null */
    public static function user(): ?array
    {
        $u = $_SESSION['user'] ?? null;
        return is_array($u) ? $u : null;
    }

    /** @return array{id:int,email:string,full_name:string,name:string,role:string} */
    public static function requireAuth(): array
    {
        $u = self::user();
        if (!$u) {
            jsonError('Unauthorized', 401);
        }
        return $u;
    }

    /** @param list<string> $roles */
    public static function requireRoles(array $roles): array
    {
        $u = self::requireAuth();
        if (!in_array($u['role'], $roles, true)) {
            jsonError('Forbidden', 403);
        }
        return $u;
    }

    /** @return array{id:int,email:string,full_name:string,name:string,role:string}|null */
    public static function login(PDO $pdo, string $email, string $password, ?string $expectedRole = null): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT id, email, full_name, role, password_hash FROM users WHERE email = ? AND is_active = 1 LIMIT 1'
        );
        $stmt->execute([trim($email)]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($password, (string)$row['password_hash'])) {
            return null;
        }
        if ($expectedRole !== null && $row['role'] !== $expectedRole) {
            return null;
        }
        unset($row['password_hash']);
        $row['name'] = $row['full_name'];
        $row['id'] = (int)$row['id'];
        $_SESSION['user'] = $row;
        return $row;
    }

    public static function logout(): void
    {
        unset($_SESSION['user']);
    }

    public static function actorId(): ?int
    {
        $u = self::user();
        return $u ? (int)$u['id'] : null;
    }
}
