/*
 * Resize & Compress: the small, pure bits of math behind the outcome cards. How big a photo comes
 * out, where to take a few sample tiles from for a quick trial encode, and how those samples
 * become an estimate for the whole photo ("7.1 MB → ~640 KB").
 */

export type Size = { width: number; height: number };
/** A region of the source photo, and the size it's drawn at for a trial encode. */
export type Tile = { sx: number; sy: number; sw: number; sh: number } & Size;

/** The size a photo comes out at: never wider than asked, never enlarged. */
export function targetSize(source: Size, maxWidth: number | null): Size {
  const width = maxWidth && maxWidth > 0 && maxWidth < source.width ? maxWidth : source.width;
  const height = Math.max(1, Math.round((source.height * width) / source.width));
  return { width, height };
}

/** Where the sample tiles sit, as fractions of the room they can move in. */
const SPOTS: [number, number][] = [
  [0.5, 0.5],
  [0.22, 0.3],
  [0.78, 0.72],
];

/**
 * A few tiles of the photo, each drawn at the scale the real output uses, so encoding them costs a
 * few milliseconds but compresses like the whole picture would.
 */
export function sampleTiles(source: Size, target: Size, side = 320): Tile[] {
  const scale = target.width / source.width;
  const width = Math.max(1, Math.min(side, target.width));
  const height = Math.max(1, Math.min(side, target.height));
  const sw = Math.min(source.width, width / scale);
  const sh = Math.min(source.height, height / scale);
  return SPOTS.map(([x, y]) => ({
    sx: (source.width - sw) * x,
    sy: (source.height - sh) * y,
    sw,
    sh,
    width,
    height,
  }));
}

/** Roughly what a file of each type carries before its first pixel (tables, headers). */
export const HEADER_BYTES: Record<string, number> = {
  'image/jpeg': 620,
  'image/webp': 60,
  'image/png': 80,
};

/** From sample encodes to the whole photo: bytes per pixel, times its pixels. */
export function extrapolate(
  samples: { bytes: number; pixels: number }[],
  target: Size,
  header = 0,
): number {
  const pixels = samples.reduce((sum, sample) => sum + sample.pixels, 0);
  if (!pixels) return 0;
  const bytes = samples.reduce((sum, sample) => sum + Math.max(0, sample.bytes - header), 0);
  return Math.max(header + 1, Math.round((bytes / pixels) * target.width * target.height + header));
}

/** How much lighter, in whole percent: 92 for "92% smaller", negative when it grew. */
export function percentSmaller(before: number, after: number): number {
  if (!before) return 0;
  return Math.round((1 - after / before) * 100);
}
