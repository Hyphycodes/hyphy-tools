import type { Space } from './types';

/**
 * A business's accent: one color from a short list, each paired with the ink that reads on it.
 * Curated rather than free, so no business can pick a color its own name can't be read on. Every
 * pair clears 4.5:1 (checked in tests/unit.spec.ts). A color a business had before this list
 * existed stays until they pick another.
 *
 * The accent is restrained on purpose: it marks the business (its mark in the Space switcher and
 * header, the default for its QR codes and link pages) and never re-themes the product.
 */
export type Accent = { id: string; name: string; color: string; ink: 'light' | 'dark' };

export const ACCENTS: Accent[] = [
  { id: 'signal', name: 'Signal blue', color: '#3240FF', ink: 'light' },
  { id: 'ink', name: 'Ink', color: '#16150F', ink: 'light' },
  { id: 'pine', name: 'Pine', color: '#13784A', ink: 'light' },
  { id: 'harbor', name: 'Harbor', color: '#0A6C8C', ink: 'light' },
  { id: 'violet', name: 'Violet', color: '#7A3CE0', ink: 'light' },
  { id: 'rose', name: 'Rose', color: '#C2185B', ink: 'light' },
  { id: 'brick', name: 'Brick', color: '#C3301A', ink: 'light' },
  { id: 'ochre', name: 'Ochre', color: '#955800', ink: 'light' },
  { id: 'amber', name: 'Amber', color: '#F2A516', ink: 'dark' },
];

export const INK_COLORS = { light: '#FFFFFF', dark: '#16150F' } as const;

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colors. */
export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

export function findAccent(color: string | undefined) {
  return ACCENTS.find((accent) => accent.color.toLowerCase() === color?.toLowerCase());
}

/** Initials for a business mark: "ABC Construction" → "AB", "Salt & Ember" → "SE". */
export function monogramFor(name: string) {
  const words = name
    .replace(/&/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (!words.length) return 'H';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const first = words[0];
  // "ABC Construction": an acronym is its own mark.
  if (first.length <= 4 && first === first.toUpperCase() && /\p{L}/u.test(first))
    return first.slice(0, 2);
  return (first[0] + words[1][0]).toUpperCase();
}

/**
 * A color darkened until a phone camera reads it reliably on white (4.5:1) — the business accent
 * as a QR code's default ink.
 */
export function scannableColor(hex: string) {
  let current = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const toHex = (values: number[]) =>
    `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  for (let step = 0; step < 8 && contrast(toHex(current), '#FFFFFF') < 4.5; step += 1)
    current = current.map((value) => Math.round(value * 0.8));
  return toHex(current);
}

/** The brand with a new accent (and the ink that reads on it). */
export function withAccent(brand: Space['brand'], accent: Accent): Space['brand'] {
  return { ...brand, color: accent.color, ink: accent.ink };
}
