import fs from 'node:fs';

const svg = fs.readFileSync('public/img/constructflow_logo.svg', 'utf8');
const match = svg.match(/href="data:image\/png;base64,([^"]+)"/);
if (!match) {
  console.error('Embedded PNG not found in SVG');
  process.exit(1);
}

const png = Buffer.from(match[1], 'base64');
fs.writeFileSync('public/img/constructflow_logo.png', png);
console.log('extracted_png_bytes', png.length);

async function compress() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.log('sharp_unavailable');
    return;
  }

  await sharp(png)
    .resize({ width: 720, withoutEnlargement: true })
    .webp({ quality: 82, effort: 6 })
    .toFile('public/img/constructflow_logo.webp');

  await sharp(png)
    .resize({ width: 720, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile('public/img/constructflow_logo.sm.png');

  for (const file of [
    'public/img/constructflow_logo.webp',
    'public/img/constructflow_logo.sm.png',
    'public/img/constructflow_logo.png',
  ]) {
    console.log(file, fs.statSync(file).size);
  }
}

await compress();
