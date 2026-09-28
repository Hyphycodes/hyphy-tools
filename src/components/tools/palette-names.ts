import { rgbToHsl, type Rgb } from '@/lib/tools/palette';

/*
 * A friendly, approximate name for a color ("Deep plum", "Pale mint"), so a swatch reads as a
 * color before it reads as a code. The code stays the exact value; the name is only a nickname.
 */

/** Up to this hue: the name, its dark form and its light form. */
const HUES: [number, string, string, string][] = [
  [10, 'Red', 'Maroon', 'Rose'],
  [22, 'Coral', 'Rust', 'Peach'],
  [38, 'Orange', 'Brown', 'Apricot'],
  [50, 'Amber', 'Bronze', 'Sand'],
  [64, 'Yellow', 'Olive', 'Butter'],
  [85, 'Lime', 'Olive', 'Pistachio'],
  [150, 'Green', 'Forest', 'Mint'],
  [178, 'Teal', 'Deep teal', 'Seafoam'],
  [200, 'Cyan', 'Petrol', 'Ice blue'],
  [222, 'Blue', 'Navy', 'Sky'],
  [248, 'Indigo', 'Midnight', 'Periwinkle'],
  [275, 'Violet', 'Deep purple', 'Lavender'],
  [305, 'Plum', 'Aubergine', 'Lilac'],
  [335, 'Magenta', 'Wine', 'Pink'],
  [350, 'Raspberry', 'Burgundy', 'Blush'],
  [361, 'Red', 'Maroon', 'Rose'],
];

export function colorName(rgb: Rgb) {
  const { h, s, l } = rgbToHsl(rgb);
  if (l < 9) return 'Near black';
  if (l > 96) return s > 30 ? 'Off-white' : 'White';
  const warm = h >= 15 && h <= 70;
  if (s < 12 || (l < 16 && s < 30)) {
    if (l < 30) return 'Charcoal';
    if (l < 55) return warm && s > 3 ? 'Warm gray' : 'Slate gray';
    if (l < 82) return warm && s > 3 ? 'Stone' : 'Silver';
    return warm && s > 3 ? 'Cream' : 'Mist';
  }
  const [, base, dark, light] = HUES.find(([top]) => h < top) ?? HUES[0];
  const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
  const dusty = s < 30;
  if (l < 22) return dark;
  if (l < 40) return dusty ? `Dusky ${lower(base)}` : `Deep ${lower(base)}`;
  if (l < 70) return dusty ? `Dusty ${lower(base)}` : base;
  if (l < 86) return light;
  return `Pale ${lower(light)}`;
}
