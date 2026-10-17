<?php
declare(strict_types=1);

namespace Peo;

use Dompdf\Dompdf;
use Dompdf\Options;

class PdfReportService
{
    /**
     * Philippine long bond / folio: 8.5 in × 13 in.
     * (Short bond is letter 8.5×11; legal is 8.5×14.)
     */
    public const LONG_BOND = [0.0, 0.0, 612.0, 936.0];

    public function generateFromHtml(string $html, string $outputPath, string $orientation = 'portrait'): string
    {
        $dir = dirname($outputPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $root = realpath(dirname(__DIR__, 2)) ?: dirname(__DIR__, 2);

        $options = new Options();
        $options->set('isRemoteEnabled', true);
        $options->set('isHtml5ParserEnabled', true);
        $options->set('defaultFont', 'DejaVu Sans');
        $options->set('chroot', $root);

        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html);
        $orientation = strtolower($orientation) === 'landscape' ? 'landscape' : 'portrait';
        $dompdf->setPaper(self::LONG_BOND, $orientation);
        $dompdf->render();
        file_put_contents($outputPath, $dompdf->output());

        return $outputPath;
    }
}
