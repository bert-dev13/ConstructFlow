<?php
declare(strict_types=1);

/**
 * PDO options for MySQL (optional TLS via MYSQL_SSL=1).
 */
function mysql_ssl_enabled(string $host, string $envFlag = ''): bool
{
    if (in_array(strtolower($envFlag), ['1', 'true', 'yes'], true)) {
        return true;
    }

    $host = strtolower($host);
    return str_contains($host, 'tidbcloud.com');
}

function mysql_pdo_options(string $host, string $mysqlSslEnv = '', array $extra = []): array
{
    $options = array_merge([
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ], $extra);

    if (!mysql_ssl_enabled($host, $mysqlSslEnv)) {
        return $options;
    }

    $ca = getenv('MYSQL_SSL_CA');
    if ($ca === false || $ca === '') {
        $ca = $_ENV['MYSQL_SSL_CA'] ?? $_SERVER['MYSQL_SSL_CA'] ?? '';
    }
    if ($ca === '' || !is_readable((string) $ca)) {
        $ca = '/etc/ssl/certs/ca-certificates.crt';
    }
    if (is_readable((string) $ca)) {
        $options[PDO::MYSQL_ATTR_SSL_CA] = (string) $ca;
    }

    $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = false;

    return $options;
}
