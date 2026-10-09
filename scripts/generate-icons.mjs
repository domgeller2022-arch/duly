/**
 * Generate the PWA icons and the browser tab icon.
 *
 * Duly's mark is a deep-teal rounded square with a "D" cut out of it, drawn as
 * SVG and rasterised here so no binary asset needs to be committed by hand. The
 * maskable variant keeps the mark inside the safe zone, because Android crops a
 * maskable icon to whatever shape it likes.
 *
 * Run with: npm run icons
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = join(root, 'public', 'icons');

/** The mark, drawn at any size. */
function mark(size, { padding = 0 } = {}) {
  const inset = size * padding;
  const box = size - inset * 2;
  const radius = box * 0.22;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="#1F5E5B"/>
  <path
    d="M ${inset + box * 0.28} ${inset + box * 0.26}
       h ${box * 0.24}
       a ${box * 0.26} ${box * 0.26} 0 0 1 0 ${box * 0.48}
       h -${box * 0.24}
       z
       M ${inset + box * 0.4} ${inset + box * 0.38}
       v ${box * 0.24}
       h ${box * 0.1}
       a ${box * 0.12} ${box * 0.12} 0 0 0 0 -${box * 0.24}
       z"
    fill="#FAF8F4"
    fill-rule="evenodd"
  />
</svg>`;
}

const ICONS = [
  { file: 'icon-192.png', size: 192, options: {} },
  { file: 'icon-512.png', size: 512, options: {} },
  // Maskable: the mark is inset so Android's crop never clips it.
  { file: 'icon-512-maskable.png', size: 512, options: { padding: 0.14 } },
  { file: 'apple-touch-icon.png', size: 180, options: {} },
];

async function main() {
  await mkdir(iconDir, { recursive: true });

  for (const icon of ICONS) {
    const svg = Buffer.from(mark(icon.size, icon.options));
    await sharp(svg).png({ compressionLevel: 9 }).toFile(join(iconDir, icon.file));
    process.stdout.write(`  ${icon.file} (${icon.size}×${icon.size})\n`);
  }

  // The tab icon, at a size that stays sharp on a retina display.
  await writeFile(join(root, 'public', 'favicon.svg'), `${mark(64)}\n`);
  await sharp(Buffer.from(mark(64)))
    .png()
    .toFile(join(iconDir, 'favicon-64.png'));
  process.stdout.write('  favicon.svg\n');
  process.stdout.write('  favicon-64.png\n');

  process.stdout.write(`\n${ICONS.length + 2} icon file(s) written\n`);
}

main().catch((error) => {
  process.stderr.write(`Icon generation failed: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
