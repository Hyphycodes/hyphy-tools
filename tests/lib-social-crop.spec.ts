import { expect, test } from '@playwright/test';
import {
  blurPixels,
  DEFAULT_FORMATS,
  fitInside,
  frameFileName,
  layoutFrame,
  MAX_SIDE,
  NETWORKS,
  newFraming,
  outputSize,
  panBy,
  parseCustom,
  ratioLabel,
  SOCIAL_FORMATS,
  withMode,
  zoomAt,
  ZOOM,
  type FrameFormat,
  type Framing,
  type Size,
} from '@/lib/tools/social-formats';

/* Social Crop: the size table and the framing math behind every export. */

const EPSILON = 1e-6;
const preset = (id: string) => SOCIAL_FORMATS.find((format) => format.id === id)!;
const photos: Size[] = [
  { width: 4032, height: 3024 },
  { width: 3024, height: 4032 },
  { width: 800, height: 600 },
  { width: 1200, height: 1200 },
  { width: 6000, height: 1000 },
  { width: 37, height: 911 },
];

test('the size table is sane', () => {
  const ids = SOCIAL_FORMATS.map((format) => format.id);
  expect(new Set(ids).size).toBe(ids.length);
  const networks = new Set(NETWORKS.map((network) => network.id));
  for (const format of SOCIAL_FORMATS) {
    expect(networks.has(format.network)).toBe(true);
    expect(format.network).not.toBe('custom');
    expect(Number.isInteger(format.width) && format.width > 0).toBe(true);
    expect(Number.isInteger(format.height) && format.height > 0).toBe(true);
    expect(Math.max(format.width, format.height)).toBeLessThanOrEqual(MAX_SIDE);
    expect(format.ratio).toBeFalsy();
    for (const area of format.covered ?? []) {
      expect(area.x).toBeGreaterThanOrEqual(0);
      expect(area.y).toBeGreaterThanOrEqual(0);
      expect(area.x + area.width).toBeLessThanOrEqual(1 + EPSILON);
      expect(area.y + area.height).toBeLessThanOrEqual(1 + EPSILON);
    }
  }
  const sizes = Object.fromEntries(
    SOCIAL_FORMATS.map((format) => [format.id, `${format.width}×${format.height}`]),
  );
  expect(sizes).toEqual({
    'instagram-post': '1080×1080',
    'instagram-portrait': '1080×1350',
    'instagram-story': '1080×1920',
    tiktok: '1080×1920',
    'youtube-thumbnail': '1280×720',
    'x-post': '1600×900',
    'x-header': '1500×500',
    'linkedin-post': '1200×627',
    'linkedin-banner': '1584×396',
    'facebook-cover': '1640×624',
  });
  // Only the full-screen vertical formats mark where the app covers them.
  expect(SOCIAL_FORMATS.filter((format) => format.covered).map((format) => format.id)).toEqual([
    'instagram-story',
    'tiktok',
  ]);
  for (const id of DEFAULT_FORMATS) expect(ids).toContain(id);

  expect(ratioLabel(1080, 1080)).toBe('1:1');
  expect(ratioLabel(1080, 1350)).toBe('4:5');
  expect(ratioLabel(1080, 1920)).toBe('9:16');
  expect(ratioLabel(1280, 720)).toBe('16:9');
  expect(ratioLabel(1500, 500)).toBe('3:1');
  expect(ratioLabel(1200, 627)).toBe('1.91:1');
  expect(ratioLabel(1584, 396)).toBe('4:1');
  expect(ratioLabel(1640, 624)).toBe('2.63:1');
  expect(ratioLabel(3, 2)).toBe('3:2');
});

/**
 * What's wrong with a layout, if anything. Crop: inside the photo, exactly the frame's shape.
 * Fit: the whole photo, inside the frame, in the photo's shape.
 */
function problems(source: Size, output: Size, framing: Framing) {
  const { source: part, target, scale } = layoutFrame(source, output, framing);
  const found: string[] = [];
  const check = (ok: boolean, what: string) => ok || found.push(what);
  const close = (a: number, b: number) => Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(b));
  check(scale > 0 && Number.isFinite(scale), 'scale');
  if (framing.mode === 'crop') {
    check(part.x >= -EPSILON && part.y >= -EPSILON, 'crop starts outside the photo');
    check(part.x + part.width <= source.width + EPSILON, 'crop runs off the right');
    check(part.y + part.height <= source.height + EPSILON, 'crop runs off the bottom');
    check(close(part.width / part.height, output.width / output.height), 'crop shape');
    check(target.x === 0 && target.y === 0, 'crop fills the frame');
    check(target.width === output.width && target.height === output.height, 'crop fills');
    check(close(part.width * scale, output.width), 'crop scale');
  } else {
    check(part.x === 0 && part.y === 0, 'fit shows the whole photo');
    check(part.width === source.width && part.height === source.height, 'fit whole');
    check(target.x >= -EPSILON && target.y >= -EPSILON, 'fit starts outside the frame');
    check(target.x + target.width <= output.width + EPSILON, 'fit runs off the right');
    check(target.y + target.height <= output.height + EPSILON, 'fit runs off the bottom');
    check(close(target.width / target.height, source.width / source.height), 'fit shape');
  }
  return found;
}

test('crop and fit stay inside the lines at any zoom and position', () => {
  const positions = [0, 0.25, 0.5, 1];
  const outputs = SOCIAL_FORMATS.map((format) => ({ width: format.width, height: format.height }));
  const failures: string[] = [];
  for (const source of photos)
    for (const output of outputs)
      for (const mode of ['crop', 'fit'] as const)
        for (const zoom of [ZOOM[mode].min, 0.7, 1, 1.5, 3, ZOOM[mode].max, 99, -2, Number.NaN])
          for (const x of positions)
            for (const y of positions)
              for (const problem of problems(source, output, { ...newFraming(), mode, zoom, x, y }))
                failures.push(
                  `${source.width}x${source.height} → ${output.width}x${output.height} ${mode} ` +
                    `zoom ${zoom} at ${x},${y}: ${problem}`,
                );
  expect(failures).toEqual([]);
  // Out-of-range positions are pulled back in, not drawn off the photo.
  expect(
    problems(
      { width: 1000, height: 500 },
      { width: 1080, height: 1080 },
      {
        ...newFraming(),
        x: 7,
        y: -3,
      },
    ),
  ).toEqual([]);
});

test('crop picks the right part of the photo', () => {
  const photo = { width: 4000, height: 3000 };
  const square = { width: 1080, height: 1080 };
  // Zoom 1, centered: the largest square, in the middle.
  expect(layoutFrame(photo, square, newFraming()).source).toEqual({
    x: 500,
    y: 0,
    width: 3000,
    height: 3000,
  });
  // All the way left.
  expect(layoutFrame(photo, square, { ...newFraming(), x: 0 }).source.x).toBe(0);
  expect(layoutFrame(photo, square, { ...newFraming(), x: 1 }).source.x).toBe(1000);
  // Zoom 2 shows half as much.
  const zoomed = layoutFrame(photo, square, { ...newFraming(), zoom: 2 });
  expect(zoomed.source.width).toBeCloseTo(1500, 6);
  expect(zoomed.source.x).toBeCloseTo(1250, 6);
  expect(zoomed.source.y).toBeCloseTo(750, 6);
  expect(zoomed.scale).toBeCloseTo(0.72, 6);
  // A small photo in a big frame is enlarged, and the scale says so.
  expect(layoutFrame({ width: 800, height: 600 }, square, newFraming()).scale).toBeCloseTo(1.8, 6);
});

test('fit shows the whole photo and can sit anywhere in the frame', () => {
  const photo = { width: 4000, height: 3000 };
  const story = { width: 1080, height: 1920 };
  const fit = { ...newFraming(), mode: 'fit' as const };
  expect(layoutFrame(photo, story, fit).target).toEqual({ x: 0, y: 555, width: 1080, height: 810 });
  expect(layoutFrame(photo, story, { ...fit, y: 0 }).target.y).toBe(0);
  expect(layoutFrame(photo, story, { ...fit, y: 1 }).target.y).toBe(1110);
  const smaller = layoutFrame(photo, story, { ...fit, zoom: 0.5 }).target;
  expect(smaller.width).toBeCloseTo(540, 6);
  expect(smaller.x).toBeCloseTo(270, 6);
});

test('dragging and zooming keep the photo where the finger is', () => {
  const photo = { width: 4000, height: 3000 };
  const square = { width: 1000, height: 1000 };
  const start = { ...newFraming(), zoom: 2 };
  // Dragging right by 100 output px shows what was to the left: 100 / scale photo px.
  const before = layoutFrame(photo, square, start);
  const moved = layoutFrame(photo, square, panBy(photo, square, start, 100, 0));
  expect(before.source.x - moved.source.x).toBeCloseTo(100 / before.scale, 6);
  // Dragged far past the edge, it stops at the edge.
  expect(panBy(photo, square, start, 1e6, 0).x).toBe(0);
  expect(panBy(photo, square, start, -1e6, 0).x).toBe(1);

  // Zooming around a corner keeps the photo point under that corner.
  const anchor = { x: 0.2, y: 0.3 };
  const pointBefore = {
    x: before.source.x + anchor.x * before.source.width,
    y: before.source.y + anchor.y * before.source.height,
  };
  const after = layoutFrame(photo, square, zoomAt(photo, square, start, 3, anchor));
  expect(after.source.x + anchor.x * after.source.width).toBeCloseTo(pointBefore.x, 6);
  expect(after.source.y + anchor.y * after.source.height).toBeCloseTo(pointBefore.y, 6);
  // Zoom is capped at the mode's range.
  expect(zoomAt(photo, square, start, 50).zoom).toBe(ZOOM.crop.max);

  // Fit: the photo slides in the frame's free room and grows around the anchor.
  const story = { width: 1080, height: 1920 };
  const fit = withMode(newFraming(), 'fit');
  expect(fit).toMatchObject({ mode: 'fit', zoom: 1, x: 0.5, y: 0.5 });
  const down = layoutFrame(photo, story, panBy(photo, story, fit, 0, 200));
  expect(down.target.y).toBeCloseTo(555 + 200, 6);
  const shrunk = zoomAt(photo, story, fit, 0.5, { x: 0.5, y: 0.5 });
  const shrunkLayout = layoutFrame(photo, story, shrunk);
  expect(shrunkLayout.target.x + shrunkLayout.target.width / 2).toBeCloseTo(540, 6);
  expect(shrunkLayout.target.y + shrunkLayout.target.height / 2).toBeCloseTo(960, 6);
});

test('custom shapes and sizes read the way people type them', () => {
  const read = (text: string) => {
    const result = parseCustom(text);
    return 'format' in result ? result.format : result.error;
  };
  expect(read('3:2')).toMatchObject({ id: 'ratio-3x2', width: 3, height: 2, ratio: true });
  expect(read('6:4')).toMatchObject({ id: 'ratio-3x2', label: '3:2' });
  expect(read('16x9')).toMatchObject({ width: 16, height: 9, ratio: true });
  expect(read('1.91:1')).toMatchObject({ width: 1.91, height: 1, ratio: true, label: '1.91:1' });
  expect(read(' 4 / 5 ')).toMatchObject({ width: 4, height: 5, ratio: true });
  expect(read('1200x628')).toMatchObject({
    id: 'size-1200x628',
    width: 1200,
    height: 628,
    network: 'custom',
  });
  expect(read('1200 × 628 px')).toMatchObject({ width: 1200, height: 628 });
  expect(read('800 by 600')).toMatchObject({ width: 800, height: 600 });
  expect((read('1200x628') as FrameFormat).ratio).toBeFalsy();
  expect(read('')).toMatch(/shape like 3:2/);
  expect(read('wide')).toMatch(/shape like 3:2/);
  expect(read('0:1')).toMatch(/more than zero/);
  expect(read('1:20')).toMatch(/1:10/);
  expect(read('9000x100')).toMatch(/4096/);
  expect(read('1200x8')).toMatch(/16 px/);
});

test('a custom shape exports at the photo’s own resolution, never above the cap', () => {
  const photo = { width: 3600, height: 2400 };
  const shape = (parseCustom('1:1') as { format: FrameFormat }).format;
  expect(outputSize(shape, photo, newFraming())).toEqual({ width: 2400, height: 2400 });
  expect(outputSize(shape, photo, { ...newFraming(), zoom: 2 })).toEqual({
    width: 1200,
    height: 1200,
  });
  expect(outputSize(shape, photo, withMode(newFraming(), 'fit'))).toEqual({
    width: 3600,
    height: 3600,
  });
  // Cropped at its own size, a custom shape is never enlarged.
  const framing = { ...newFraming(), zoom: 1.7, x: 0.2 };
  const size = outputSize(shape, photo, framing);
  expect(layoutFrame(photo, size, framing).scale).toBeCloseTo(1, 2);
  // Capped for a huge photo, still the right shape.
  const huge = outputSize(
    (parseCustom('2:1') as { format: FrameFormat }).format,
    { width: 4096, height: 4000 },
    withMode(newFraming(), 'fit'),
  );
  expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(MAX_SIDE);
  expect(huge.width / huge.height).toBeCloseTo(2, 2);
  // Presets are always their exact size.
  expect(outputSize(preset('x-header'), photo, { ...newFraming(), zoom: 3 })).toEqual({
    width: 1500,
    height: 500,
  });
  expect(fitInside({ width: 200, height: 100 }, { width: 1080, height: 1920 })).toEqual({
    width: 56.25,
    height: 100,
  });
});

test('the backdrop blur softens edges and keeps flat areas flat', () => {
  const width = 12;
  const height = 6;
  // Left half black, right half white, fully opaque.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const value = pixel % width < width / 2 ? 0 : 255;
    data.set([value, value, value, 255], pixel * 4);
  }
  blurPixels(data, width, height, 1);
  const at = (x: number, y = 3) => data[(y * width + x) * 4];
  // Far from the edge nothing changes; at the edge, the two sides meet in the middle.
  expect(at(0)).toBe(0);
  expect(at(width - 1)).toBe(255);
  expect(at(5)).toBeGreaterThan(0);
  expect(at(6)).toBeLessThan(255);
  expect(at(5) + at(6)).toBeGreaterThan(200);
  expect(at(5) + at(6)).toBeLessThan(310);
  // Each row is blurred the same way, and alpha stays opaque.
  expect(at(5, 0)).toBe(at(5, 5));
  expect(data[3]).toBe(255);
});

test('downloads are named for the photo, the frame and its size', () => {
  expect(
    frameFileName('Beach.JPG', preset('instagram-post'), { width: 1080, height: 1080 }, 'jpg'),
  ).toBe('beach-instagram-post-1080x1080.jpg');
  expect(
    frameFileName('Día de playa (1).heic', preset('tiktok'), { width: 1080, height: 1920 }, 'png'),
  ).toBe('dia-de-playa-1-tiktok-1080x1920.png');
  const size = (parseCustom('1200x628') as { format: FrameFormat }).format;
  expect(frameFileName('beach.jpg', size, size, 'jpg')).toBe('beach-custom-1200x628.jpg');
  const shape = (parseCustom('1.91:1') as { format: FrameFormat }).format;
  expect(frameFileName('beach.jpg', shape, { width: 3600, height: 1885 }, 'jpg')).toBe(
    'beach-crop-1-91x1-3600x1885.jpg',
  );
  expect(frameFileName('.jpg', preset('x-post'), { width: 1600, height: 900 }, 'jpg')).toBe(
    'photo-x-post-1600x900.jpg',
  );
});
