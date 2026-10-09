/**
 * Bundle the fonts the app needs, as TTF.
 *
 * react-pdf cannot read WOFF2 — it embeds a raw TrueType file into the PDF — so
 * the woff2 files that ship with the `@fontsource` packages are decompressed
 * into `public/fonts` once, at install time. The app itself never fetches a font:
 * every one of these files is served from the same origin, which is what lets a
 * document render identically with the network unplugged.
 *
 * Run with: npm run fonts
 *
 * Every font here is SIL Open Font License 1.1.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompress } from 'wawoff2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'fonts');

/**
 * Source → destination.
 *
 * The destination names are the ones `src/renderer/fonts.ts` registers, so the
 * renderer never has to know where a font came from.
 */
const FONTS = [
  { pkg: '@fontsource/inter', family: 'inter', prefix: 'Inter' },
  { pkg: '@fontsource/source-serif-4', family: 'source-serif-4', prefix: 'SourceSerif4' },
  { pkg: '@fontsource/fraunces', family: 'fraunces', prefix: 'Fraunces' },
  { pkg: '@fontsource/ibm-plex-sans', family: 'ibm-plex-sans', prefix: 'IBMPlexSans' },
  { pkg: '@fontsource/ibm-plex-mono', family: 'ibm-plex-mono', prefix: 'IBMPlexMono' },
  { pkg: '@fontsource/lora', family: 'lora', prefix: 'Lora' },
];

/** The three faces every family needs for a document to lay out properly. */
const FACES = [
  { weight: 400, style: 'normal', name: 'Regular' },
  { weight: 700, style: 'normal', name: 'Bold' },
  { weight: 400, style: 'italic', name: 'Italic' },
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let written = 0;
  const missing = [];

  for (const font of FONTS) {
    for (const face of FACES) {
      const source = join(
        root,
        'node_modules',
        font.pkg,
        'files',
        `${font.family}-latin-${face.weight}-${face.style}.woff2`,
      );
      const target = join(outDir, `${font.prefix}-${face.name}.ttf`);

      if (!(await exists(source))) {
        missing.push(`${font.pkg} ${face.weight}/${face.style}`);
        continue;
      }

      const compressed = await readFile(source);
      try {
        const ttf = await decompress(compressed);
        await writeFile(target, Buffer.from(ttf));
        written += 1;
        process.stdout.write(`  ${font.prefix}-${face.name}.ttf\n`);
      } catch (error) {
        missing.push(`${font.prefix}-${face.name} (${error instanceof Error ? error.message : error})`);
      }
    }
  }

  process.stdout.write(`\n${written} font file(s) written to public/fonts\n`);

  if (missing.length > 0) {
    process.stdout.write(`\nCould not bundle ${missing.length} face(s):\n`);
    for (const entry of missing) process.stdout.write(`  - ${entry}\n`);
    process.stdout.write(
      '\nDuly still renders without them — react-pdf falls back to Helvetica — but the PDF will not match the preview.\n',
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`Font bundling failed: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
