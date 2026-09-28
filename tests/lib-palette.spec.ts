import { expect, test } from '@playwright/test';
import {
  contrastLevel,
  contrastRatio,
  cssVariables,
  extractPalette,
  formatHsl,
  formatRatio,
  formatRgb,
  formatShare,
  hexToRgb,
  hslToRgb,
  locateColor,
  mergeNear,
  oklabToRgb,
  paletteJson,
  readablePairs,
  rgbToHex,
  rgbToHsl,
  rgbToOklab,
  sampleColors,
  sheetSvg,
  shareNear,
  swatchSheet,
  tailwindTheme,
  textOn,
  WHITE,
  BLACK,
  type Rgb,
} from '@/lib/tools/palette';

/* Palette: conversions, WCAG contrast and a deterministic extraction. */

/** A strip of pixels: [color, how many] in order, fully opaque unless an alpha is given. */
function pixels(runs: [string, number, number?][]) {
  const data: number[] = [];
  for (const [hex, count, alpha = 255] of runs) {
    const { r, g, b } = hexToRgb(hex)!;
    for (let index = 0; index < count; index += 1) data.push(r, g, b, alpha);
  }
  return sampleColors(data, data.length / 4, 1);
}

/** A seeded pseudo-random stream, so "noisy" inputs are the same every run. */
function stream(seed: number) {
  let state = seed;
  return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
}

test('hex, rgb and hsl convert both ways', () => {
  expect(hexToRgb('#E4572E')).toEqual({ r: 228, g: 87, b: 46 });
  expect(hexToRgb('e4572e')).toEqual({ r: 228, g: 87, b: 46 });
  expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  expect(hexToRgb(' #0a0B0c ')).toEqual({ r: 10, g: 11, b: 12 });
  expect(hexToRgb('#12345')).toBeNull();
  expect(hexToRgb('red')).toBeNull();
  expect(rgbToHex({ r: 228, g: 87, b: 46 })).toBe('#E4572E');
  expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
  expect(rgbToHex({ r: 300, g: -4, b: 15.6 })).toBe('#FF0010');

  expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
  expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 });
  expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 });
  expect(rgbToHsl(WHITE)).toEqual({ h: 0, s: 0, l: 100 });
  expect(formatRgb({ r: 228, g: 87, b: 46 })).toBe('rgb(228, 87, 46)');
  expect(formatHsl({ r: 228, g: 87, b: 46 })).toBe('hsl(14, 77%, 54%)');
  expect(formatHsl({ r: 128, g: 128, b: 128 })).toBe('hsl(0, 0%, 50%)');

  // Every color on a 4-bit grid survives rgb → hsl → rgb and rgb → hex → rgb exactly.
  const drift: string[] = [];
  for (let r = 0; r < 256; r += 17)
    for (let g = 0; g < 256; g += 17)
      for (let b = 0; b < 256; b += 17) {
        const color = { r, g, b };
        const viaHsl = hslToRgb(rgbToHsl(color));
        const viaHex = hexToRgb(rgbToHex(color))!;
        if ([viaHsl, viaHex].some((back) => back.r !== r || back.g !== g || back.b !== b))
          drift.push(rgbToHex(color));
      }
  expect(drift).toEqual([]);
});

test('OKLab matches the reference values and round-trips', () => {
  const white = rgbToOklab(WHITE);
  expect(white.l).toBeCloseTo(1, 4);
  expect(white.a).toBeCloseTo(0, 4);
  expect(white.b).toBeCloseTo(0, 4);
  expect(rgbToOklab(BLACK)).toEqual({ l: 0, a: 0, b: 0 });
  // sRGB red, from Björn Ottosson's reference implementation.
  const red = rgbToOklab({ r: 255, g: 0, b: 0 });
  expect(red.l).toBeCloseTo(0.62796, 4);
  expect(red.a).toBeCloseTo(0.22486, 4);
  expect(red.b).toBeCloseTo(0.12585, 4);
  // Grays have no color.
  const gray = rgbToOklab({ r: 119, g: 119, b: 119 });
  expect(Math.abs(gray.a) + Math.abs(gray.b)).toBeLessThan(1e-4);

  const random = stream(42);
  const drift: string[] = [];
  for (let index = 0; index < 5000; index += 1) {
    const color = {
      r: Math.floor(random() * 256),
      g: Math.floor(random() * 256),
      b: Math.floor(random() * 256),
    };
    if (rgbToHex(oklabToRgb(rgbToOklab(color))) !== rgbToHex(color)) drift.push(rgbToHex(color));
  }
  expect(drift).toEqual([]);
});

test('contrast matches WCAG’s published values', () => {
  expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
  expect(contrastRatio(WHITE, WHITE)).toBe(1);
  const gray = (value: number): Rgb => ({ r: value, g: value, b: value });
  // #767676 is the lightest gray that passes AA on white; #777777 just misses.
  expect(formatRatio(contrastRatio(gray(0x76), WHITE))).toBe('4.54:1');
  expect(contrastRatio(gray(0x77), WHITE)).toBeLessThan(4.5);
  expect(formatRatio(contrastRatio(gray(0x77), WHITE))).toBe('4.47:1');
  expect(formatRatio(contrastRatio(gray(0x59), WHITE))).toBe('7:1');
  // Order doesn't matter.
  const ink = hexToRgb('#1D3557')!;
  const paper = hexToRgb('#F1FAEE')!;
  expect(contrastRatio(ink, paper)).toBe(contrastRatio(paper, ink));

  expect(formatRatio(21)).toBe('21:1');
  expect(formatRatio(4.4999)).toBe('4.49:1');
  expect(contrastLevel(21)).toBe('AAA');
  expect(contrastLevel(4.5)).toBe('AA');
  expect(contrastLevel(3.2)).toBe('AA large');
  expect(contrastLevel(2)).toBe('Low');

  expect(textOn(hexToRgb('#1D3557')!).text).toBe('white');
  expect(textOn(hexToRgb('#FFD166')!).text).toBe('black');
  expect(textOn(WHITE)).toEqual({ text: 'black', ratio: 21 });
});

test('readable pairs are the AA pairs, best first', () => {
  const colors = ['#FFFFFF', '#1D3557', '#E4572E', '#F1FAEE'].map((hex) => hexToRgb(hex)!);
  const pairs = readablePairs(colors);
  expect(pairs.length).toBeGreaterThan(0);
  for (const pair of pairs) {
    expect(pair.ratio).toBeGreaterThanOrEqual(4.5);
    expect(pair.first).toBeLessThan(pair.second);
  }
  for (let index = 1; index < pairs.length; index += 1)
    expect(pairs[index - 1].ratio).toBeGreaterThanOrEqual(pairs[index].ratio);
  // White on navy is the best pair here; white and cream are nowhere near readable.
  expect(pairs[0]).toMatchObject({ first: 0, second: 1 });
  expect(pairs.some((pair) => pair.first === 0 && pair.second === 3)).toBe(false);
});

test('a two-color image gives exactly those two colors, by share', () => {
  const palette = extractPalette(
    pixels([
      ['#E4572E', 600],
      ['#1D3557', 400],
    ]),
    6,
  );
  expect(palette.map((swatch) => swatch.hex)).toEqual(['#E4572E', '#1D3557']);
  expect(palette[0].share).toBeCloseTo(0.6, 10);
  expect(palette[1].share).toBeCloseTo(0.4, 10);
});

test('see-through pixels are ignored', () => {
  const sample = pixels([
    ['#FF00FF', 5000, 0],
    ['#FF00FF', 300, 90],
    ['#2A9D8F', 700],
  ]);
  expect(sample.total).toBe(700);
  expect(extractPalette(sample, 6).map((swatch) => swatch.hex)).toEqual(['#2A9D8F']);
  expect(extractPalette(pixels([['#000000', 10, 0]]))).toEqual([]);
});

test('extraction is deterministic and finds the colors under the noise', () => {
  const bases = ['#E9C46A', '#F4A261', '#E76F51', '#2A9D8F', '#264653'].map((hex) =>
    hexToRgb(hex)!,
  );
  const make = () => {
    const random = stream(7);
    const data: number[] = [];
    bases.forEach((base, index) => {
      for (let pixel = 0; pixel < 1200 - index * 150; pixel += 1) {
        const jitter = () => Math.round((random() - 0.5) * 12);
        data.push(base.r + jitter(), base.g + jitter(), base.b + jitter(), 255);
      }
    });
    return sampleColors(
      data.map((value) => Math.max(0, Math.min(255, value))),
      data.length / 4,
      1,
    );
  };
  const first = extractPalette(make(), 5);
  const second = extractPalette(make(), 5);
  expect(second).toEqual(first);
  expect(first).toHaveLength(5);
  // Each swatch lands on one of the colors it came from, biggest first.
  first.forEach((swatch, index) => {
    const base = bases[index];
    expect(Math.abs(swatch.rgb.r - base.r)).toBeLessThanOrEqual(3);
    expect(Math.abs(swatch.rgb.g - base.g)).toBeLessThanOrEqual(3);
    expect(Math.abs(swatch.rgb.b - base.b)).toBeLessThanOrEqual(3);
  });
  expect(first.reduce((sum, swatch) => sum + swatch.share, 0)).toBeCloseTo(1, 10);
});

test('near-duplicates merge, and a flat color keeps its exact value', () => {
  // #F80808 is a different pixel value than #FF0000, but no one could tell them apart.
  const palette = extractPalette(
    pixels([
      ['#FF0000', 500],
      ['#F80808', 300],
      ['#0000FF', 200],
    ]),
    6,
  );
  expect(palette.map((swatch) => swatch.hex)).toEqual(['#FF0000', '#0000FF']);
  expect(palette[0].share).toBeCloseTo(0.8, 10);

  const merged = mergeNear([
    { ...rgbToOklab({ r: 255, g: 0, b: 0 }), weight: 3 },
    { ...rgbToOklab({ r: 250, g: 5, b: 5 }), weight: 1 },
    { ...rgbToOklab({ r: 0, g: 0, b: 255 }), weight: 2 },
  ]);
  expect(merged).toHaveLength(2);
  expect(merged[0].weight).toBe(4);
  expect(merged[1].weight).toBe(2);
});

test('anti-aliased edges fold back into the colors they blend', () => {
  // A logo: two flat colors and a thin seam of in-between pixels where they meet.
  const palette = extractPalette(
    pixels([
      ['#E4572E', 3000],
      ['#1D3557', 2000],
      ['#814643', 40],
      ['#B24F38', 30],
    ]),
    6,
  );
  expect(palette.map((swatch) => swatch.hex)).toEqual(['#E4572E', '#1D3557']);
  expect(palette[0].share + palette[1].share).toBeCloseTo(1, 10);
});

test('how much of the image a picked color covers, and where it is', () => {
  const data: number[] = [];
  // 4×4: left half navy, right half coral, one transparent corner.
  for (let y = 0; y < 4; y += 1)
    for (let x = 0; x < 4; x += 1) {
      const { r, g, b } = hexToRgb(x < 2 ? '#1D3557' : '#E4572E')!;
      data.push(r, g, b, x === 3 && y === 3 ? 0 : 255);
    }
  const sample = sampleColors(data, 4, 4);
  expect(sample.total).toBe(15);
  expect(shareNear(sample, hexToRgb('#1D3557')!)).toBeCloseTo(8 / 15, 10);
  expect(shareNear(sample, hexToRgb('#00FF00')!)).toBe(0);
  const navy = locateColor(sample, hexToRgb('#1D3557')!)!;
  expect(navy.x).toBeLessThan(0.5);
  const coral = locateColor(sample, hexToRgb('#E4572E')!)!;
  expect(coral.x).toBeGreaterThan(0.5);
  expect(formatShare(0.312)).toBe('31%');
  expect(formatShare(0.001)).toBe('<1%');
});

test('exports: CSS variables, a Tailwind theme, JSON and a swatch sheet', () => {
  const swatches = [
    { hex: '#E4572E', rgb: { r: 228, g: 87, b: 46 }, share: 0.6 },
    { hex: '#1D3557', rgb: { r: 29, g: 53, b: 87 }, share: 0.4 },
  ];
  const hexes = swatches.map((swatch) => swatch.hex);
  expect(cssVariables(hexes)).toBe(':root {\n  --palette-1: #E4572E;\n  --palette-2: #1D3557;\n}');
  expect(tailwindTheme(hexes)).toBe(
    '@theme {\n  --color-palette-1: #E4572E;\n  --color-palette-2: #1D3557;\n}',
  );
  const json = JSON.parse(paletteJson(swatches));
  expect(json[0]).toMatchObject({
    name: 'palette-1',
    hex: '#E4572E',
    rgb: [228, 87, 46],
    hsl: [14, 77, 54],
    share: 60,
    text: 'black',
  });
  expect(json[1].text).toBe('white');

  const sheet = swatchSheet(swatches);
  const svg = sheetSvg(sheet);
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('fill="#E4572E"');
  expect(svg).toContain('>#1D3557</text>');
  expect(svg).toContain('>60%</text>');
  // Every shape is on the sheet.
  for (const shape of sheet.shapes) {
    expect(shape.x).toBeGreaterThanOrEqual(0);
    expect(shape.x).toBeLessThan(sheet.width);
    expect(shape.y).toBeLessThanOrEqual(sheet.height);
  }
});
