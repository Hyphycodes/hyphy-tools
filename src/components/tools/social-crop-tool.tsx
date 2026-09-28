'use client';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { download, slugName } from '@/lib/files/download';
import { zip, type ZipEntry } from '@/lib/files/zip';
import { formatBytes } from '@/lib/platform/format';
import { extractPalette, sampleColors } from '@/lib/tools/palette';
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
  sizeLabel,
  SOCIAL_FORMATS,
  SOFT_SCALE,
  withMode,
  ZOOM,
  zoomAt,
  type FrameFormat,
  type Framing,
  type NetworkId,
  type Rect,
  type Size,
} from '@/lib/tools/social-formats';
import {
  ActionBar,
  ActionButton,
  Advanced,
  Choices,
  IconButton,
  Note,
  Payoff,
  PillButton,
  SampleButton,
} from './kit';

/*
 * Social Crop: one photo, framed for every feed. The photo stays in the middle of the studio; the
 * frames it becomes (Square, Portrait, Story, Landscape, Banner, any size) sit under it, and
 * tapping one reshapes the frame around the photo. You drag the photo itself to place it. The
 * finished frames land together as prints, ready to download.
 *
 * The photo is decoded once into an editing copy (at most 4096 px on its long side, more than any
 * network asks for) and a lighter preview copy for the thumbnails. Each size keeps its own framing;
 * exports are drawn from the editing copy at the frame's exact size, on this device.
 */

const MAX_BYTES = 40 * 1024 * 1024;
/** The gallery and the soft backdrop draw from this lighter copy. */
const PREVIEW_SIDE = 1280;
const MAX_CUSTOM = 6;
/**
 * Any image: on an iPhone this offers the photo library and the camera, and hands over HEIC photos
 * as JPEGs, which every browser opens.
 */
const ACCEPT = 'image/*';
const READABLE = /\.(jpe?g|png|webp|gif|avif|hei[cf])$/i;
const HEIC_NOTE =
  'iPhone HEIC photos open only in Safari. Open this page in Safari, or share the photo as a JPG first.';

const TYPES = {
  jpg: { mime: 'image/jpeg', label: 'JPG' },
  png: { mime: 'image/png', label: 'PNG' },
} as const;
type OutputType = keyof typeof TYPES;

const NETWORK_ICONS: Record<NetworkId, IconName> = {
  instagram: 'instagram',
  tiktok: 'tiktok',
  youtube: 'youtube',
  x: 'x-social',
  linkedin: 'linkedin',
  facebook: 'facebook',
  custom: 'crop',
};

type Photo = {
  name: string;
  /** The editing copy: exports and the composer draw from it. */
  image: ImageBitmap | HTMLCanvasElement;
  size: Size;
  /** The photo as it came in. */
  original: Size;
  preview: HTMLCanvasElement;
  /** Its leading colors, for a solid backdrop. */
  colors: string[];
  transparent: boolean;
  gif: boolean;
};
type Point = { x: number; y: number };
type Background = 'white' | 'checker' | undefined;

/* ---------------- pixels ---------------- */

function canvasOf({ width, height }: Size) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Zero-sized, a canvas hands its memory back right away (Safari holds on to it otherwise). */
function freeCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function within(size: Size, side: number): Size {
  const scale = Math.min(1, side / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function copyOf(source: CanvasImageSource, size: Size) {
  const canvas = canvasOf(size);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser couldn’t draw the photo.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

async function decode(file: File): Promise<{ image: ImageBitmap | HTMLCanvasElement; size: Size }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, size: { width: bitmap.width, height: bitmap.height } };
  } catch {
    // Safari reads some formats (HEIC) in an <img> that it won't hand to createImageBitmap.
    const url = URL.createObjectURL(file);
    try {
      const element = new Image();
      element.src = url;
      await element.decode();
      const size = { width: element.naturalWidth, height: element.naturalHeight };
      return { image: copyOf(element, within(size, MAX_SIDE)), size };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Decodes once, then keeps an editing copy, a preview copy and a few facts about the photo. */
async function openPhoto(file: File): Promise<Photo> {
  const decoded = await decode(file);
  const original = decoded.size;
  if (!original.width || !original.height) throw new Error('Empty image');
  const size = within(original, MAX_SIDE);
  let image = decoded.image;
  if (image.width !== size.width || image.height !== size.height) {
    const copy = copyOf(image, size);
    if (image instanceof ImageBitmap) image.close();
    image = copy;
  }
  if (image instanceof HTMLCanvasElement) {
    // A bitmap draws fastest; the canvas was only a stepping stone.
    const canvas = image;
    image = await createImageBitmap(canvas).then(
      (bitmap) => {
        freeCanvas(canvas);
        return bitmap;
      },
      () => canvas,
    );
  }
  const preview = copyOf(image, within(size, PREVIEW_SIDE));
  // A thumbnail's worth of pixels: is anything see-through, and which colors lead?
  const tiny = copyOf(preview, within(size, 96));
  const pixels = tiny.getContext('2d')?.getImageData(0, 0, tiny.width, tiny.height);
  freeCanvas(tiny);
  let transparent = false;
  const colors: string[] = [];
  if (pixels) {
    for (let index = 3; index < pixels.data.length && !transparent; index += 4)
      transparent = pixels.data[index] < 250;
    const sample = sampleColors(pixels.data, pixels.width, pixels.height);
    colors.push(...extractPalette(sample, 5).map((swatch) => swatch.hex));
  }
  return {
    name: file.name,
    image,
    size,
    original,
    preview,
    colors: colors.length ? colors : ['#000000'],
    transparent,
    gif: file.type === 'image/gif' || /\.gif$/i.test(file.name),
  };
}

function release(photo: Photo | null) {
  if (!photo) return;
  if (photo.image instanceof ImageBitmap) photo.image.close();
  else freeCanvas(photo.image);
  freeCanvas(photo.preview);
}

const backdrops = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

/** Fit's soft backdrop: the photo spread across the frame, blurred and a touch darker. Cached. */
function softBackdrop(photo: Photo, output: Size, base: string) {
  const size = within(output, 64);
  const key = `${size.width}x${size.height} ${base}`;
  const cache = backdrops.get(photo.preview) ?? new Map<string, HTMLCanvasElement>();
  backdrops.set(photo.preview, cache);
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = canvasOf(size);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  context.fillStyle = base;
  context.fillRect(0, 0, size.width, size.height);
  // Spread a little past the edges, so the blur has no hard border to smear inward.
  const { preview } = photo;
  const cover = Math.max(size.width / preview.width, size.height / preview.height) * 1.1;
  const width = preview.width * cover;
  const height = preview.height * cover;
  context.drawImage(preview, (size.width - width) / 2, (size.height - height) / 2, width, height);
  const pixels = context.getImageData(0, 0, size.width, size.height);
  blurPixels(pixels.data, size.width, size.height, 3);
  context.putImageData(pixels, 0, 0);
  context.fillStyle = 'rgba(0, 0, 0, 0.14)';
  context.fillRect(0, 0, size.width, size.height);
  cache.set(key, canvas);
  return canvas;
}

let checkerTile: HTMLCanvasElement | null = null;

/** White under a JPG (it has no transparency); a checkerboard where a PNG stays see-through. */
function paintBackground(context: CanvasRenderingContext2D, rect: Rect, kind: Background) {
  if (!kind) return;
  if (kind === 'checker' && !checkerTile) {
    checkerTile = canvasOf({ width: 16, height: 16 });
    const tile = checkerTile.getContext('2d');
    if (tile) {
      tile.fillStyle = '#ffffff';
      tile.fillRect(0, 0, 16, 16);
      tile.fillStyle = '#dcd8d0';
      tile.fillRect(0, 0, 8, 8);
      tile.fillRect(8, 8, 8, 8);
    }
  }
  const pattern = kind === 'checker' && checkerTile && context.createPattern(checkerTile, 'repeat');
  context.fillStyle = pattern || '#ffffff';
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
}

/** What fills a fitted frame around the photo. Every fill strategy is drawn here. */
function paintBackdrop(
  context: CanvasRenderingContext2D,
  photo: Photo,
  output: Size,
  { backdrop }: Framing,
  dest: Rect,
) {
  switch (backdrop.fill) {
    case 'color':
      context.fillStyle = backdrop.color;
      context.fillRect(dest.x, dest.y, dest.width, dest.height);
      return;
    case 'blur':
      context.drawImage(
        softBackdrop(photo, output, backdrop.color),
        dest.x,
        dest.y,
        dest.width,
        dest.height,
      );
      return;
    default: {
      // A new strategy (AI Expand) has to be drawn here before it can be offered.
      const unknown: never = backdrop.fill;
      throw new Error(`No backdrop for ${String(unknown)}`);
    }
  }
}

/** One frame, drawn into `dest`: exports, gallery previews and Fit in the composer. */
function paintFrame(
  context: CanvasRenderingContext2D,
  photo: Photo,
  output: Size,
  framing: Framing,
  dest: Rect,
  { preview = false, background }: { preview?: boolean; background?: Background },
) {
  const { source, target } = layoutFrame(photo.size, output, framing);
  const image = preview ? photo.preview : photo.image;
  const across = image.width / photo.size.width;
  const down = image.height / photo.size.height;
  const scale = dest.width / output.width;
  context.save();
  context.beginPath();
  context.rect(dest.x, dest.y, dest.width, dest.height);
  context.clip();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  paintBackground(context, dest, background);
  if (framing.mode === 'fit') paintBackdrop(context, photo, output, framing, dest);
  // Clamped to the image: rounding must never ask for a pixel past its edge.
  const x = Math.max(0, source.x * across);
  const y = Math.max(0, source.y * down);
  context.drawImage(
    image,
    x,
    y,
    Math.min(image.width - x, source.width * across),
    Math.min(image.height - y, source.height * down),
    dest.x + target.x * scale,
    dest.y + target.y * scale,
    target.width * scale,
    target.height * scale,
  );
  context.restore();
}

async function renderFrame(photo: Photo, format: FrameFormat, framing: Framing, type: OutputType) {
  const output = outputSize(format, photo.size, framing);
  const canvas = canvasOf(output);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser couldn’t draw the frame.');
    paintFrame(
      context,
      photo,
      output,
      framing,
      { x: 0, y: 0, ...output },
      {
        background: type === 'jpg' ? 'white' : undefined,
      },
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, TYPES[type].mime, 0.9),
    );
    if (!blob)
      throw new Error(
        `Couldn’t save the ${format.name} frame. It may be too big for this browser.`,
      );
    return { blob, name: frameFileName(photo.name, format, output, type) };
  } finally {
    freeCanvas(canvas);
  }
}

/**
 * The frame's place on the stage: centered, with room around it to see what's cropped away, a
 * line above it for the frame's name and one under it for the hint.
 */
function frameIn(stage: Size, output: Size): Rect {
  const pad = Math.round(Math.max(14, Math.min(40, Math.min(stage.width, stage.height) * 0.07)));
  const above = pad + 18;
  const below = pad + 16;
  const inner = fitInside(
    {
      width: Math.max(1, stage.width - pad * 2),
      height: Math.max(1, stage.height - above - below),
    },
    output,
  );
  const width = Math.max(1, Math.round(inner.width));
  const height = Math.max(1, Math.round(inner.height));
  return {
    x: Math.round((stage.width - width) / 2),
    y: Math.round(above + (stage.height - above - below - height) / 2),
    width,
    height,
  };
}

/** Hatched areas where the app draws its own names, captions and buttons (approximate). */
function paintCovered(context: CanvasRenderingContext2D, frame: Rect, format: FrameFormat) {
  context.font = '600 10.5px system-ui, -apple-system, sans-serif';
  for (const area of format.covered ?? []) {
    const rect = {
      x: frame.x + area.x * frame.width,
      y: frame.y + area.y * frame.height,
      width: area.width * frame.width,
      height: area.height * frame.height,
    };
    context.save();
    context.beginPath();
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip();
    context.fillStyle = 'rgba(12, 12, 11, 0.5)';
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    context.lineWidth = 1;
    context.beginPath();
    for (let offset = -rect.height; offset < rect.width; offset += 7) {
      context.moveTo(rect.x + offset, rect.y + rect.height);
      context.lineTo(rect.x + offset + rect.height, rect.y);
    }
    context.stroke();
    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    const text = context.measureText(area.label).width;
    if (text + 12 <= rect.width && rect.height >= 18) {
      context.fillText(area.label, rect.x + 6, rect.y + 14);
    } else if (text + 12 <= rect.height && rect.width >= 16) {
      // A narrow column (the buttons down the side): the label runs up it.
      context.translate(rect.x + rect.width / 2 + 4, rect.y + rect.height - 6);
      context.rotate(-Math.PI / 2);
      context.fillText(area.label, 0, 0);
    }
    context.restore();
  }
}

function paintThirds(context: CanvasRenderingContext2D, frame: Rect) {
  context.strokeStyle = 'rgba(255, 255, 255, 0.42)';
  context.lineWidth = 1;
  context.beginPath();
  for (const part of [1 / 3, 2 / 3]) {
    const x = Math.round(frame.x + frame.width * part) + 0.5;
    const y = Math.round(frame.y + frame.height * part) + 0.5;
    context.moveTo(x, frame.y);
    context.lineTo(x, frame.y + frame.height);
    context.moveTo(frame.x, y);
    context.lineTo(frame.x + frame.width, y);
  }
  context.stroke();
}

type StageView = {
  photo: Photo;
  format: FrameFormat;
  output: Size;
  framing: Framing;
  grid: boolean;
  covered: boolean;
  background: Background;
};

/** Where the frame and the whole photo sit on the stage, in stage pixels. */
type Geometry = { frame: Rect; image: Rect };

function geometryOf(stage: Size, photo: Photo, output: Size, framing: Framing): Geometry {
  const frame = frameIn(stage, output);
  const { source, target, scale } = layoutFrame(photo.size, output, framing);
  if (framing.mode === 'crop') {
    const k = (frame.width / output.width) * scale;
    return {
      frame,
      image: {
        x: frame.x - source.x * k,
        y: frame.y - source.y * k,
        width: photo.size.width * k,
        height: photo.size.height * k,
      },
    };
  }
  const k = frame.width / output.width;
  return {
    frame,
    image: {
      x: frame.x + target.x * k,
      y: frame.y + target.y * k,
      width: target.width * k,
      height: target.height * k,
    },
  };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  width: Math.max(1, mix(a.width, b.width, t)),
  height: Math.max(1, mix(a.height, b.height, t)),
});
const mixGeometry = (a: Geometry, b: Geometry, t: number): Geometry => ({
  frame: mixRect(a.frame, b.frame, t),
  image: mixRect(a.image, b.image, t),
});

/**
 * The composer: the frame, and in Crop the rest of the photo around it, faded into the room, so
 * you can see what you're cutting while you drag. `geometry` is where things are right now, which
 * is somewhere between two frames while the frame reshapes.
 */
function paintStage(canvas: HTMLCanvasElement, stage: Size, view: StageView, geometry: Geometry) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(stage.width * ratio);
  const height = Math.round(stage.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  const styles = getComputedStyle(canvas);
  const room = styles.getPropertyValue('--color-subtle').trim() || '#10100f';
  const accent =
    styles.getPropertyValue('--accent-ink').trim() ||
    styles.getPropertyValue('--accent').trim() ||
    '#9b86ff';
  const { photo, output, framing } = view;
  const { frame, image } = geometry;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, stage.width, stage.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (framing.mode === 'crop') {
    paintBackground(context, frame, view.background);
    context.drawImage(photo.image, image.x, image.y, image.width, image.height);
    context.save();
    context.globalAlpha = 0.64;
    context.fillStyle = room;
    context.beginPath();
    context.rect(0, 0, stage.width, stage.height);
    context.rect(frame.x, frame.y, frame.width, frame.height);
    context.fill('evenodd');
    context.restore();
  } else {
    paintFrame(context, photo, output, framing, frame, { background: view.background });
  }
  if (view.covered) paintCovered(context, frame, view.format);
  if (view.grid) paintThirds(context, frame);
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.lineWidth = 1;
  context.strokeRect(frame.x + 0.5, frame.y + 0.5, frame.width - 1, frame.height - 1);
  // Accent corners, like a crop handle.
  const arm = Math.min(18, frame.width / 4, frame.height / 4);
  context.strokeStyle = accent;
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.beginPath();
  for (const [x, y, dx, dy] of [
    [frame.x - 1.5, frame.y - 1.5, 1, 1],
    [frame.x + frame.width + 1.5, frame.y - 1.5, -1, 1],
    [frame.x - 1.5, frame.y + frame.height + 1.5, 1, -1],
    [frame.x + frame.width + 1.5, frame.y + frame.height + 1.5, -1, -1],
  ]) {
    context.moveTo(x + dx * arm, y);
    context.lineTo(x, y);
    context.lineTo(x, y + dy * arm);
  }
  context.stroke();
}

/** A beach, drawn on this device at a camera's size, so the tool can be tried without a photo. */
async function sampleBeach(): Promise<File> {
  const width = 3600;
  const height = 2400;
  const canvas = canvasOf({ width, height });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  // A seeded wobble, so the sample is the same every time.
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const horizon = height * 0.46;
  const shore = height * 0.66;

  const sky = context.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#4f9fdc');
  sky.addColorStop(0.6, '#9cd0ef');
  sky.addColorStop(1, '#e2f3f7');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizon);
  const glow = context.createRadialGradient(
    width * 0.74,
    height * 0.16,
    0,
    width * 0.74,
    height * 0.16,
    560,
  );
  glow.addColorStop(0, 'rgba(255, 252, 232, 1)');
  glow.addColorStop(0.24, 'rgba(255, 246, 206, 1)');
  glow.addColorStop(0.27, 'rgba(255, 240, 190, 0.55)');
  glow.addColorStop(1, 'rgba(255, 240, 190, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, horizon);
  context.fillStyle = 'rgba(255, 255, 255, 0.72)';
  for (const [x, y, size] of [
    [0.16, 0.13, 1],
    [0.36, 0.08, 0.7],
    [0.5, 0.26, 0.8],
    [0.93, 0.33, 0.6],
  ]) {
    for (let puff = 0; puff < 7; puff += 1) {
      context.beginPath();
      context.ellipse(
        width * x + (random() - 0.5) * 380 * size,
        height * y + (random() - 0.5) * 60 * size,
        (150 + random() * 130) * size,
        (48 + random() * 30) * size,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }

  const sea = context.createLinearGradient(0, horizon, 0, shore);
  sea.addColorStop(0, '#16618f');
  sea.addColorStop(0.55, '#2596b2');
  sea.addColorStop(1, '#63d0cc');
  context.fillStyle = sea;
  context.fillRect(0, horizon, width, shore - horizon + 60);
  for (let glint = 0; glint < 1600; glint += 1) {
    context.fillStyle = `rgba(255, 255, 255, ${0.06 + random() * 0.22})`;
    context.fillRect(
      random() * width,
      horizon + random() ** 1.7 * (shore - horizon),
      18 + random() * 90,
      3 + random() * 3,
    );
  }

  const edge = (x: number) => shore + Math.sin(x / 260) * 26 + Math.sin(x / 97) * 8;
  const sand = context.createLinearGradient(0, shore, 0, height);
  sand.addColorStop(0, '#f1d9aa');
  sand.addColorStop(1, '#d9b57f');
  context.fillStyle = sand;
  context.beginPath();
  context.moveTo(0, height);
  for (let x = 0; x <= width; x += 40) context.lineTo(x, edge(x));
  context.lineTo(width, height);
  context.fill();
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.lineWidth = 16;
  context.beginPath();
  for (let x = 0; x <= width; x += 40) context.lineTo(x, edge(x) - 4);
  context.stroke();
  for (let speck = 0; speck < 30000; speck += 1) {
    context.fillStyle =
      random() > 0.5
        ? `rgba(255, 255, 255, ${0.05 + random() * 0.1})`
        : `rgba(110, 80, 40, ${0.05 + random() * 0.1})`;
    context.fillRect(random() * width, shore + random() * (height - shore), 4 + random() * 7, 3);
  }

  // A towel and an umbrella on the left third.
  context.save();
  context.translate(width * 0.29, height * 0.86);
  context.rotate(-0.08);
  context.fillStyle = '#2d5aa0';
  context.fillRect(-300, -95, 600, 190);
  context.fillStyle = '#f7efe0';
  for (const stripe of [-220, -60, 100]) context.fillRect(stripe, -95, 50, 190);
  context.restore();
  const pole = { x: width * 0.3, top: height * 0.55, bottom: height * 0.88 };
  context.strokeStyle = '#6b5846';
  context.lineWidth = 18;
  context.beginPath();
  context.moveTo(pole.x, pole.top);
  context.lineTo(pole.x - 30, pole.bottom);
  context.stroke();
  context.save();
  context.beginPath();
  context.ellipse(pole.x, pole.top + 40, 380, 190, -0.12, Math.PI, Math.PI * 2);
  context.closePath();
  context.clip();
  for (let stripe = 0; stripe < 8; stripe += 1) {
    context.fillStyle = stripe % 2 ? '#fff4e2' : '#ea5f45';
    context.fillRect(pole.x - 400 + stripe * 100, pole.top - 200, 100, 260);
  }
  context.restore();

  // A palm leaning in from the right.
  context.strokeStyle = '#6a4a31';
  context.lineCap = 'round';
  let x = width * 0.9;
  let y = height * 0.97;
  for (let step = 0; step < 24; step += 1) {
    const nextX = x - 14 - step * 1.6;
    const nextY = y - 70;
    context.lineWidth = 64 - step * 1.6;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(nextX, nextY);
    context.stroke();
    x = nextX;
    y = nextY;
  }
  for (let leaf = 0; leaf < 9; leaf += 1) {
    const angle = -Math.PI * 0.95 + (leaf / 8) * Math.PI * 1.25;
    const length = 520 + random() * 160;
    const tipX = x + Math.cos(angle) * length;
    const tipY = y + Math.sin(angle) * length * 0.55 + 160;
    context.fillStyle = leaf % 2 ? '#2f6b3a' : '#3d8446';
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(
      (x + tipX) / 2 + Math.sin(angle) * 90,
      (y + tipY) / 2 - 140,
      tipX,
      tipY,
    );
    context.quadraticCurveTo((x + tipX) / 2, (y + tipY) / 2 - 40, x, y);
    context.fill();
  }
  context.fillStyle = '#5a3b22';
  for (const [dx, dy] of [
    [-26, 18],
    [16, 26],
    [-4, 44],
  ]) {
    context.beginPath();
    context.arc(x + dx, y + dy, 26, 0, Math.PI * 2);
    context.fill();
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92),
  );
  freeCanvas(canvas);
  if (!blob) throw new Error('No sample');
  return new File([blob], 'sample-beach.jpg', { type: 'image/jpeg' });
}

/* ---------------- the frames ---------------- */

/** The shapes feeds come in, each with the sizes that share it: how the frames are laid out. */
type ShapeGroup = { id: string; name: string; ratio: string; formats: string[] };
const SHAPES: ShapeGroup[] = [
  { id: 'square', name: 'Square', ratio: '1:1', formats: ['instagram-post'] },
  { id: 'portrait', name: 'Portrait', ratio: '4:5', formats: ['instagram-portrait'] },
  { id: 'story', name: 'Story', ratio: '9:16', formats: ['instagram-story', 'tiktok'] },
  {
    id: 'landscape',
    name: 'Landscape',
    ratio: '16:9',
    formats: ['youtube-thumbnail', 'x-post', 'linkedin-post'],
  },
  {
    id: 'banner',
    name: 'Banner',
    ratio: '3:1 – 4:1',
    formats: ['x-header', 'linkedin-banner', 'facebook-cover'],
  },
];

/** Every preset, in the order the shapes are offered (anything unlisted after them). */
const ORDERED: FrameFormat[] = [
  ...SHAPES.flatMap((shape) =>
    shape.formats.map((id) => SOCIAL_FORMATS.find((format) => format.id === id)!),
  ),
  ...SOCIAL_FORMATS.filter((format) => !SHAPES.some((shape) => shape.formats.includes(format.id))),
].filter(Boolean);

const shapeOf = (format: FrameFormat) =>
  SHAPES.find((shape) => shape.formats.includes(format.id)) ?? null;

const networkName = (format: FrameFormat) =>
  format.network === 'custom'
    ? format.label
    : (NETWORKS.find((item) => item.id === format.network)?.name ?? format.label);

/** "Square", "Story", or a custom size's own label. */
const frameName = (format: FrameFormat) => shapeOf(format)?.name ?? format.label;

const backgroundFor = (photo: Photo, type: OutputType): Background =>
  photo.transparent ? (type === 'jpg' ? 'white' : 'checker') : undefined;

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A little spring at the end, like the rest of the studio. */
const spring = (t: number) => {
  const c1 = 1.1;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Prints lean a little, each its own way. */
const TILTS = [-1.6, 1.2, -0.6, 1.7, -1.1, 0.8, -1.8, 1.4];

/* ---------------- the tool ---------------- */

export function SocialCropTool() {
  const toast = useToast();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [opening, setOpening] = useState(false);
  const [view, setView] = useState<'studio' | 'prints'>('studio');
  const [selected, setSelected] = useState<string[]>(DEFAULT_FORMATS);
  const [customs, setCustoms] = useState<FrameFormat[]>([]);
  const [anySize, setAnySize] = useState(false);
  const [framings, setFramings] = useState<Record<string, Framing>>({});
  const [activeId, setActiveId] = useState(DEFAULT_FORMATS[0]);
  const [type, setType] = useState<OutputType>('jpg');
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState('');
  const current = useRef<Photo | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<(files: File[]) => void>(() => {});
  const pickerId = useId();
  const customField = useId();

  const formats = useMemo(() => [...ORDERED, ...customs], [customs]);
  const frames = formats.filter((format) => selected.includes(format.id));
  const active = frames.find((format) => format.id === activeId) ?? frames[0] ?? null;
  const fallback = useMemo(() => newFraming(photo?.colors[0]), [photo]);
  const framingOf = (format: FrameFormat) => framings[format.id] ?? fallback;
  const busy = opening || exporting !== null;
  // Where you are: nothing to frame without a photo, nothing to print without a frame.
  const screen = !photo ? 'start' : view === 'prints' && frames.length ? 'prints' : 'studio';

  // The photo's memory goes back when the tool closes.
  useEffect(() => {
    const holder = current;
    return () => release(holder.current);
  }, []);

  // Each screen starts at its top: on a phone the last one may have been scrolled far down.
  const shown = useRef(screen);
  useEffect(() => {
    if (shown.current === screen) return;
    shown.current = screen;
    const element = root.current;
    if (!element) return;
    // Only when its top has gone up under the header; otherwise it's already where it should be.
    if (element.getBoundingClientRect().top > 56) return;
    element.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' });
  }, [screen]);

  async function load(file: File) {
    setOpening(true);
    setMessage(`Opening ${file.name}…`);
    try {
      const next = await openPhoto(file);
      release(current.current);
      current.current = next;
      setPhoto(next);
      setFramings({});
      setView('studio');
      setMessage('');
    } catch {
      const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      setMessage(
        heic
          ? `Couldn’t open ${file.name}. ${HEIC_NOTE}`
          : `Couldn’t open ${file.name}. Try a JPG, PNG or WebP.`,
      );
    }
    setOpening(false);
  }

  function open(files: File[]) {
    const file = files[0];
    if (!file || busy) return;
    if (!file.type.startsWith('image/') && !READABLE.test(file.name))
      return setMessage(
        `${file.name} isn’t a photo this tool can open. Try a JPG, PNG, WebP, GIF or AVIF.`,
      );
    if (file.size > MAX_BYTES)
      return setMessage(`${file.name} is over 40 MB. Try a smaller copy of it.`);
    void load(file);
  }

  // A photo pasted anywhere on the page (⌘V / Ctrl+V) opens too.
  useLayoutEffect(() => {
    opener.current = open;
  });
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith('image/'),
      );
      if (!file) return;
      event.preventDefault();
      opener.current([file]);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  async function trySample() {
    if (busy) return;
    setOpening(true);
    setMessage('Drawing a sample photo…');
    try {
      await load(await sampleBeach());
    } catch {
      setOpening(false);
      setMessage('Couldn’t draw a sample here. Choose a photo of your own.');
    }
  }

  function clear() {
    release(current.current);
    current.current = null;
    setPhoto(null);
    setFramings({});
    setView('studio');
    setMessage('');
  }

  /** Where the studio goes when the frame on it is left out: its neighbour, same shape first. */
  function moveOff(formatId: string, remaining: FrameFormat[]) {
    if (active?.id !== formatId || !remaining.length) return;
    const shape = shapeOf(active);
    const index = frames.indexOf(active);
    const sibling = remaining.find((format) => shape?.formats.includes(format.id));
    setActiveId((sibling ?? remaining[Math.min(index, remaining.length - 1)]).id);
  }

  function toggle(formatId: string) {
    if (selected.includes(formatId)) {
      setSelected(selected.filter((item) => item !== formatId));
      moveOff(
        formatId,
        frames.filter((format) => format.id !== formatId),
      );
    } else {
      setSelected([...selected, formatId]);
      // A frame just added is the one you'll want to compose.
      setActiveId(formatId);
    }
  }

  function addCustom(format: FrameFormat) {
    if (!customs.some((item) => item.id === format.id)) setCustoms([...customs, format]);
    if (!selected.includes(format.id)) setSelected([...selected, format.id]);
    setActiveId(format.id);
  }

  function removeCustom(formatId: string) {
    setCustoms(customs.filter((item) => item.id !== formatId));
    setSelected(selected.filter((item) => item !== formatId));
    moveOff(
      formatId,
      frames.filter((format) => format.id !== formatId),
    );
  }

  /** "Any size": opens the custom size field and puts the cursor in it. */
  function openCustom() {
    const next = !anySize;
    setAnySize(next);
    if (next) requestAnimationFrame(() => document.getElementById(customField)?.focus());
  }

  function adjust(formatId: string) {
    setActiveId(formatId);
    setView('studio');
  }

  const setFraming = (formatId: string, next: Framing) =>
    setFramings((all) => ({ ...all, [formatId]: next }));

  async function downloadOne(format: FrameFormat) {
    if (!photo || busy) return;
    setExporting({ done: 0, total: 1 });
    try {
      const { blob, name } = await renderFrame(photo, format, framingOf(format), type);
      download(blob, name);
      setMessage(`Downloaded ${name}.`);
      toast({ title: 'Frame downloaded', description: name, icon: 'download' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Couldn’t save that frame.');
    }
    setExporting(null);
  }

  async function downloadAll() {
    if (!photo || busy || !frames.length) return;
    if (frames.length === 1) return downloadOne(frames[0]);
    const list = frames;
    setExporting({ done: 0, total: list.length });
    try {
      const entries: ZipEntry[] = [];
      for (const [index, format] of list.entries()) {
        setExporting({ done: index, total: list.length });
        const { blob, name } = await renderFrame(photo, format, framingOf(format), type);
        entries.push({ name, data: blob });
      }
      const archive = await zip(entries);
      const name = `${slugName(photo.name.replace(/\.[^.]+$/, ''), 'photo')}-social-sizes.zip`;
      download(archive, name);
      setMessage(`Downloaded ${list.length} frames in ${name} (${formatBytes(archive.size)}).`);
      toast({ title: `${list.length} frames downloaded`, description: name, icon: 'download' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Couldn’t make the zip.');
    }
    setExporting(null);
  }

  const soft = photo
    ? frames.filter((format) => {
        const framing = framingOf(format);
        const output = outputSize(format, photo.size, framing);
        return layoutFrame(photo.size, output, framing).scale > SOFT_SCALE;
      })
    : [];
  const index = active ? frames.indexOf(active) : -1;
  const stepBy = (by: number) =>
    frames.length && setActiveId(frames[(index + by + frames.length) % frames.length].id);

  const status = (
    <p role="status" className="min-h-5 text-center text-[13px] text-muted empty:hidden">
      {message}
    </p>
  );

  const tray = photo && (
    <FrameTray
      photo={photo}
      formats={formats}
      customs={customs}
      selected={selected}
      active={active}
      framingOf={framingOf}
      type={type}
      anySize={anySize}
      onPick={setActiveId}
      onAdd={toggle}
      onAnySize={openCustom}
    />
  );
  const anySizePanel = anySize && (
    <div className="fx-rise rounded-[20px] bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <CustomSizes
        inputId={customField}
        customs={customs}
        selected={selected}
        onToggle={toggle}
        onAdd={addCustom}
        onRemove={removeCustom}
      />
    </div>
  );
  const photoBar = photo && (
    <PhotoBar photo={photo} busy={busy} onReplace={open} onRemove={clear} />
  );

  return (
    <div ref={root} data-social-crop className="grid min-w-0 scroll-mt-20 gap-4">
      <input
        id={pickerId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          open(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />

      {screen === 'start' && (
        <PhotoDrop
          pickerId={pickerId}
          onFiles={open}
          busy={busy}
          opening={opening}
          onSample={trySample}
        >
          {status}
        </PhotoDrop>
      )}

      {screen === 'studio' && photo && active && (
        <section aria-label="Frame it" className="mx-auto w-full max-w-[1180px] animate-rise">
          <Composer
            photo={photo}
            format={active}
            framing={framingOf(active)}
            type={type}
            position={{ index, total: frames.length, step: stepBy }}
            onChange={(next) => setFraming(active.id, next)}
            onLeave={() => toggle(active.id)}
            onFeed={toggle}
            selected={selected}
            formats={formats}
            tray={
              <>
                {tray}
                {anySizePanel}
              </>
            }
            aside={photoBar}
          >
            {status}
            <ActionBar className="!mt-0 lg:mt-auto">
              <ActionButton icon="check" onClick={() => setView('prints')}>
                {frames.length > 1 ? `See all ${frames.length} frames` : 'Looks good'}
              </ActionButton>
            </ActionBar>
          </Composer>
        </section>
      )}

      {screen === 'studio' && photo && !active && (
        <section
          aria-label="Frame it"
          className="mx-auto grid w-full max-w-[1180px] animate-rise gap-4"
        >
          {photoBar}
          <div className="grid h-[min(40vh,360px)] place-items-center rounded-[24px] bg-subtle text-center shadow-[inset_0_0_0_1px_var(--color-line)]">
            <p className="font-display text-[24px] font-bold tracking-[-0.02em] text-ink">
              Pick a frame
            </p>
          </div>
          {tray}
          {anySizePanel}
          {status}
        </section>
      )}

      {screen === 'prints' && photo && (
        <div className="mx-auto grid w-full max-w-[1100px] gap-4">
          <Payoff
            headline={
              <>
                <Icon name="check" size={16} strokeWidth={3} />
                {frames.length === 1 ? 'Your frame is ready' : `${frames.length} frames, ready`}
              </>
            }
            action={{
              label: exporting
                ? `Preparing ${Math.min(exporting.done + 1, exporting.total)} of ${exporting.total}…`
                : frames.length > 1
                  ? `Download all ${frames.length}`
                  : 'Download',
              icon: exporting ? 'loader' : 'download',
              onClick: () => void downloadAll(),
            }}
            secondary={
              <PillButton icon="crop" onClick={() => setView('studio')}>
                Keep framing
              </PillButton>
            }
            onReset={clear}
            resetLabel="New photo"
            className="bg-[color-mix(in_oklab,var(--color-surface)_88%,var(--accent)_6%)]"
          >
            <ul
              aria-label="Your frames"
              className="flex flex-wrap items-end justify-center gap-x-4 gap-y-7 sm:gap-x-8"
            >
              {frames.map((format, order) => (
                <Print
                  key={format.id}
                  order={order}
                  photo={photo}
                  format={format}
                  framing={framingOf(format)}
                  type={type}
                  busy={busy}
                  onAdjust={() => adjust(format.id)}
                  onDownload={() => downloadOne(format)}
                />
              ))}
            </ul>
          </Payoff>
          {soft.length > 0 && (
            <Note tone="caution" icon="alert">
              {soft.length === 1 ? 'One frame' : `${soft.length} frames`} will look soft: your photo
              has fewer pixels than {soft.length === 1 ? 'it needs' : 'they need'} (
              {soft.map((format) => format.name).join(', ')}).{' '}
              {soft.some(
                (format) => framingOf(format).zoom > 1.01 && framingOf(format).mode === 'crop',
              )
                ? 'Zoom out, or use a bigger photo.'
                : 'A bigger photo would be sharper.'}
            </Note>
          )}
          <Advanced summary={`${TYPES[type].label}${frames.length > 1 ? ' · one zip' : ''}`}>
            <div className="grid gap-2">
              <p className="text-[13px] font-medium text-ink-2">File type</p>
              <Choices
                label="File type"
                value={type}
                onChange={setType}
                options={[
                  { value: 'jpg', label: 'JPG' },
                  { value: 'png', label: 'PNG' },
                ]}
              />
              <p className="text-[12.5px] text-muted">
                JPG files are smaller. PNG keeps see-through parts.
              </p>
            </div>
          </Advanced>
          {status}
        </div>
      )}
    </div>
  );
}

/* ---------------- parts ---------------- */

/** Files dragged anywhere over the page light the frame up; a drop anywhere counts. */
function usePageDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onFiles);
  useLayoutEffect(() => {
    latest.current = onFiles;
  });
  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const carries = (event: globalThis.DragEvent) =>
      Boolean(event.dataTransfer?.types.includes('Files'));
    const enter = (event: globalThis.DragEvent) => {
      if (!carries(event)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (event: globalThis.DragEvent) => {
      if (carries(event)) event.preventDefault();
    };
    const drop = (event: globalThis.DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      latest.current(Array.from(event.dataTransfer.files).slice(0, 1));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [enabled]);
  return enabled && dragging;
}

/** The frames a photo becomes, drawn as crop guides: what's about to happen, at a glance. */
function FrameGuides({ lit }: { lit: boolean }) {
  // [width, height, color], centered on the opening.
  const frames: [number, number, string][] = [
    [300, 169, 'var(--third, #9fc2ff)'],
    [160, 160, 'var(--accent, #9b86ff)'],
    [144, 180, 'var(--glow, #ff9fcf)'],
    [113, 200, 'var(--accent-ink, #5a40d8)'],
  ];
  return (
    <svg
      viewBox="0 0 400 250"
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 size-full transition-transform duration-300',
        lit && 'scale-[1.04]',
      )}
    >
      {frames.map(([width, height, color], order) => (
        <rect
          key={order}
          x={200 - width / 2}
          y={125 - height / 2}
          width={width}
          height={height}
          rx="8"
          fill={color}
          fillOpacity="0.06"
          stroke={color}
          strokeOpacity="0.55"
          strokeWidth="1.5"
          className="fx-pop"
          style={{ animationDelay: `${order * 60}ms` }}
        />
      ))}
    </svg>
  );
}

/** The way in: a white mat with the frames the photo will become drawn in its opening. */
function PhotoDrop({
  pickerId,
  onFiles,
  busy,
  opening,
  onSample,
  children,
}: {
  pickerId: string;
  onFiles: (files: File[]) => void;
  busy: boolean;
  opening: boolean;
  onSample: () => void;
  children?: ReactNode;
}) {
  const dragging = usePageDrop(onFiles, !busy);
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
      <div
        className={cn(
          'fx-move relative w-full rounded-[30px] bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0/.05),0_28px_60px_-34px_rgb(40_20_110/.45),inset_0_0_0_1px_var(--color-line)] sm:p-4',
          dragging
            ? 'scale-[1.015] -rotate-[.4deg] shadow-[0_0_0_6px_color-mix(in_srgb,var(--accent)_40%,transparent),0_30px_60px_-30px_rgb(40_20_110/.45)]'
            : 'hover:-translate-y-0.5',
        )}
      >
        <label
          htmlFor={pickerId}
          aria-hidden="true"
          className={cn('absolute inset-0 z-10 rounded-[30px]', !busy && 'cursor-pointer')}
        />
        <div className="relative flex aspect-[4/5] flex-col items-center justify-center overflow-hidden rounded-[20px] bg-[color-mix(in_oklab,var(--color-surface)_62%,var(--accent)_12%)] px-5 text-center min-[420px]:aspect-[4/3] sm:aspect-[16/10]">
          <FrameGuides lit={dragging} />
          <p className="relative font-display text-[30px] leading-[1] font-bold tracking-[-0.035em] text-ink sm:text-[40px]">
            {dragging ? (
              'Let go to add'
            ) : (
              <>
                <span className="sm:hidden">Frame a photo</span>
                <span className="hidden sm:inline">Drop a photo</span>
              </>
            )}
          </p>
          <label
            htmlFor={pickerId}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              document.getElementById(pickerId)?.click();
            }}
            aria-disabled={busy || undefined}
            className={cn(
              'relative z-20 mt-5 inline-flex h-14 cursor-pointer items-center gap-2 rounded-full px-7 text-[16.5px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-14px_var(--accent)] transition-transform outline-offset-4 active:scale-[.97]',
              busy && 'pointer-events-none opacity-60',
            )}
            style={{ background: 'var(--accent)' }}
          >
            <Icon
              name={opening ? 'loader' : 'camera'}
              size={19}
              className={cn(opening && 'animate-spin')}
            />
            {opening ? 'Opening…' : 'Choose a photo'}
          </label>
        </div>
      </div>
      <SampleButton
        onClick={onSample}
        disabled={busy}
        className="mt-3 !text-[var(--accent-ink,var(--color-ink))]"
      >
        Try a sample photo
      </SampleButton>
      <div className="max-w-[520px]">{children}</div>
    </div>
  );
}

/** One frame, drawn small from the preview copy: the tray and the prints. */
function FramePreview({
  photo,
  format,
  framing,
  box,
  background,
  className,
}: {
  photo: Photo;
  format: FrameFormat;
  framing: Framing;
  box: Size;
  background: Background;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = outputSize(format, photo.size, framing);
  const shown = fitInside(box, { width, height });
  const cssWidth = Math.max(1, Math.round(shown.width));
  const cssHeight = Math.max(1, Math.round(shown.height));

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    context.clearRect(0, 0, element.width, element.height);
    paintFrame(
      context,
      photo,
      { width, height },
      framing,
      { x: 0, y: 0, width: element.width, height: element.height },
      { preview: true, background },
    );
  }, [photo, framing, width, height, background, cssWidth, cssHeight]);

  // Shrinks with a narrow card, keeping its shape.
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      width={cssWidth * 2}
      height={cssHeight * 2}
      style={{ width: cssWidth }}
      className={cn('block h-auto max-w-full', className)}
    />
  );
}

function PhotoBar({
  photo,
  busy,
  onReplace,
  onRemove,
}: {
  photo: Photo;
  busy: boolean;
  onReplace: (files: File[]) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const thumb = useRef<HTMLCanvasElement>(null);
  const scaled = photo.size.width !== photo.original.width;

  useEffect(() => {
    const element = thumb.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const { preview } = photo;
    const cover = Math.max(element.width / preview.width, element.height / preview.height);
    const width = preview.width * cover;
    const height = preview.height * cover;
    context.clearRect(0, 0, element.width, element.height);
    context.drawImage(
      preview,
      (element.width - width) / 2,
      (element.height - height) / 2,
      width,
      height,
    );
  }, [photo]);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <canvas
        ref={thumb}
        width={88}
        height={88}
        aria-hidden="true"
        className="size-11 shrink-0 rounded-[12px] bg-well shadow-[inset_0_0_0_1px_var(--color-line)]"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{photo.name}</p>
        <p className="mono-num truncate text-[11.5px] text-muted">
          {sizeLabel(photo.original)}
          {scaled && ` · edited at ${sizeLabel(photo.size)}`}
          {photo.gif && ' · first frame of the GIF'}
        </p>
      </div>
      <input
        id={`${id}-replace`}
        type="file"
        accept={ACCEPT}
        disabled={busy}
        className="peer sr-only"
        onChange={(event) => {
          onReplace(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <label
        htmlFor={`${id}-replace`}
        className={cn(
          'inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-ink/[.06] px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal hover:bg-ink/10 hover:text-ink lg:h-9',
          busy && 'pointer-events-none opacity-45',
        )}
      >
        <Icon name="replace" size={15} /> Replace
      </label>
      <IconButton icon="x" label="Remove the photo" onClick={onRemove} disabled={busy} />
    </div>
  );
}

/**
 * The frames, under the photo: the ones you're making, each with your photo already in it, and a
 * dashed outline for each shape you aren't. Tap one to frame it.
 */
function FrameTray({
  photo,
  formats,
  customs,
  selected,
  active,
  framingOf,
  type,
  anySize,
  onPick,
  onAdd,
  onAnySize,
}: {
  photo: Photo;
  formats: FrameFormat[];
  customs: FrameFormat[];
  selected: string[];
  active: FrameFormat | null;
  framingOf: (format: FrameFormat) => Framing;
  type: OutputType;
  anySize: boolean;
  onPick: (formatId: string) => void;
  onAdd: (formatId: string) => void;
  onAnySize: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  // The frame being edited stays in view as you move between them.
  useEffect(() => {
    const item = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!item || !list.current || list.current.scrollWidth <= list.current.clientWidth) return;
    item.scrollIntoView({
      behavior: still() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [active?.id]);

  const box = { width: 54, height: 54 };
  const slots: ReactNode[] = [];
  for (const shape of SHAPES) {
    const on = formats.filter(
      (format) => shape.formats.includes(format.id) && selected.includes(format.id),
    );
    if (!on.length) {
      const lead = formats.find((format) => format.id === shape.formats[0]);
      if (!lead) continue;
      const outline = fitInside(box, lead);
      slots.push(
        <li key={shape.id} className="shrink-0">
          <button
            type="button"
            aria-label={`Add ${shape.name}, ${shape.ratio}`}
            title={`${shape.name} · ${shape.ratio}`}
            onClick={() => onAdd(lead.id)}
            className="fx-move grid w-[78px] justify-items-center gap-1.5 rounded-[16px] p-1.5 pb-1 text-muted hover:bg-ink/[.05] hover:text-ink active:scale-95"
          >
            <span className="flex h-[58px] items-center justify-center">
              <span
                className="grid place-items-center rounded-[4px] border-[1.5px] border-dashed border-current opacity-70"
                style={{ width: outline.width, height: outline.height }}
              >
                <Icon name="plus" size={14} />
              </span>
            </span>
            <span className="text-[12px] font-medium">{shape.name}</span>
          </button>
        </li>,
      );
      continue;
    }
    for (const format of on) slots.push(frameSlot(format, shape.formats.length > 1));
  }
  for (const format of customs)
    if (selected.includes(format.id)) slots.push(frameSlot(format, false));

  function frameSlot(format: FrameFormat, showNetwork: boolean) {
    const here = format.id === active?.id;
    return (
      <li key={format.id} className="shrink-0">
        <button
          type="button"
          aria-current={here}
          aria-label={`Frame ${format.name}`}
          title={`${format.name} · ${ratioLabel(format.width, format.height)}`}
          onClick={() => onPick(format.id)}
          className={cn(
            'fx-move grid w-[78px] justify-items-center gap-1.5 rounded-[16px] p-1.5 pb-1 active:scale-95',
            here
              ? 'bg-surface shadow-[0_0_0_2px_var(--accent-ink,var(--color-ink)),0_12px_24px_-14px_var(--accent)]'
              : 'hover:bg-ink/[.05]',
          )}
        >
          <span className="relative flex h-[58px] items-center justify-center">
            <FramePreview
              photo={photo}
              format={format}
              framing={framingOf(format)}
              box={box}
              background={backgroundFor(photo, type)}
              className={cn(
                'rounded-[3px] shadow-[0_0_0_1.5px_white,0_4px_10px_-4px_rgb(30_20_70/.45)]',
                here ? '' : 'opacity-80',
              )}
            />
            {showNetwork && format.network !== 'custom' && (
              <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-surface text-ink-2 shadow-[0_1px_3px_rgb(30_20_70/.3)]">
                <Icon name={NETWORK_ICONS[format.network]} size={11} />
              </span>
            )}
          </span>
          <span
            className={cn(
              'flex max-w-full min-w-0 items-center gap-1 text-[12px] font-medium',
              here ? 'text-ink' : 'text-ink-2',
            )}
          >
            <span className="truncate">{frameName(format)}</span>
          </span>
        </button>
      </li>
    );
  }

  return (
    <ul
      ref={list}
      aria-label="Frames"
      className="scroller -mx-1 flex gap-1 overflow-x-auto px-1 py-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:gap-1.5 sm:overflow-visible sm:px-0"
    >
      {slots}
      <li className="shrink-0">
        <button
          type="button"
          aria-expanded={anySize}
          onClick={onAnySize}
          className={cn(
            'fx-move grid w-[78px] justify-items-center gap-1.5 rounded-[16px] p-1.5 pb-1 active:scale-95',
            anySize ? 'bg-ink/[.07] text-ink' : 'text-muted hover:bg-ink/[.05] hover:text-ink',
          )}
        >
          <span className="flex h-[58px] items-center justify-center">
            <span className="grid size-10 place-items-center rounded-full bg-ink/[.06]">
              <Icon name={anySize ? 'x' : 'crop'} size={16} />
            </span>
          </span>
          <span className="text-[12px] font-medium whitespace-nowrap">Any size</span>
        </button>
      </li>
    </ul>
  );
}

function FeedPill({
  format,
  on,
  onToggle,
}: {
  format: FrameFormat;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${format.name}, ${format.ratio ? `${format.label} shape` : sizeLabel(format)}`}
      title={`${format.name} · ${format.ratio ? format.label : sizeLabel(format)}`}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[13px] font-medium transition-[background-color,color,transform] active:scale-[.96] lg:min-h-9',
        on
          ? 'text-[var(--on-accent,#12110d)]'
          : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10 hover:text-ink',
      )}
      style={on ? { background: 'var(--accent, var(--color-ink))' } : undefined}
    >
      <Icon name={on ? 'check' : NETWORK_ICONS[format.network]} size={14} className="shrink-0" />
      <span className="truncate">{networkName(format)}</span>
    </button>
  );
}

function CustomSizes({
  inputId,
  customs,
  selected,
  onToggle,
  onAdd,
  onRemove,
}: {
  inputId: string;
  customs: FrameFormat[];
  selected: string[];
  onToggle: (formatId: string) => void;
  onAdd: (format: FrameFormat) => void;
  onRemove: (formatId: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = parseCustom(text);
    if ('error' in result) return setError(result.error);
    const known = customs.some((item) => item.id === result.format.id);
    if (!known && customs.length >= MAX_CUSTOM)
      return setError(`Up to ${MAX_CUSTOM} custom sizes. Remove one to add another.`);
    onAdd(result.format);
    setText('');
    setError('');
  };

  return (
    <div className="grid gap-2">
      <form onSubmit={submit} className="flex gap-2">
        <input
          id={inputId}
          aria-label="A custom shape or size"
          aria-describedby={`${id}-custom-hint`}
          aria-invalid={error ? true : undefined}
          placeholder="3:2 or 1200x628"
          value={text}
          maxLength={24}
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value);
            setError('');
          }}
          className="h-11 min-w-0 flex-1 rounded-[12px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--accent-ink,var(--color-signal))] lg:h-10 lg:text-[14px]"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="inline-flex h-11 items-center gap-1.5 rounded-[12px] bg-ink/[.06] px-3.5 text-[14px] font-medium text-ink transition-colors hover:bg-ink/10 disabled:opacity-40 lg:h-10 lg:text-[13.5px]"
        >
          <Icon name="plus" size={15} /> Add
        </button>
      </form>
      <p
        id={`${id}-custom-hint`}
        className={cn('text-[12.5px]', error ? 'text-critical' : 'text-muted')}
      >
        {error ||
          'A shape (3:2) keeps your photo’s own sharpness; a size (1200x628) comes out exactly that big.'}
      </p>
      {customs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customs.map((format) => (
            <span key={format.id} className="inline-flex items-center gap-0.5">
              <SizeChip
                format={format}
                on={selected.includes(format.id)}
                onToggle={() => onToggle(format.id)}
              />
              <IconButton
                icon="x"
                label={`Remove ${format.label}`}
                onClick={() => onRemove(format.id)}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function Composer({
  photo,
  format,
  framing,
  type,
  position,
  onChange,
  onLeave,
  onFeed,
  selected,
  formats,
  tray,
  aside,
  children,
}: {
  photo: Photo;
  format: FrameFormat;
  framing: Framing;
  type: OutputType;
  position: { index: number; total: number; step: (by: number) => void };
  onChange: (framing: Framing) => void;
  /** Leaves this frame out of the set. */
  onLeave: () => void;
  /** Adds or removes a feed of the same shape. */
  onFeed: (formatId: string) => void;
  selected: string[];
  formats: FrameFormat[];
  /** The frames, under the photo. */
  tray?: ReactNode;
  /** Above the controls: the photo itself, to replace or remove. */
  aside?: ReactNode;
  /** The next action, under the controls. */
  children?: ReactNode;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Size | null>(null);
  const [dragging, setDragging] = useState(false);
  const [covered, setCovered] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Framing; points: Map<number, Point> } | null>(null);
  const latest = useRef({ photo, format, framing, onChange });
  /** What's on the stage now, and which frame it belongs to: switching frames moves from it. */
  const painted = useRef<{ id: string; geometry: Geometry } | null>(null);

  const output = outputSize(format, photo.size, framing);
  const { width: outputWidth, height: outputHeight } = output;
  const layout = layoutFrame(photo.size, output, framing);
  const range = ZOOM[framing.mode];
  const fit = framing.mode === 'fit';
  const showCovered = covered && Boolean(format.covered);
  const background = backgroundFor(photo, type);
  const shape = shapeOf(format);
  const siblings = shape ? formats.filter((item) => shape.formats.includes(item.id)) : [];

  useLayoutEffect(() => {
    latest.current = { photo, format, framing, onChange };
  });

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !stage) return;
    const size = { width: outputWidth, height: outputHeight };
    const view: StageView = {
      photo,
      format,
      output: size,
      framing,
      grid: dragging,
      covered: showCovered,
      background,
    };
    const target = geometryOf(stage, photo, size, framing);
    const before = painted.current;
    // Another frame: the frame reshapes around the photo and the photo slides to its new place.
    if (!before || before.id === format.id || still()) {
      paintStage(element, stage, view, target);
      painted.current = { id: format.id, geometry: target };
      return;
    }
    const from = before.geometry;
    let begin = -1;
    let frame = 0;
    const tick = (now: number) => {
      if (begin < 0) begin = now;
      const t = Math.min(1, (now - begin) / 260);
      const geometry = mixGeometry(from, target, spring(t));
      paintStage(element, stage, view, geometry);
      painted.current = { id: t < 1 ? before.id : format.id, geometry };
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stage, photo, format, outputWidth, outputHeight, framing, dragging, showCovered, background]);

  // Ctrl/⌘ + scroll (and a trackpad pinch) zooms where the pointer is; plain scrolling scrolls.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const now = latest.current;
      const size = outputSize(now.format, now.photo.size, now.framing);
      const rect = element.getBoundingClientRect();
      const frame = frameIn({ width: rect.width, height: rect.height }, size);
      const anchor = {
        x: clamp01((event.clientX - rect.left - frame.x) / frame.width),
        y: clamp01((event.clientY - rect.top - frame.y) / frame.height),
      };
      // A trackpad pinch sends many small steps; a mouse wheel, a few big ones.
      const speed = Math.abs(event.deltaY) < 40 ? 0.01 : 0.0025;
      const zoom = now.framing.zoom * Math.exp(-event.deltaY * speed);
      now.onChange(zoomAt(now.photo.size, size, now.framing, zoom, anchor));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  /** Screen pixels → output pixels, for drags. */
  const frame = stage ? frameIn(stage, output) : null;
  const perPixel = frame ? output.width / frame.width : 1;

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    try {
      // Keeps the drag going when the pointer leaves the stage.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser has already let go of: the drag still works inside the stage.
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = { start: framing, points: new Map(pointers.current) };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const ongoing = gesture.current;
    if (!ongoing || !frame || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const { start, points } = ongoing;
    const ids = [...points.keys()].filter((key) => pointers.current.has(key));
    if (ids.length >= 2) {
      // Two fingers: zoom by how far apart they've moved, around where they started, and pan
      // with their midpoint.
      const [a0, b0] = [points.get(ids[0])!, points.get(ids[1])!];
      const [a, b] = [pointers.current.get(ids[0])!, pointers.current.get(ids[1])!];
      const rect = event.currentTarget.getBoundingClientRect();
      const from = midpoint(a0, b0);
      const to = midpoint(a, b);
      const anchor = {
        x: clamp01((from.x - rect.left - frame.x) / frame.width),
        y: clamp01((from.y - rect.top - frame.y) / frame.height),
      };
      const zoom = (start.zoom * distance(a, b)) / Math.max(1, distance(a0, b0));
      const zoomed = zoomAt(photo.size, output, start, zoom, anchor);
      onChange(
        panBy(photo.size, output, zoomed, (to.x - from.x) * perPixel, (to.y - from.y) * perPixel),
      );
    } else if (ids.length === 1) {
      const from = points.get(ids[0])!;
      const to = pointers.current.get(ids[0])!;
      onChange(
        panBy(photo.size, output, start, (to.x - from.x) * perPixel, (to.y - from.y) * perPixel),
      );
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size) {
      // A finger lifted mid-pinch: carry on from here with the one that's left.
      gesture.current = { start: framing, points: new Map(pointers.current) };
    } else {
      gesture.current = null;
      setDragging(false);
    }
  };

  const zoomTo = (zoom: number) => onChange(zoomAt(photo.size, output, framing, zoom));
  const reset = () => onChange({ ...framing, x: 0.5, y: 0.5, zoom: 1 });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nudge = event.shiftKey ? 0.1 : 0.02;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const arrow = arrows[event.key];
    if (arrow)
      onChange(
        panBy(
          photo.size,
          output,
          framing,
          arrow[0] * nudge * output.width,
          arrow[1] * nudge * output.height,
        ),
      );
    else if (event.key === '+' || event.key === '=') zoomTo(framing.zoom * 1.1);
    else if (event.key === '-' || event.key === '_') zoomTo(framing.zoom / 1.1);
    else if (event.key === '0') reset();
    else return;
    event.preventDefault();
  };

  const swatches = [...new Set([...photo.colors, '#FFFFFF', '#000000'])];
  const setBackdrop = (patch: Partial<Framing['backdrop']>) =>
    onChange({ ...framing, backdrop: { ...framing.backdrop, ...patch } });
  const network = NETWORKS.find((item) => item.id === format.network)?.name ?? '';
  const soft = layout.scale > SOFT_SCALE;
  const moved = framing.x !== 0.5 || framing.y !== 0.5 || framing.zoom !== 1;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_330px] lg:gap-7">
      <div className="grid min-w-0 content-start gap-3">
        <div
          ref={box}
          className="relative -mx-2 h-[min(54vh,500px)] overflow-hidden rounded-[26px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] sm:mx-0 lg:h-[clamp(400px,calc(100vh_-_320px),640px)]"
        >
          <div
            role="application"
            aria-roledescription="frame composer"
            aria-label={`${format.name}, ${output.width} by ${output.height}`}
            aria-describedby={`${id}-how`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="absolute inset-0 rounded-[26px] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ink,var(--color-signal))]"
          >
            <canvas
              ref={canvas}
              aria-hidden="true"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              className={cn(
                'absolute inset-0 size-full touch-none select-none',
                dragging ? 'cursor-grabbing' : 'cursor-grab',
              )}
            />
          </div>
          <p className="pointer-events-none absolute inset-x-0 top-2.5 flex justify-center px-3">
            <span
              key={format.id}
              className="fx-pop flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-surface/90 px-3 py-1 text-[12.5px] font-semibold text-ink shadow-[0_4px_14px_-6px_rgb(30_20_70/.35)]"
            >
              <Icon name={NETWORK_ICONS[format.network]} size={13} className="shrink-0" />
              <span className="truncate">{format.name}</span>
              <span className="mono-num shrink-0 font-normal text-muted">
                {ratioLabel(format.width, format.height)}
              </span>
            </span>
          </p>
          <p
            id={`${id}-how`}
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-2.5 flex items-center justify-center gap-1.5 text-[12px] font-medium text-ink-2 transition-opacity duration-300',
              dragging || moved ? 'opacity-0' : 'opacity-85',
            )}
          >
            <Icon name="move" size={13} />
            Drag the photo · pinch to zoom
            <span className="sr-only">. Arrow keys move it, plus and minus zoom, 0 resets.</span>
          </p>
        </div>
        {tray}
      </div>

      <div className="grid min-w-0 content-start gap-4">
        {aside}
        <div className="flex items-center gap-1 border-t border-line pt-4 lg:border-0 lg:pt-0">
          <IconButton
            icon="chevron-left"
            label="Previous frame"
            onClick={() => position.step(-1)}
            disabled={position.total < 2}
          />
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate font-display text-[20px] leading-tight font-bold tracking-[-0.02em] text-ink">
              {frameName(format)}
            </p>
            <p className="mono-num truncate text-[11.5px] text-muted">
              {position.total > 1 && `${position.index + 1} of ${position.total} · `}
              {sizeLabel(output)}
            </p>
          </div>
          <IconButton
            icon="chevron-right"
            label="Next frame"
            onClick={() => position.step(1)}
            disabled={position.total < 2}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1.5 lg:justify-start">
          {siblings.length > 1
            ? siblings.map((item) => (
                <FeedPill
                  key={item.id}
                  format={item}
                  on={selected.includes(item.id)}
                  onToggle={() => onFeed(item.id)}
                />
              ))
            : null}
          <button
            type="button"
            onClick={onLeave}
            aria-label={`Leave out ${format.name}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted transition-colors hover:bg-ink/[.06] hover:text-ink lg:min-h-9"
          >
            <Icon name="eye-off" size={14} /> Leave out
          </button>
        </div>

        <Choices
          label="How the photo fills the frame"
          value={framing.mode}
          onChange={(mode) => onChange(withMode(framing, mode))}
          className="!flex-nowrap [&>button]:flex-1 [&>button]:justify-center"
          options={[
            { value: 'crop', label: 'Fill the frame', icon: 'crop' },
            { value: 'fit', label: 'Show it all', icon: 'frame' },
          ]}
        />

        <div className="flex items-center gap-1">
          <IconButton
            icon="zoom-out"
            label={fit ? 'Smaller' : 'Zoom out'}
            onClick={() => zoomTo(framing.zoom / 1.15)}
            disabled={framing.zoom <= range.min}
          />
          <input
            type="range"
            aria-label={fit ? 'Photo size' : 'Zoom'}
            aria-valuetext={`${Math.round(framing.zoom * 100)}%`}
            min={range.min}
            max={range.max}
            step={0.01}
            value={framing.zoom}
            onChange={(event) => zoomTo(Number(event.target.value))}
            className="h-11 min-w-0 flex-1 accent-[var(--accent-ink,var(--color-ink))]"
          />
          <IconButton
            icon="zoom-in"
            label={fit ? 'Bigger' : 'Zoom in'}
            onClick={() => zoomTo(framing.zoom * 1.15)}
            disabled={framing.zoom >= range.max}
          />
          <button
            type="button"
            onClick={reset}
            disabled={!moved}
            aria-label="Center it again"
            title="Center it again"
            className="ml-1 inline-flex h-10 items-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink disabled:opacity-35 lg:h-9"
          >
            <Icon name="restore" size={15} /> Reset
          </button>
        </div>

        {fit && (
          <div
            role="radiogroup"
            aria-label="Around the photo"
            className="flex animate-fade flex-wrap items-center gap-2"
          >
            <span className="mr-1 text-[13.5px] font-medium text-ink-2">Around it</span>
            <button
              type="button"
              role="radio"
              aria-checked={framing.backdrop.fill === 'blur'}
              onClick={() => setBackdrop({ fill: 'blur' })}
              className={cn(
                'h-10 rounded-full px-3.5 text-[13px] font-medium transition-colors lg:h-9',
                framing.backdrop.fill === 'blur'
                  ? 'bg-ink text-on-ink'
                  : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10',
              )}
            >
              Soft blur
            </button>
            {swatches.map((color) => {
              const on = framing.backdrop.fill === 'color' && framing.backdrop.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`Solid ${color}`}
                  title={color}
                  onClick={() => setBackdrop({ fill: 'color', color })}
                  style={{ background: color }}
                  className={cn(
                    'size-10 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.18)] transition-transform hover:scale-105 lg:size-9',
                    on && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
                  )}
                />
              );
            })}
            <label
              className="relative grid size-10 place-items-center rounded-full bg-ink/[.06] text-ink-2 hover:bg-ink/10 lg:size-9"
              title="Any color"
            >
              <Icon name="pipette" size={15} />
              <input
                type="color"
                aria-label="Any color"
                value={framing.backdrop.color.toLowerCase()}
                onChange={(event) =>
                  setBackdrop({ fill: 'color', color: event.target.value.toUpperCase() })
                }
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        )}

        {format.covered && (
          <div className="grid gap-1.5">
            <button
              type="button"
              aria-pressed={covered}
              onClick={() => setCovered(!covered)}
              className={cn(
                'inline-flex h-11 items-center gap-2 justify-self-start rounded-full px-3.5 text-[13.5px] font-medium transition-colors lg:h-9',
                covered ? 'bg-ink text-on-ink' : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10',
              )}
            >
              <Icon name={covered ? 'eye' : 'eye-off'} size={15} />
              Show what {network} covers
            </button>
            {covered && (
              <p className="text-[12.5px] text-muted">Keep faces and words in the clear middle.</p>
            )}
          </div>
        )}

        {soft && (
          <Note tone="caution" icon="alert">
            {fit
              ? `Your photo is ${sizeLabel(photo.size)}, so here it’s enlarged ${layout.scale.toFixed(1)}× and will look soft.`
              : `This frame is ${sizeLabel(output)} but gets ${Math.round(layout.source.width)}×${Math.round(layout.source.height)} px of your photo, so it’s enlarged ${layout.scale.toFixed(1)}× and will look soft.`}{' '}
            {!fit && framing.zoom > 1.01
              ? 'Zoom out, or use a bigger photo.'
              : 'A bigger photo would be sharper.'}
          </Note>
        )}

        {children}
      </div>
    </div>
  );
}

/** A finished frame, as a print: tap it to reframe, or save just this one. */
function Print({
  order,
  photo,
  format,
  framing,
  type,
  busy,
  onAdjust,
  onDownload,
}: {
  order: number;
  photo: Photo;
  format: FrameFormat;
  framing: Framing;
  type: OutputType;
  busy: boolean;
  onAdjust: () => void;
  onDownload: () => void;
}) {
  const output = outputSize(format, photo.size, framing);
  const soft = layoutFrame(photo.size, output, framing).scale > SOFT_SCALE;
  const tilt = TILTS[order % TILTS.length];
  return (
    <li
      className="fx-stamp flex max-w-[calc(50%-8px)] min-w-0 flex-col items-center sm:max-w-none"
      style={{ animationDelay: `${120 + order * 80}ms` }}
    >
      <button
        type="button"
        onClick={onAdjust}
        aria-label={`Adjust ${format.name}, ${output.width} by ${output.height}${soft ? ', will look soft' : ''}`}
        className="fx-move relative block max-w-full rounded-[3px] bg-white p-1.5 shadow-[0_1px_2px_rgb(0_0_0/.08),0_18px_34px_-18px_rgb(40_20_110/.5)] hover:!rotate-0 hover:-translate-y-1 sm:p-2.5"
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        <FramePreview
          photo={photo}
          format={format}
          framing={framing}
          box={{ width: 200, height: 200 }}
          background={backgroundFor(photo, type)}
          className="rounded-[1px]"
        />
        {soft && (
          <span className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-0.5 text-[11px] font-medium text-caution shadow-card">
            <Icon name="alert" size={11} /> Soft
          </span>
        )}
      </button>
      <div className="mt-3 flex max-w-full min-w-0 items-center gap-1">
        <span className="min-w-0 text-left">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Icon name={NETWORK_ICONS[format.network]} size={13} className="shrink-0 text-ink-2" />
            <span className="truncate sm:hidden">{frameName(format)}</span>
            <span className="hidden truncate sm:inline">{format.name}</span>
          </span>
          <span className="mono-num block text-[11px] text-muted">{sizeLabel(output)}</span>
        </span>
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          aria-label={`Download ${format.name}`}
          title="Save this one"
          className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/[.07] hover:text-ink disabled:opacity-40"
        >
          <Icon name="download" size={16} />
        </button>
      </div>
    </li>
  );
}

/** A size's shape, drawn small: square, tall, wide. */
function Shape({ size }: { size: Size }) {
  const box = fitInside({ width: 16, height: 16 }, size);
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-[2.5px] border-[1.5px] border-current opacity-80"
      style={{ width: Math.max(6, box.width), height: Math.max(6, box.height) }}
    />
  );
}

function SizeChip({
  format,
  on,
  onToggle,
}: {
  format: FrameFormat;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${format.name}, ${format.ratio ? `${format.label} shape` : `${format.width} by ${format.height}`}`}
      onClick={onToggle}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-full pr-3.5 pl-3 text-[13.5px] transition-colors lg:h-9',
        on
          ? 'text-[var(--on-accent,#12110d)]'
          : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10 hover:text-ink',
      )}
      style={on ? { background: 'var(--accent, var(--color-ink))' } : undefined}
    >
      <Shape size={format} />
      <span className="font-medium">{format.label}</span>
      {!format.ratio && (
        <span className="mono-num text-[11px] opacity-70">{sizeLabel(format)}</span>
      )}
    </button>
  );
}
