import { expect, test } from '@playwright/test';
import { extrapolate, percentSmaller, sampleTiles, targetSize } from '../src/lib/tools/resize';

test('a photo comes out no wider than asked, and is never enlarged', () => {
  expect(targetSize({ width: 4032, height: 3024 }, 1920)).toEqual({ width: 1920, height: 1440 });
  expect(targetSize({ width: 800, height: 600 }, 1920)).toEqual({ width: 800, height: 600 });
  expect(targetSize({ width: 800, height: 600 }, null)).toEqual({ width: 800, height: 600 });
});

test('sample tiles are drawn at the output scale and stay inside the photo', () => {
  const source = { width: 4032, height: 3024 };
  const tiles = sampleTiles(source, targetSize(source, 1920));
  expect(tiles).toHaveLength(3);
  for (const tile of tiles) {
    expect(tile.width).toBe(320);
    expect(tile.sw).toBeCloseTo(320 * (4032 / 1920));
    expect(tile.sx + tile.sw).toBeLessThanOrEqual(source.width + 0.001);
    expect(tile.sy + tile.sh).toBeLessThanOrEqual(source.height + 0.001);
  }
});

test('samples extrapolate to the whole photo, headers counted once', () => {
  const samples = [
    { bytes: 1100, pixels: 10_000 },
    { bytes: 1100, pixels: 10_000 },
  ];
  // 1000 bytes of pixels per 10,000 pixels → 0.1 byte a pixel.
  expect(extrapolate(samples, { width: 1000, height: 1000 }, 100)).toBe(100_100);
  expect(extrapolate([], { width: 10, height: 10 })).toBe(0);
});

test('“92% smaller” in whole percent', () => {
  expect(percentSmaller(4_800_000, 380_000)).toBe(92);
  expect(percentSmaller(100, 120)).toBe(-20);
  expect(percentSmaller(0, 10)).toBe(0);
});
