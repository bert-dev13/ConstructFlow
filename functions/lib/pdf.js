"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSimplePdf = buildSimplePdf;
const pdfkit_1 = __importDefault(require("pdfkit"));
function text(value) {
    return String(value ?? '—');
}
/** Build a simple branded PDF buffer (ConstructFlow report / schedule attachment). */
async function buildSimplePdf(options) {
    const doc = new pdfkit_1.default({ size: 'LETTER', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
    doc.fillColor('#0B3D2E').fontSize(18).font('Helvetica-Bold').text('ConstructFlow');
    doc.moveDown(0.35);
    doc.fillColor('#111111').fontSize(14).text(options.title);
    if (options.subtitle) {
        doc.moveDown(0.2);
        doc.fillColor('#555555').fontSize(10).font('Helvetica').text(options.subtitle);
    }
    doc.moveDown(0.6);
    if (options.meta?.length) {
        doc.fillColor('#111111').fontSize(10).font('Helvetica');
        for (const [label, value] of options.meta) {
            doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
            doc.font('Helvetica').text(value);
        }
        doc.moveDown(0.5);
    }
    if (options.columns?.length && options.rows) {
        const colCount = options.columns.length;
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const colW = pageWidth / colCount;
        const startX = doc.page.margins.left;
        const drawHeader = () => {
            let x = startX;
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#0B3D2E');
            for (const col of options.columns) {
                doc.text(col, x, doc.y, { width: colW - 4, continued: false });
                x += colW;
            }
            doc.moveDown(0.35);
            doc
                .strokeColor('#cccccc')
                .moveTo(startX, doc.y)
                .lineTo(startX + pageWidth, doc.y)
                .stroke();
            doc.moveDown(0.3);
            doc.fillColor('#111111').font('Helvetica').fontSize(8);
        };
        drawHeader();
        for (const row of options.rows) {
            if (doc.y > doc.page.height - 72) {
                doc.addPage();
                drawHeader();
            }
            const rowY = doc.y;
            let maxH = 12;
            let x = startX;
            for (let i = 0; i < colCount; i += 1) {
                const cell = text(row[i]);
                const h = doc.heightOfString(cell, { width: colW - 4 });
                maxH = Math.max(maxH, h);
                doc.text(cell, x, rowY, { width: colW - 4 });
                x += colW;
            }
            doc.y = rowY + maxH + 4;
        }
    }
    if (options.footerNote) {
        doc.moveDown(1);
        doc.fillColor('#666666').fontSize(8).font('Helvetica').text(options.footerNote);
    }
    doc.end();
    return done;
}
//# sourceMappingURL=pdf.js.map