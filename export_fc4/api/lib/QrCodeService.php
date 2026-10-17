<?php
declare(strict_types=1);

namespace Peo;

use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;

class QrCodeService
{
    public static function toDataUri(string $url): string
    {
        $options = new QROptions([
            'outputType' => QRCode::OUTPUT_IMAGE_PNG,
            'scale' => 4,
            'imageBase64' => true,
        ]);
        return (new QRCode($options))->render($url);
    }

    public static function savePng(string $url, string $filePath): void
    {
        $options = new QROptions([
            'outputType' => QRCode::OUTPUT_IMAGE_PNG,
            'scale' => 5,
        ]);
        (new QRCode($options))->render($url, $filePath);
    }
}
