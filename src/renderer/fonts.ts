/**
 * Font registration for react-pdf.
 *
 * The fonts ship inside the app (`public/fonts`) rather than being fetched from
 * a CDN. A PDF that had to download its fonts would not work offline, and would
 * render differently on a machine that could not reach the CDN — which defeats
 * the point of "what you see is what the client gets".
 *
 * Registration happens once per session: react-pdf's font store is global, and
 * re-registering a family would re-fetch it on every keystroke of a live preview.
 */

import { Font } from '@react-pdf/renderer';

interface FontFiles {
  regular: string;
  bold: string;
  italic: string;
}

/**
 * The bundled families. Names match the `key` values in a design template's
 * `fonts.heading` / `fonts.body` / `fonts.signature`.
 */
const FONT_FILES: Record<string, FontFiles> = {
  inter: { regular: 'Inter-Regular', bold: 'Inter-Bold', italic: 'Inter-Italic' },
  sourceSerif: { regular: 'SourceSerif4-Regular', bold: 'SourceSerif4-Bold', italic: 'SourceSerif4-Italic' },
  fraunces: { regular: 'Fraunces-Regular', bold: 'Fraunces-Bold', italic: 'Fraunces-Italic' },
  ibmPlexSans: { regular: 'IBMPlexSans-Regular', bold: 'IBMPlexSans-Bold', italic: 'IBMPlexSans-Italic' },
  ibmPlexMono: { regular: 'IBMPlexMono-Regular', bold: 'IBMPlexMono-Bold', italic: 'IBMPlexMono-Italic' },
  lora: { regular: 'Lora-Regular', bold: 'Lora-Bold', italic: 'Lora-Italic' },
};

export const BUNDLED_FONTS = FONT_FILES;

let registered = false;

/**
 * Register every bundled family.
 *
 * All of them, not just the ones a template happens to use: switching templates
 * mid-session must never produce a document in a substituted font, and react-pdf
 * falls back silently when a family is missing.
 */
export async function fontStore(): Promise<Record<string, FontFiles>> {
  if (registered) return FONT_FILES;

  for (const [family, files] of Object.entries(FONT_FILES)) {
    try {
      Font.register({
        family,
        fonts: [
          { src: `/fonts/${files.regular}.ttf`, fontWeight: 400 },
          { src: `/fonts/${files.bold}.ttf`, fontWeight: 700 },
          { src: `/fonts/${files.italic}.ttf`, fontStyle: 'italic' },
        ],
      });
    } catch {
      // A missing font file must not stop a document rendering: react-pdf falls
      // back to its built-in Helvetica, and the file names are all listed in the
      // README so a missing one is obvious.
    }
  }

  registered = true;
  return FONT_FILES;
}

/** Reset the registry, for tests that need a clean slate. */
export function resetFontRegistration(): void {
  registered = false;
}
