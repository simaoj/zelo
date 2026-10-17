// Generates PWA icons from the brand logo without distortion (contain on brand background).
// Usage: node scripts/generate-icons.mjs   (from apps/web)
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'public/brand/zelo-logo-cropped.png');
const out = path.join(root, 'public/icons');
const BG = '#FFFCF8';

/** contentRatio = share of the canvas width the logo may occupy. */
async function icon(file, size, contentRatio) {
  const logoWidth = Math.round(size * contentRatio);
  const logo = await sharp(src)
    .resize({ width: logoWidth, height: logoWidth, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'center' }])
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, file));
  console.log('wrote', file);
}

await mkdir(out, { recursive: true });
await icon('icon-192.png', 192, 0.84);
await icon('icon-512.png', 512, 0.84);
// maskable: the wordmark's diagonal must fit the 80% safe circle → width ≤ ~75%; use 66%.
await icon('icon-maskable-512.png', 512, 0.66);
await icon('icon-maskable-192.png', 192, 0.66);
await icon('apple-touch-icon.png', 180, 0.8);
await icon('favicon-32.png', 32, 0.94);
