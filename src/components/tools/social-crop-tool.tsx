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
  FRAME_MODES,
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
import { FileDrop, IconButton, Label, Note, Surface } from './kit';

/*
 * Social Crop: one photo, framed for every feed. The photo is decoded once into an editing copy
 * (at most 4096 px on its long side, more than any network asks for) and a lighter preview copy
 * for the gallery. Each size keeps its own framing; exports are drawn from the editing copy at
 * the frame's exact size, on this device. Nothing is uploaded.
 */

const MAX_BYTES = 40 * 1024 * 1024;
/** The gallery and the soft backdrop draw from this lighter copy. */
const PREVIEW_SIDE = 1280;
const MAX_CUSTOM = 6;
const ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif';
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
 * The frame's place on the stage: centered, with room around it to see what's cropped away and
 * a line under it for the hint.
 */
function frameIn(stage: Size, output: Size): Rect {
  const pad = Math.round(Math.max(14, Math.min(40, Math.min(stage.width, stage.height) * 0.07)));
  const below = pad + 16;
  const inner = fitInside(
    {
      width: Math.max(1, stage.width - pad * 2),
      height: Math.max(1, stage.height - pad - below),
    },
    output,
  );
  const width = Math.max(1, Math.round(inner.width));
  const height = Math.max(1, Math.round(inner.height));
  return {
    x: Math.round((stage.width - width) / 2),
    y: Math.round(pad + (stage.height - pad - below - height) / 2),
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

/**
 * The composer: the frame, and in Crop the rest of the photo around it, faded into the room, so
 * you can see what you're cutting while you drag.
 */
function paintStage(canvas: HTMLCanvasElement, stage: Size, view: StageView) {
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
  const accent = styles.getPropertyValue('--accent').trim() || '#ff9e7a';
  const { photo, output, framing } = view;
  const frame = frameIn(stage, output);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, stage.width, stage.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (framing.mode === 'crop') {
    const { source, scale } = layoutFrame(photo.size, output, framing);
    const k = (frame.width / output.width) * scale;
    paintBackground(context, frame, view.background);
    context.drawImage(
      photo.image,
      frame.x - source.x * k,
      frame.y - source.y * k,
      photo.size.width * k,
      photo.size.height * k,
    );
    context.save();
    context.globalAlpha = 0.72;
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
  context.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  context.lineWidth = 1;
  context.strokeRect(frame.x + 0.5, frame.y + 0.5, frame.width - 1, frame.height - 1);
  // Accent corners, like a crop handle.
  const arm = Math.min(18, frame.width / 4, frame.height / 4);
  context.strokeStyle = accent;
  context.lineWidth = 3;
  context.beginPath();
  for (const [x, y, dx, dy] of [
    [frame.x - 1, frame.y - 1, 1, 1],
    [frame.x + frame.width + 1, frame.y - 1, -1, 1],
    [frame.x - 1, frame.y + frame.height + 1, 1, -1],
    [frame.x + frame.width + 1, frame.y + frame.height + 1, -1, -1],
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

/* ---------------- the tool ---------------- */

export function SocialCropTool() {
  const toast = useToast();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [opening, setOpening] = useState(false);
  const [selected, setSelected] = useState<string[]>(DEFAULT_FORMATS);
  const [customs, setCustoms] = useState<FrameFormat[]>([]);
  const [framings, setFramings] = useState<Record<string, Framing>>({});
  const [activeId, setActiveId] = useState(DEFAULT_FORMATS[0]);
  const [type, setType] = useState<OutputType>('jpg');
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState('');
  const current = useRef<Photo | null>(null);
  const composer = useRef<HTMLDivElement>(null);
  const opener = useRef<(files: File[]) => void>(() => {});

  const formats = useMemo(() => [...SOCIAL_FORMATS, ...customs], [customs]);
  const frames = formats.filter((format) => selected.includes(format.id));
  const active = frames.find((format) => format.id === activeId) ?? frames[0] ?? null;
  const fallback = useMemo(() => newFraming(photo?.colors[0]), [photo]);
  const framingOf = (format: FrameFormat) => framings[format.id] ?? fallback;
  const busy = opening || exporting !== null;

  // The photo's memory goes back when the tool closes.
  useEffect(() => {
    const holder = current;
    return () => release(holder.current);
  }, []);

  async function load(file: File) {
    setOpening(true);
    setMessage(`Opening ${file.name}…`);
    try {
      const next = await openPhoto(file);
      release(current.current);
      current.current = next;
      setPhoto(next);
      setFramings({});
      setMessage(`${file.name} is ready. Drag each frame to compose it.`);
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
    setMessage('');
  }

  function toggle(formatId: string) {
    if (selected.includes(formatId)) {
      setSelected(selected.filter((item) => item !== formatId));
    } else {
      setSelected([...selected, formatId]);
      // A size just added is the one you'll want to compose.
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
  }

  function compose(formatId: string) {
    setActiveId(formatId);
    // On a phone the composer is above the gallery: bring it into view.
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    composer.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
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
  const step = (by: number) =>
    frames.length && setActiveId(frames[(index + by + frames.length) % frames.length].id);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] lg:items-start">
      <div ref={composer} className="grid min-w-0 scroll-mt-20 gap-5 lg:sticky lg:top-24">
        {photo ? (
          <Surface className="grid gap-4">
            <PhotoBar photo={photo} busy={busy} onReplace={open} onRemove={clear} />
            {active ? (
              <Composer
                photo={photo}
                format={active}
                framing={framingOf(active)}
                type={type}
                busy={busy}
                position={{ index, total: frames.length, step }}
                onChange={(next) => setFraming(active.id, next)}
                onDownload={() => downloadOne(active)}
              />
            ) : (
              <p className="rounded-[16px] bg-subtle px-4 py-10 text-center text-[14px] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
                Pick a size to compose your photo in it.
              </p>
            )}
            <p role="status" className="min-h-5 text-[13px] text-muted">
              {message}
            </p>
          </Surface>
        ) : (
          <Surface className="grid gap-3">
            <FileDrop
              onFiles={open}
              accept={ACCEPT}
              multiple={false}
              icon="crop"
              accent="#ff9e7a"
              title="Add one photo"
              disabled={busy}
              hint={
                <>
                  JPG, PNG, WebP, GIF or AVIF, up to 40 MB. You can also paste one. iPhone HEIC
                  photos open only in Safari.
                </>
              }
              className="sm:!py-14"
            />
            <button
              type="button"
              onClick={trySample}
              disabled={busy}
              className="mx-auto flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-signal-ink transition-colors hover:bg-signal-soft disabled:opacity-50 lg:h-9 lg:text-[13.5px]"
            >
              <Icon
                name={opening ? 'loader' : 'sparkles'}
                size={15}
                className={cn(opening && 'animate-spin')}
              />
              {opening ? 'Opening…' : 'Try a sample photo'}
            </button>
            <p role="status" className="min-h-5 text-center text-[13px] text-muted">
              {message}
            </p>
          </Surface>
        )}
      </div>

      <div className="grid min-w-0 gap-5">
        <Surface>
          <SizePicker
            selected={selected}
            customs={customs}
            onToggle={toggle}
            onAdd={addCustom}
            onRemove={removeCustom}
            onAll={() => setSelected(formats.map((format) => format.id))}
            onNone={() => setSelected([])}
          />
        </Surface>

        <Surface className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Your frames · {frames.length}</Label>
            {photo && frames.length > 1 && (
              <span className="text-[12.5px] text-muted">Tap one to compose it</span>
            )}
          </div>
          {frames.length === 0 ? (
            <p className="rounded-[14px] bg-subtle px-4 py-8 text-center text-[13.5px] text-muted">
              No sizes chosen yet. Pick one or more above.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {frames.map((format) =>
                photo ? (
                  <FrameTile
                    key={format.id}
                    photo={photo}
                    format={format}
                    framing={framingOf(format)}
                    type={type}
                    selected={format.id === active?.id}
                    busy={busy}
                    onSelect={() => compose(format.id)}
                    onDownload={() => downloadOne(format)}
                  />
                ) : (
                  <Placeholder key={format.id} format={format} />
                ),
              )}
            </ul>
          )}

          <div className="grid gap-3 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] font-medium text-ink-2">Save as</span>
              <div
                role="radiogroup"
                aria-label="File type"
                className="flex rounded-[12px] bg-well p-1"
              >
                {(Object.keys(TYPES) as OutputType[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={type === option}
                    onClick={() => setType(option)}
                    className={cn(
                      'h-10 min-w-16 rounded-[9px] px-3 text-[13.5px] font-medium transition-colors lg:h-8',
                      type === option
                        ? 'bg-surface text-ink shadow-card'
                        : 'text-muted hover:text-ink',
                    )}
                  >
                    {TYPES[option].label}
                  </button>
                ))}
              </div>
            </div>
            {soft.length > 0 && (
              <Note tone="caution" icon="alert">
                {soft.length === 1 ? 'One frame' : `${soft.length} frames`} will look soft: your
                photo has fewer pixels than {soft.length === 1 ? 'it needs' : 'they need'} (
                {soft.map((format) => format.name).join(', ')}).{' '}
                {soft.some(
                  (format) => framingOf(format).zoom > 1.01 && framingOf(format).mode === 'crop',
                )
                  ? 'Zoom out, or use a bigger photo.'
                  : 'A bigger photo would be sharper.'}
              </Note>
            )}
            <button
              type="button"
              onClick={downloadAll}
              disabled={!photo || busy || frames.length === 0}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-ink px-4 text-[15px] font-medium text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-45 lg:h-11 lg:text-[14.5px]"
            >
              <Icon
                name={exporting ? 'loader' : 'download'}
                size={17}
                className={cn(exporting && 'animate-spin')}
              />
              {exporting
                ? `Preparing ${Math.min(exporting.done + 1, exporting.total)} of ${exporting.total}…`
                : frames.length > 1
                  ? `Download all ${frames.length} · zip`
                  : 'Download'}
            </button>
            <p className="text-[12px] leading-relaxed text-faint">
              Every frame at its exact size
              {type === 'jpg' ? ', JPG at 90% quality' : ', PNG keeps transparency'}. Made on this
              device; your photo is never uploaded.
            </p>
          </div>
        </Surface>
      </div>
    </div>
  );
}

/* ---------------- parts ---------------- */

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
  const scaled = photo.size.width !== photo.original.width;
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-well text-ink-2">
        <Icon name="image" size={19} />
      </span>
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
          'inline-flex h-10 items-center gap-1.5 rounded-[11px] bg-well px-3 text-[13.5px] font-medium text-ink-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal hover:bg-ink/10 hover:text-ink lg:h-9',
          busy && 'pointer-events-none opacity-45',
        )}
      >
        <Icon name="replace" size={15} /> Replace
      </label>
      <IconButton icon="x" label="Remove the photo" onClick={onRemove} disabled={busy} />
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
  busy,
  position,
  onChange,
  onDownload,
}: {
  photo: Photo;
  format: FrameFormat;
  framing: Framing;
  type: OutputType;
  busy: boolean;
  position: { index: number; total: number; step: (by: number) => void };
  onChange: (framing: Framing) => void;
  onDownload: () => void;
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

  const output = outputSize(format, photo.size, framing);
  const { width: outputWidth, height: outputHeight } = output;
  const layout = layoutFrame(photo.size, output, framing);
  const range = ZOOM[framing.mode];
  const fit = framing.mode === 'fit';
  const showCovered = covered && Boolean(format.covered);
  const background: Background = photo.transparent
    ? type === 'jpg'
      ? 'white'
      : 'checker'
    : undefined;

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
    paintStage(element, stage, {
      photo,
      format,
      output: { width: outputWidth, height: outputHeight },
      framing,
      grid: dragging,
      covered: showCovered,
      background,
    });
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
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <IconButton
          icon="chevron-left"
          label="Previous frame"
          onClick={() => position.step(-1)}
          disabled={position.total < 2}
        />
        <div className="min-w-0 flex-1 text-center">
          <p className="flex items-center justify-center gap-1.5 text-[15px] font-semibold text-ink">
            <Icon name={NETWORK_ICONS[format.network]} size={16} className="text-ink-2" />
            <span className="truncate">{format.name}</span>
          </p>
          <p className="mono-num text-[11.5px] text-muted">
            {sizeLabel(output)} · {ratioLabel(format.width, format.height)}
            {position.total > 1 && ` · ${position.index + 1} of ${position.total}`}
          </p>
        </div>
        <IconButton
          icon="chevron-right"
          label="Next frame"
          onClick={() => position.step(1)}
          disabled={position.total < 2}
        />
      </div>

      <div
        ref={box}
        className="relative h-[min(58vh,460px)] overflow-hidden rounded-[16px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] lg:h-[clamp(300px,calc(100vh_-_470px),600px)]"
      >
        <div
          role="application"
          aria-roledescription="frame composer"
          aria-label={`${format.name}, ${output.width} by ${output.height}`}
          aria-describedby={`${id}-how`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="absolute inset-0 rounded-[16px] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-signal)]"
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
        <p
          id={`${id}-how`}
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-2.5 text-center text-[11.5px] text-ink-2 transition-opacity duration-300',
            dragging ? 'opacity-0' : 'opacity-80',
          )}
        >
          Drag to move · pinch or use the slider to zoom
          <span className="sr-only">. Arrow keys move it, plus and minus zoom, 0 resets.</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          role="radiogroup"
          aria-label="How the photo fills the frame"
          className="flex rounded-[12px] bg-well p-1"
        >
          {FRAME_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={framing.mode === mode}
              onClick={() => onChange(withMode(framing, mode))}
              className={cn(
                'flex h-10 items-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-medium transition-colors lg:h-8',
                framing.mode === mode
                  ? 'bg-surface text-ink shadow-card'
                  : 'text-muted hover:text-ink',
              )}
            >
              <Icon name={mode === 'crop' ? 'crop' : 'frame'} size={15} />
              {mode === 'crop' ? 'Crop to fill' : 'Fit it all'}
            </button>
          ))}
        </div>
        <div className="flex min-w-[210px] flex-1 items-center gap-1">
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
            className="min-w-0 flex-1"
          />
          <IconButton
            icon="zoom-in"
            label={fit ? 'Bigger' : 'Zoom in'}
            onClick={() => zoomTo(framing.zoom * 1.15)}
            disabled={framing.zoom >= range.max}
          />
          <span className="mono-num w-11 text-right text-[12px] text-muted">
            {Math.round(framing.zoom * 100)}%
          </span>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={!moved}
          className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-2.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-40 lg:h-8"
        >
          <Icon name="restore" size={15} /> Reset
        </button>
      </div>

      {fit && (
        <div
          role="radiogroup"
          aria-label="Around the photo"
          className="flex flex-wrap items-center gap-2 animate-fade"
        >
          <span className="mr-1 text-[13px] font-medium text-ink-2">Around it</span>
          <button
            type="button"
            role="radio"
            aria-checked={framing.backdrop.fill === 'blur'}
            onClick={() => setBackdrop({ fill: 'blur' })}
            className={cn(
              'h-10 rounded-full px-3.5 text-[13px] font-medium transition-colors lg:h-9',
              framing.backdrop.fill === 'blur'
                ? 'bg-ink text-on-ink'
                : 'bg-well text-ink-2 hover:bg-ink/10',
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
                  'size-9 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.18)] transition-transform hover:scale-105',
                  on && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
                )}
              />
            );
          })}
          <label
            className="relative grid size-9 place-items-center rounded-full bg-well text-ink-2 hover:bg-ink/10"
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

      <p className="flex items-center gap-2 text-[12.5px] text-muted">
        <Icon name="sparkles" size={14} className="shrink-0" />
        <span>
          AI Expand — grow the photo to fit instead of cropping.{' '}
          <span className="whitespace-nowrap text-faint">Coming later · Pro</span>
        </span>
      </p>

      {format.covered && (
        <div className="grid gap-1.5">
          <button
            type="button"
            aria-pressed={covered}
            onClick={() => setCovered(!covered)}
            className={cn(
              'inline-flex h-10 items-center gap-2 justify-self-start rounded-[10px] px-3 text-[13.5px] font-medium transition-colors lg:h-9',
              covered ? 'bg-ink text-on-ink' : 'bg-well text-ink-2 hover:bg-ink/10',
            )}
          >
            <Icon name={covered ? 'eye' : 'eye-off'} size={15} />
            Show what {network} covers
          </button>
          {covered && (
            <p className="text-[12px] text-muted">
              Approximate: names, captions and buttons sit roughly in the shaded areas, and apps
              move them around. Keep faces and words in the clear middle.
            </p>
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

      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-well px-4 text-[15px] font-medium text-ink transition-colors hover:bg-ink/10 disabled:opacity-45 lg:h-11 lg:text-[14.5px]"
      >
        <Icon name="download" size={17} />
        Download this frame · {TYPES[type].label}
      </button>
    </div>
  );
}

function FrameTile({
  photo,
  format,
  framing,
  type,
  selected,
  busy,
  onSelect,
  onDownload,
}: {
  photo: Photo;
  format: FrameFormat;
  framing: Framing;
  type: OutputType;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDownload: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const output = outputSize(format, photo.size, framing);
  const { width, height } = output;
  const pixels = within(output, 360);
  const soft = layoutFrame(photo.size, output, framing).scale > SOFT_SCALE;
  const background: Background = photo.transparent
    ? type === 'jpg'
      ? 'white'
      : 'checker'
    : undefined;

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
  }, [photo, framing, width, height, background]);

  const detail =
    framing.mode === 'fit'
      ? 'Fit'
      : framing.zoom > 1.005
        ? `${Math.round(framing.zoom * 100)}%`
        : 'Crop';
  return (
    <li className="relative min-w-0 animate-fade">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        aria-label={`Compose ${format.name}, ${width} by ${height}${soft ? ', will look soft' : ''}`}
        className={cn(
          'grid w-full gap-2 rounded-[16px] p-1.5 text-left transition-colors',
          selected
            ? 'bg-subtle shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-ink))]'
            : 'hover:bg-ink/5',
        )}
      >
        <span className="flex h-[128px] items-center justify-center rounded-[11px] bg-well p-3">
          <canvas
            ref={canvas}
            width={pixels.width}
            height={pixels.height}
            className="block max-h-full max-w-full rounded-[3px] shadow-lift"
          />
        </span>
        <span className="grid gap-0.5 px-1 pb-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
            <Icon name={NETWORK_ICONS[format.network]} size={14} className="shrink-0 text-ink-2" />
            <span className="truncate">{format.name}</span>
          </span>
          <span className="mono-num text-[11px] text-muted">
            {sizeLabel(output)} · {detail}
          </span>
        </span>
      </button>
      {soft && (
        <span className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-caution shadow-card">
          <Icon name="alert" size={11} /> Soft
        </span>
      )}
      <IconButton
        icon="download"
        label={`Download ${format.name}`}
        onClick={onDownload}
        disabled={busy}
        size="sm"
        className="absolute top-2.5 right-2.5 bg-surface/85 text-ink-2 shadow-card backdrop-blur"
      />
    </li>
  );
}

/** Before there's a photo: the shape each chosen size will have. */
function Placeholder({ format }: { format: FrameFormat }) {
  const box = fitInside({ width: 112, height: 84 }, format);
  return (
    <li className="grid min-w-0 gap-2 p-1.5">
      <span className="flex h-[128px] items-center justify-center rounded-[11px] bg-well">
        <span
          className="mono-num grid place-items-center rounded-[4px] border-[1.5px] border-dashed border-line-strong text-[10.5px] text-faint"
          style={{ width: box.width, height: box.height }}
        >
          {ratioLabel(format.width, format.height)}
        </span>
      </span>
      <span className="grid gap-0.5 px-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink-2">
          <Icon name={NETWORK_ICONS[format.network]} size={14} className="shrink-0" />
          <span className="truncate">{format.name}</span>
        </span>
        <span className="mono-num text-[11px] text-muted">
          {format.ratio ? `${format.label} · your photo’s size` : sizeLabel(format)}
        </span>
      </span>
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
        'inline-flex h-11 items-center gap-2 rounded-[12px] pr-3 pl-2.5 text-[13.5px] transition-colors lg:h-9',
        on ? 'bg-ink text-on-ink' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
      )}
    >
      <Shape size={format} />
      <span className="font-medium">{format.label}</span>
      {!format.ratio && (
        <span className={cn('mono-num text-[11px]', on ? 'text-on-ink/65' : 'text-muted')}>
          {sizeLabel(format)}
        </span>
      )}
    </button>
  );
}

function SizePicker({
  selected,
  customs,
  onToggle,
  onAdd,
  onRemove,
  onAll,
  onNone,
}: {
  selected: string[];
  customs: FrameFormat[];
  onToggle: (formatId: string) => void;
  onAdd: (format: FrameFormat) => void;
  onRemove: (formatId: string) => void;
  onAll: () => void;
  onNone: () => void;
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
    <section aria-labelledby={`${id}-sizes`} className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <Label id={`${id}-sizes`}>Sizes · {selected.length} chosen</Label>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onAll}
            className="h-9 rounded-[9px] px-2.5 text-[13px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-8"
          >
            All
          </button>
          <button
            type="button"
            onClick={onNone}
            disabled={selected.length === 0}
            className="h-9 rounded-[9px] px-2.5 text-[13px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink disabled:opacity-40 lg:h-8"
          >
            None
          </button>
        </div>
      </div>
      <ul className="grid gap-3">
        {NETWORKS.filter((network) => network.id !== 'custom').map((network) => (
          <li
            key={network.id}
            className="grid gap-2 sm:grid-cols-[108px_minmax(0,1fr)] sm:items-center"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <Icon name={NETWORK_ICONS[network.id]} size={15} />
              {network.name}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SOCIAL_FORMATS.filter((format) => format.network === network.id).map((format) => (
                <SizeChip
                  key={format.id}
                  format={format}
                  on={selected.includes(format.id)}
                  onToggle={() => onToggle(format.id)}
                />
              ))}
            </div>
          </li>
        ))}
        <li className="grid gap-2 border-t border-line pt-3 sm:grid-cols-[108px_minmax(0,1fr)] sm:items-start">
          <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2 sm:h-9">
            <Icon name="crop" size={15} />
            Custom
          </span>
          <div className="grid gap-2">
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
                      size="sm"
                      label={`Remove ${format.label}`}
                      onClick={() => onRemove(format.id)}
                    />
                  </span>
                ))}
              </div>
            )}
            <form onSubmit={submit} className="flex gap-2">
              <input
                aria-label="A custom shape or size"
                aria-describedby={`${id}-custom-hint`}
                aria-invalid={error ? true : undefined}
                placeholder="3:2 or 1200x628"
                value={text}
                maxLength={24}
                onChange={(event) => {
                  setText(event.target.value);
                  setError('');
                }}
                className="h-11 min-w-0 flex-1 rounded-[11px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:h-9 lg:text-[14px]"
              />
              <button
                type="submit"
                disabled={!text.trim()}
                className="inline-flex h-11 items-center gap-1.5 rounded-[11px] bg-well px-3.5 text-[14px] font-medium text-ink transition-colors hover:bg-ink/10 disabled:opacity-40 lg:h-9 lg:text-[13.5px]"
              >
                <Icon name="plus" size={15} /> Add
              </button>
            </form>
            <p
              id={`${id}-custom-hint`}
              className={cn('text-[12px]', error ? 'text-critical' : 'text-muted')}
            >
              {error ||
                'A shape (3:2) crops at your photo’s own resolution; a size (1200x628) exports exactly that. Up to 4096 px.'}
            </p>
          </div>
        </li>
      </ul>
    </section>
  );
}
