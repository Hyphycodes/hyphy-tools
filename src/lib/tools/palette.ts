/*
 * Palette: an image's key colors, and what to do with them. Pure and tested
 * (tests/lib-palette.spec.ts).
 *
 * - Colors are compared in OKLab, where equal distances look like equal differences, so a
 *   palette isn't six shades of the same sky.
 * - Extraction is k-means over the image's colors, seeded without randomness (the same image
 *   always gives the same palette). Colors a person couldn't tell apart are merged, and the mixed
 *   pixels where two flat colors meet (anti-aliasing) are folded back into those two colors.
 * - A flat color comes back exact: when one pixel value clearly leads its cluster, that value is
 *   the swatch, so a logo's brand color isn't nudged by its own soft edges.
 * - Contrast is WCAG 2's relative-luminance ratio, never rounded up past a threshold it misses.
 */

export type Rgb = { r: number; g: number; b: number };
/** Hue in degrees, saturation and lightness in percent. */
export type Hsl = { h: number; s: number; l: number };
export type Oklab = { l: number; a: number; b: number };

export const MIN_COLORS = 3;
export const MAX_COLORS = 10;
export const DEFAULT_COLORS = 6;
/** Closer than this in OKLab and two colors are one swatch (barely noticeable is about 0.02). */
export const NEAR_DUPLICATE = 0.045;
/** Pixels this transparent or more don't count: they aren't part of what you see. */
const OPAQUE = 128;
/** A cluster smaller than this share of the image is specks and edges, not a color. */
const MIN_SHARE = 0.002;
/** A pixel within this (0–255 RGB) of the straight line between two colors is a mix of them. */
const BLEND_DISTANCE = 12;
/** Only clusters under this share can turn out to be edges; bigger ones are colors. */
const BLEND_SHARE = 0.06;
/** When one exact value holds this much of a cluster, it's a flat color: keep it exact. */
const FLAT_SHARE = 0.25;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const byte = (value: number) => clamp(Math.round(value), 0, 255);

/** sRGB channel (0–255) → linear light, as a table: extraction converts thousands of colors. */
const LINEAR = Float64Array.from({ length: 256 }, (_, index) => {
  const c = index / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const toGamma = (value: number) =>
  byte((value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055) * 255);

/* ---------------- conversions ---------------- */

/** "#E4572E", "e4572e" or "#e52" → RGB. Anything else → null. */
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : match[1];
  const value = Number.parseInt(digits, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex({ r, g, b }: Rgb) {
  return `#${[r, g, b].map((channel) => byte(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const unpack = (color: number): Rgb => ({ r: color >> 16, g: (color >> 8) & 255, b: color & 255 });

/** Unrounded, so a round trip is exact; round for display. */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = byte(r) / 255;
  const green = byte(g) / 255;
  const blue = byte(b) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const range = max - min;
  if (range === 0) return { h: 0, s: 0, l: l * 100 };
  const s = range / (1 - Math.abs(2 * l - 1));
  let h =
    max === red
      ? ((green - blue) / range) % 6
      : max === green
        ? (blue - red) / range + 2
        : (red - green) / range + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return { r: byte((red + m) * 255), g: byte((green + m) * 255), b: byte((blue + m) * 255) };
}

function linearToOklab(r: number, g: number, b: number): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab (Björn Ottosson, 2020): perceptual lightness `l` (0–1) and two color axes. */
export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  return linearToOklab(LINEAR[byte(r)], LINEAR[byte(g)], LINEAR[byte(b)]);
}

/** Back to sRGB, clamped: OKLab can describe colors a screen can't show. */
export function oklabToRgb({ l, a, b }: Oklab): Rgb {
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: toGamma(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    g: toGamma(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    b: toGamma(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  };
}

/** How different two colors look: distance in OKLab. */
export const colorDistance = (x: Oklab, y: Oklab) => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);

export const formatRgb = ({ r, g, b }: Rgb) => `rgb(${byte(r)}, ${byte(g)}, ${byte(b)})`;

export function formatHsl(rgb: Rgb) {
  const { h, s, l } = rgbToHsl(rgb);
  return `hsl(${Math.round(h) % 360}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/* ---------------- contrast (WCAG 2) ---------------- */

export const WHITE: Rgb = { r: 255, g: 255, b: 255 };
export const BLACK: Rgb = { r: 0, g: 0, b: 0 };

export function luminance({ r, g, b }: Rgb) {
  return 0.2126 * LINEAR[byte(r)] + 0.7152 * LINEAR[byte(g)] + 0.0722 * LINEAR[byte(b)];
}

export function contrastRatio(x: Rgb, y: Rgb) {
  const [light, dark] = [luminance(x), luminance(y)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Which text reads better on a color, white or black, and at what contrast. */
export function textOn(color: Rgb): { text: 'white' | 'black'; ratio: number } {
  const white = contrastRatio(color, WHITE);
  const black = contrastRatio(color, BLACK);
  return white >= black ? { text: 'white', ratio: white } : { text: 'black', ratio: black };
}

/** WCAG levels for text: AA needs 4.5:1, AAA 7:1; large text (24px, or 19px bold) gets by on 3:1. */
export function contrastLevel(ratio: number) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA large';
  return 'Low';
}

/** "4.54:1", "21:1": floored, so 4.499 never reads as a passing 4.5. */
export function formatRatio(ratio: number) {
  return `${Number((Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2))}:1`;
}

export type Pair = { first: number; second: number; ratio: number };

/** Every pair in the palette that's readable together (AA, 4.5:1 and up), best first. */
export function readablePairs(colors: Rgb[], minimum = 4.5): Pair[] {
  const pairs: Pair[] = [];
  colors.forEach((first, i) =>
    colors.forEach((second, j) => {
      if (j <= i) return;
      const ratio = contrastRatio(first, second);
      if (ratio >= minimum) pairs.push({ first: i, second: j, ratio });
    }),
  );
  return pairs.sort((a, b) => b.ratio - a.ratio || a.first - b.first || a.second - b.second);
}

/* ---------------- extraction ---------------- */

/**
 * An image's pixels, counted: each distinct color with how many pixels have it and its OKLab
 * coordinates, plus which color every pixel is (-1 where it's see-through).
 */
export type ColorSample = {
  width: number;
  height: number;
  /** Opaque pixels. */
  total: number;
  /** 0xRRGGBB. */
  colors: Uint32Array;
  counts: Uint32Array;
  /** l, a, b for each color. */
  lab: Float64Array;
  pixels: Int32Array;
};

/** Reads RGBA pixels (a canvas's ImageData), skipping transparent ones. */
export function sampleColors(rgba: ArrayLike<number>, width: number, height: number): ColorSample {
  const size = Math.min(width * height, Math.floor(rgba.length / 4));
  const index = new Map<number, number>();
  const tally: number[] = [];
  const pixels = new Int32Array(size).fill(-1);
  let total = 0;
  for (let pixel = 0; pixel < size; pixel += 1) {
    const offset = pixel * 4;
    if (rgba[offset + 3] < OPAQUE) continue;
    const color = (rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2];
    let slot = index.get(color);
    if (slot === undefined) {
      slot = index.size;
      index.set(color, slot);
      tally.push(0);
    }
    tally[slot] += 1;
    pixels[pixel] = slot;
    total += 1;
  }
  const colors = Uint32Array.from(index.keys());
  const lab = new Float64Array(colors.length * 3);
  colors.forEach((color, slot) => {
    const { l, a, b } = linearToOklab(
      LINEAR[color >> 16],
      LINEAR[(color >> 8) & 255],
      LINEAR[color & 255],
    );
    lab.set([l, a, b], slot * 3);
  });
  return { width, height, total, colors, counts: Uint32Array.from(tally), lab, pixels };
}

export type Swatch = { hex: string; rgb: Rgb; /** Of the opaque image, 0–1. */ share: number };
type Cluster = Oklab & { weight: number };

const squared = (lab: Float64Array, index: number, center: Oklab) =>
  (lab[index * 3] - center.l) ** 2 +
  (lab[index * 3 + 1] - center.a) ** 2 +
  (lab[index * 3 + 2] - center.b) ** 2;

/**
 * Colors grouped into boxes of 8 levels a channel (32,768 boxes): a photo's tens of thousands of
 * near-identical values become a few thousand weighted points, which k-means handles quickly.
 */
function binColors(sample: ColorSample) {
  const index = new Map<number, number>();
  const binOf = new Int32Array(sample.colors.length);
  const sums: number[] = [];
  sample.colors.forEach((color, slot) => {
    const key = ((color >> 19) << 10) | (((color >> 11) & 31) << 5) | ((color >> 3) & 31);
    let bin = index.get(key);
    if (bin === undefined) {
      bin = index.size;
      index.set(key, bin);
      sums.push(0, 0, 0, 0);
    }
    binOf[slot] = bin;
    const weight = sample.counts[slot];
    sums[bin * 4] += sample.lab[slot * 3] * weight;
    sums[bin * 4 + 1] += sample.lab[slot * 3 + 1] * weight;
    sums[bin * 4 + 2] += sample.lab[slot * 3 + 2] * weight;
    sums[bin * 4 + 3] += weight;
  });
  const lab = new Float64Array(index.size * 3);
  const weight = new Float64Array(index.size);
  for (let bin = 0; bin < index.size; bin += 1) {
    weight[bin] = sums[bin * 4 + 3];
    lab[bin * 3] = sums[bin * 4] / weight[bin];
    lab[bin * 3 + 1] = sums[bin * 4 + 1] / weight[bin];
    lab[bin * 3 + 2] = sums[bin * 4 + 2] / weight[bin];
  }
  return { lab, weight, binOf };
}

type Bins = ReturnType<typeof binColors>;

/**
 * Starting points without randomness: the most common color first, then each time the color that
 * is both common and far from every point so far (k-means++, made deterministic).
 */
function seed(bins: Bins, k: number): Oklab[] {
  const count = bins.weight.length;
  let first = 0;
  for (let bin = 1; bin < count; bin += 1) if (bins.weight[bin] > bins.weight[first]) first = bin;
  const at = (bin: number): Oklab => ({
    l: bins.lab[bin * 3],
    a: bins.lab[bin * 3 + 1],
    b: bins.lab[bin * 3 + 2],
  });
  const centers = [at(first)];
  const nearest = new Float64Array(count).fill(Infinity);
  while (centers.length < k) {
    const latest = centers[centers.length - 1];
    let best = -1;
    let bestScore = 0;
    for (let bin = 0; bin < count; bin += 1) {
      nearest[bin] = Math.min(nearest[bin], squared(bins.lab, bin, latest));
      const score = bins.weight[bin] * nearest[bin];
      if (score > bestScore) {
        bestScore = score;
        best = bin;
      }
    }
    // Every color is already a starting point: the image has fewer colors than asked for.
    if (best < 0) break;
    centers.push(at(best));
  }
  return centers;
}

/** Each bin's nearest center, and the clusters that makes (empty ones dropped). */
function assign(bins: Bins, centers: Oklab[]) {
  const assignment = new Int32Array(bins.weight.length);
  const sums = new Float64Array(centers.length * 4);
  for (let bin = 0; bin < bins.weight.length; bin += 1) {
    let best = 0;
    let bestDistance = Infinity;
    centers.forEach((center, index) => {
      const distance = squared(bins.lab, bin, center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    assignment[bin] = best;
    const weight = bins.weight[bin];
    sums[best * 4] += bins.lab[bin * 3] * weight;
    sums[best * 4 + 1] += bins.lab[bin * 3 + 1] * weight;
    sums[best * 4 + 2] += bins.lab[bin * 3 + 2] * weight;
    sums[best * 4 + 3] += weight;
  }
  const clusters: Cluster[] = centers.map((_, index) => {
    const weight = sums[index * 4 + 3];
    return weight
      ? {
          l: sums[index * 4] / weight,
          a: sums[index * 4 + 1] / weight,
          b: sums[index * 4 + 2] / weight,
          weight,
        }
      : { l: 0, a: 0, b: 0, weight: 0 };
  });
  return { assignment, clusters };
}

/** Merges colors closer than `threshold` (closest pair first), weighted by how much each covers. */
export function mergeNear(clusters: Cluster[], threshold = NEAR_DUPLICATE): Cluster[] {
  const list = clusters.filter((cluster) => cluster.weight > 0).map((cluster) => ({ ...cluster }));
  for (;;) {
    let pair: [number, number] | null = null;
    let closest = threshold;
    for (let i = 0; i < list.length; i += 1)
      for (let j = i + 1; j < list.length; j += 1) {
        const distance = colorDistance(list[i], list[j]);
        if (distance < closest) {
          closest = distance;
          pair = [i, j];
        }
      }
    if (!pair) return list;
    const [i, j] = pair;
    const weight = list[i].weight + list[j].weight;
    const mix = (key: 'l' | 'a' | 'b') =>
      (list[i][key] * list[i].weight + list[j][key] * list[j].weight) / weight;
    list[i] = { l: mix('l'), a: mix('a'), b: mix('b'), weight };
    list.splice(j, 1);
  }
}

/** Is `point` on the straight line between `from` and `to` (sRGB), away from both ends? */
function between(point: Rgb, from: Rgb, to: Rgb) {
  const line = [to.r - from.r, to.g - from.g, to.b - from.b];
  const offset = [point.r - from.r, point.g - from.g, point.b - from.b];
  const length = line[0] ** 2 + line[1] ** 2 + line[2] ** 2;
  if (!length) return false;
  const t = (offset[0] * line[0] + offset[1] * line[1] + offset[2] * line[2]) / length;
  if (t <= 0.08 || t >= 0.92) return false;
  return (
    Math.hypot(offset[0] - t * line[0], offset[1] - t * line[1], offset[2] - t * line[2]) <=
    BLEND_DISTANCE
  );
}

/**
 * The image's key colors, most of the image first. Asks for `count` (3–10) and may return fewer
 * when the image simply has fewer colors. Shares add up to the whole opaque image.
 */
export function extractPalette(sample: ColorSample, count = DEFAULT_COLORS): Swatch[] {
  if (!sample.total) return [];
  const k = clamp(Math.round(count), 1, MAX_COLORS);
  const bins = binColors(sample);

  let centers: Oklab[] = seed(bins, k);
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const next = assign(bins, centers).clusters.filter((cluster) => cluster.weight > 0);
    const settled =
      next.length === centers.length &&
      next.every((cluster, index) => colorDistance(cluster, centers[index]) < 1e-5);
    centers = next;
    if (settled) break;
  }

  // Merge look-alikes, then drop specks into their nearest neighbor.
  let clusters = mergeNear(assign(bins, centers).clusters);
  const specks = clusters.filter((cluster) => cluster.weight / sample.total < MIN_SHARE);
  if (specks.length < clusters.length)
    clusters = clusters.filter((cluster) => !specks.includes(cluster));
  const { assignment, clusters: final } = assign(bins, clusters);

  // Each cluster's most common exact value: kept as-is when it clearly leads (a flat color).
  const top = new Int32Array(final.length).fill(-1);
  const topCount = new Float64Array(final.length);
  sample.colors.forEach((_, slot) => {
    const cluster = assignment[bins.binOf[slot]];
    if (sample.counts[slot] > topCount[cluster]) {
      topCount[cluster] = sample.counts[slot];
      top[cluster] = slot;
    }
  });
  const reps = final.map((cluster, index): Rgb => {
    const slot = top[index];
    const exact =
      slot >= 0 &&
      topCount[index] >= cluster.weight * FLAT_SHARE &&
      Math.sqrt(squared(sample.lab, slot, cluster)) < NEAR_DUPLICATE;
    return exact ? unpack(sample.colors[slot]) : oklabToRgb(cluster);
  });

  // Where two flat colors meet, edge pixels mix them. A small cluster whose pixels are mostly
  // such mixes of two bigger colors isn't a color of its own: its pixels go back to the nearest.
  const weights = final.map((cluster) => cluster.weight);
  const mixed = new Float64Array(final.length);
  sample.colors.forEach((color, slot) => {
    const own = assignment[bins.binOf[slot]];
    if (weights[own] / sample.total >= BLEND_SHARE) return;
    const rgb = unpack(color);
    const bigger = final
      .map((_, index) => index)
      .filter((index) => weights[index] > weights[own] * 2);
    for (let i = 0; i < bigger.length; i += 1)
      for (let j = i + 1; j < bigger.length; j += 1)
        if (between(rgb, reps[bigger[i]], reps[bigger[j]])) {
          mixed[own] += sample.counts[slot];
          return;
        }
  });
  const edges = final.map(
    (cluster, index) => cluster.weight > 0 && mixed[index] >= cluster.weight * 0.6,
  );
  if (edges.some(Boolean) && !edges.every((edge, index) => edge || !final[index].weight)) {
    sample.colors.forEach((_, slot) => {
      const own = assignment[bins.binOf[slot]];
      if (!edges[own]) return;
      let nearest = -1;
      let best = Infinity;
      final.forEach((cluster, index) => {
        if (edges[index] || !cluster.weight) return;
        const distance = squared(sample.lab, slot, cluster);
        if (distance < best) {
          best = distance;
          nearest = index;
        }
      });
      weights[own] -= sample.counts[slot];
      weights[nearest] += sample.counts[slot];
    });
  }

  return final
    .map((_, index): Swatch | null =>
      weights[index] > 0.5 && !edges[index]
        ? { hex: rgbToHex(reps[index]), rgb: reps[index], share: weights[index] / sample.total }
        : null,
    )
    .filter((swatch): swatch is Swatch => swatch !== null)
    .sort((a, b) => b.share - a.share);
}

/** How much of the image looks like `color` (within a near-duplicate), 0–1. */
export function shareNear(sample: ColorSample, color: Rgb, radius = NEAR_DUPLICATE) {
  if (!sample.total) return 0;
  const target = rgbToOklab(color);
  let near = 0;
  sample.colors.forEach((_, slot) => {
    if (squared(sample.lab, slot, target) < radius * radius) near += sample.counts[slot];
  });
  return near / sample.total;
}

/**
 * Where a color sits in the image (0–1 across and down): the matching pixel nearest the middle
 * of all the pixels that match, so the mark lands inside the area, not on its edge.
 */
export function locateColor(sample: ColorSample, color: Rgb): { x: number; y: number } | null {
  const target = rgbToOklab(color);
  const distances = new Float64Array(sample.colors.length);
  sample.colors.forEach((_, slot) => (distances[slot] = squared(sample.lab, slot, target)));
  let closest = Infinity;
  sample.pixels.forEach((slot) => {
    if (slot >= 0 && distances[slot] < closest) closest = distances[slot];
  });
  if (closest === Infinity) return null;
  const limit = Math.max(closest, NEAR_DUPLICATE * NEAR_DUPLICATE);
  let sumX = 0;
  let sumY = 0;
  let matches = 0;
  sample.pixels.forEach((slot, pixel) => {
    if (slot < 0 || distances[slot] > limit) return;
    sumX += pixel % sample.width;
    sumY += Math.floor(pixel / sample.width);
    matches += 1;
  });
  const middleX = sumX / matches;
  const middleY = sumY / matches;
  let best = -1;
  let bestDistance = Infinity;
  sample.pixels.forEach((slot, pixel) => {
    if (slot < 0 || distances[slot] > limit) return;
    const distance =
      ((pixel % sample.width) - middleX) ** 2 + (Math.floor(pixel / sample.width) - middleY) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = pixel;
    }
  });
  return {
    x: ((best % sample.width) + 0.5) / sample.width,
    y: (Math.floor(best / sample.width) + 0.5) / sample.height,
  };
}

/** "31%", and "<1%" rather than a misleading 0%. */
export function formatShare(share: number) {
  if (share > 0 && share < 0.005) return '<1%';
  return `${Math.round(share * 100)}%`;
}

/* ---------------- exports ---------------- */

export function cssVariables(hexes: string[]) {
  return [':root {', ...hexes.map((hex, index) => `  --palette-${index + 1}: ${hex};`), '}'].join(
    '\n',
  );
}

/** Tailwind v4 reads theme colors from `--color-*` variables in an `@theme` block. */
export function tailwindTheme(hexes: string[]) {
  return [
    '@theme {',
    ...hexes.map((hex, index) => `  --color-palette-${index + 1}: ${hex};`),
    '}',
  ].join('\n');
}

export function paletteJson(swatches: Swatch[]) {
  return JSON.stringify(
    swatches.map((swatch, index) => {
      const { h, s, l } = rgbToHsl(swatch.rgb);
      const text = textOn(swatch.rgb);
      return {
        name: `palette-${index + 1}`,
        hex: swatch.hex,
        rgb: [swatch.rgb.r, swatch.rgb.g, swatch.rgb.b],
        hsl: [Math.round(h) % 360, Math.round(s), Math.round(l)],
        share: Math.round(swatch.share * 1000) / 10,
        text: text.text,
        contrast: Math.floor(text.ratio * 100) / 100,
      };
    }),
    null,
    2,
  );
}

export type SheetShape =
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fill: string;
    }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      weight: number;
      fill: string;
      mono: boolean;
    };

/**
 * A swatch sheet (1200 wide): a block of each color with its HEX, RGB and share underneath. One
 * layout, drawn twice: as SVG text, and on a canvas for the PNG.
 */
export function swatchSheet(swatches: Swatch[]) {
  const width = 1200;
  const height = 640;
  const pad = 40;
  const gap = 12;
  const column = (width - pad * 2 - gap * (swatches.length - 1)) / Math.max(1, swatches.length);
  const hexSize = Math.min(24, Math.floor(column / 5.2));
  const detailSize = Math.min(15, Math.floor(column / 7.6));
  const shapes: SheetShape[] = [
    { kind: 'rect', x: 0, y: 0, width, height, radius: 0, fill: '#FFFFFF' },
  ];
  swatches.forEach((swatch, index) => {
    const x = Math.round(pad + index * (column + gap));
    shapes.push(
      {
        kind: 'rect',
        x,
        y: pad,
        width: Math.round(column),
        height: 440,
        radius: 14,
        fill: swatch.hex,
      },
      {
        kind: 'text',
        x,
        y: pad + 440 + 40,
        text: swatch.hex,
        size: hexSize,
        weight: 700,
        fill: '#16150F',
        mono: true,
      },
      {
        kind: 'text',
        x,
        y: pad + 440 + 40 + detailSize + 12,
        text: `${swatch.rgb.r} ${swatch.rgb.g} ${swatch.rgb.b}`,
        size: detailSize,
        weight: 400,
        fill: '#6C685E',
        mono: true,
      },
      {
        kind: 'text',
        x,
        y: pad + 440 + 40 + (detailSize + 12) * 2,
        text: formatShare(swatch.share),
        size: detailSize,
        weight: 400,
        fill: '#6C685E',
        mono: true,
      },
    );
  });
  return { width, height, shapes };
}

export const SHEET_FONTS = {
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export function sheetSvg(sheet: ReturnType<typeof swatchSheet>) {
  const body = sheet.shapes.map((shape) =>
    shape.kind === 'rect'
      ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.radius}" fill="${shape.fill}"/>`
      : `<text x="${shape.x}" y="${shape.y}" font-family="${shape.mono ? SHEET_FONTS.mono : SHEET_FONTS.sans}" font-size="${shape.size}" font-weight="${shape.weight}" fill="${shape.fill}">${shape.text.replace(/[<>&"]/g, '')}</text>`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${sheet.height}" viewBox="0 0 ${sheet.width} ${sheet.height}">`,
    ...body.map((line) => `  ${line}`),
    '</svg>',
  ].join('\n');
}

/* ---------------- lighting the room ---------------- */

/** How vivid a color reads: its OKLab chroma, favouring the mid tones over near-black and white. */
export function vividness(rgb: Rgb) {
  const { l, a, b } = rgbToOklab(rgb);
  const chroma = Math.hypot(a, b);
  const tone = 1 - Math.min(1, Math.abs(l - 0.68) / 0.45);
  return chroma * (0.35 + 0.65 * tone);
}

const hueOf = (rgb: Rgb) => {
  const { a, b } = rgbToOklab(rgb);
  return (Math.atan2(b, a) * 180) / Math.PI;
};
const hueGap = (x: Rgb, y: Rgb) => {
  const gap = Math.abs(hueOf(x) - hueOf(y)) % 360;
  return gap > 180 ? 360 - gap : gap;
};

/** Darkened (in OKLab lightness) until it reads as text on white at `minimum` contrast. */
export function inkFor(color: Rgb, minimum = 4.8): Rgb {
  const lab = rgbToOklab(color);
  let ink = color;
  for (let l = lab.l; contrastRatio(ink, WHITE) < minimum && l > 0.05; l -= 0.02)
    ink = oklabToRgb({ ...lab, l });
  return ink;
}

export type RoomColors = {
  accent: string;
  glow: string;
  third: string;
  /** The accent dark enough to read as text on white. */
  accentInk: string;
  /** Text on the accent. */
  onAccent: string;
};

/**
 * The colors a palette lights its room with: the most vivid one as the accent, the most vivid of
 * a clearly different hue as the glow, and the next as the third. Null for a palette with nothing
 * vivid in it (greys, black and white): the room keeps its own colors.
 */
export function roomColors(colors: Rgb[]): RoomColors | null {
  const ranked = colors
    .map((rgb) => ({ rgb, score: vividness(rgb) }))
    .sort((x, y) => y.score - x.score);
  if (!ranked.length || ranked[0].score < 0.045) return null;
  const accent = ranked[0].rgb;
  const rest = ranked.slice(1);
  const glow = (rest.find((item) => item.score >= 0.03 && hueGap(item.rgb, accent) > 40) ?? rest[0])
    ?.rgb;
  const third = rest.find((item) => item.rgb !== glow)?.rgb;
  return {
    accent: rgbToHex(accent),
    glow: rgbToHex(glow ?? accent),
    third: rgbToHex(third ?? glow ?? accent),
    accentInk: rgbToHex(inkFor(accent)),
    onAccent: textOn(accent).text === 'white' ? '#ffffff' : '#12110d',
  };
}
