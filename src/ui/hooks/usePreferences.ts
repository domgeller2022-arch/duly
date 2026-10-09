/**
 * Preferences that apply to the document element.
 *
 * Theme, density and accent colour are applied as data attributes and CSS custom
 * properties rather than as React context, so the change takes effect on the
 * very next paint with no flash of the wrong theme.
 */

import { useEffect } from 'react';
import type { Settings } from '@/core/schemas';

/** Follow the operating system's colour scheme when the setting says to. */
export function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

export function resolveTheme(theme: Settings['theme'] | undefined): 'light' | 'dark' {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return prefersDark() ? 'dark' : 'light';
}

/** Write the resolved preferences onto `<html>`. */
export function applyPreferences(settings: Settings | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const theme = resolveTheme(settings?.theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  root.dataset.density = settings?.density ?? 'comfortable';

  // Only the interface accent is set here. A business's own brand colour belongs
  // on its documents, not on the app chrome.
  const accent = settings?.appAccent;
  if (accent && /^#[0-9a-f]{3,8}$/i.test(accent)) {
    root.style.setProperty('--color-accent', accent);
    root.style.setProperty('--color-accent-hover', shade(accent, -0.12));
    root.style.setProperty('--color-accent-soft', mixWithPaper(accent, 0.88));
  }
}

/**
 * Re-resolve when the operating system's appearance changes.
 *
 * Only active while the theme is "system". Returns the unsubscribe function so
 * it can be used directly as a `useEffect` cleanup.
 */
export function watchSystemTheme(theme: Settings['theme'] | undefined): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  if (theme && theme !== 'system') return () => {};

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (event: MediaQueryListEvent) => {
    const root = document.documentElement;
    root.dataset.theme = event.matches ? 'dark' : 'light';
    root.style.colorScheme = event.matches ? 'dark' : 'light';
  };

  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/* ------------------------------------------------------------------ */
/* Small colour helpers                                               */
/* ------------------------------------------------------------------ */

/** Lighten (positive) or darken (negative) a hex colour by a fraction. */
export function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const channel = (c: number) => Math.round(c + (target - c) * t);
  return rgbToHex(channel(rgb.r), channel(rgb.g), channel(rgb.b));
}

/** Blend a colour toward the paper, for a soft background tint. */
export function mixWithPaper(hex: string, paperAmount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = (c: number, paper: number) => Math.round(c + (paper - c) * paperAmount);
  return rgbToHex(mix(rgb.r, 250), mix(rgb.g, 248), mix(rgb.b, 244));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Readable ink colour for a given background, using the WCAG relative luminance. */
export function contrastingInk(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#1C1B19';
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return luminance > 0.45 ? '#1C1B19' : '#FFFFFF';
}

/**
 * Suggest brand colours from an uploaded logo.
 *
 * Simple pixel quantising, no AI and no network. Transparent pixels are skipped,
 * colours within a small distance of each other are merged, and the result is
 * ranked by how much of the image each colour covers — so the dominant colour is
 * first.
 */
export function extractDominantColours(dataUrl: string, maxColours = 4): Promise<string[]> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve([]);
    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      try {
        const size = 48; // enough to find the dominant colour, cheap to compute
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve([]);
        ctx.drawImage(image, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
        const seen = new Map<string, { r: number; g: number; b: number }>();

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 128) continue; // ignore transparent pixels

          // Quantise to 5 bits per channel, so near-identical shades merge.
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const key = `${r >> 3}-${g >> 3}-${b >> 3}`;

          const bucket = buckets.get(key);
          if (bucket) {
            bucket.count += 1;
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
          } else {
            buckets.set(key, { count: 1, r, g, b });
            seen.set(key, { r, g, b });
          }
        }

        const ranked = [...buckets.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, maxColours * 3);

        const chosen: string[] = [];
        for (const [, bucket] of ranked) {
          const hex = rgbToHex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count);
          // Reject near-white and near-black, which make poor brand colours.
          const rgb = hexToRgb(hex);
          if (!rgb) continue;
          const luminance = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
          if (luminance > 235 || luminance < 30) continue;
          if (chosen.some((c) => colourDistance(c, hex) < 40)) continue;
          chosen.push(hex);
          if (chosen.length >= maxColours) break;
        }

        resolve(chosen);
      } catch {
        resolve([]);
      }
    };

    image.onerror = () => resolve([]);
    image.src = dataUrl;
  });
}

/** Perceptually rough colour distance, 0 to about 765. */
export function colourDistance(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return Number.MAX_SAFE_INTEGER;
  return Math.sqrt((ra.r - rb.r) ** 2 + (ra.g - rb.g) ** 2 + (ra.b - rb.b) ** 2);
}

/** Hook that keeps preferences applied if the system theme changes. */
export function usePreferenceWatcher(theme: Settings['theme'] | undefined): void {
  useEffect(() => watchSystemTheme(theme), [theme]);
}
