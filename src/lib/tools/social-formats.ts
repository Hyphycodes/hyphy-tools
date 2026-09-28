import { slugName } from '@/lib/files/download';

/*
 * Social Crop: every network's image size in one table, and the math that frames one photo in
 * each of them. Pure and tested (tests/lib-social-crop.spec.ts).
 *
 * A frame is composed one of two ways (`mode`):
 * - crop: the photo covers the frame; zoom and position choose which part shows. The part drawn
 *   is always inside the photo and always exactly the frame's shape.
 * - fit: the whole photo shows inside the frame, over a backdrop. What fills the space around it
 *   is a strategy (`fill`): a soft blur of the photo or a solid color today, AI Expand later.
 *
 * Position is where the photo sits in the room it has to move: 0 is one edge, 1 the other, 0.5
 * centered, so any framing is valid at any zoom and nothing ever slides out of the frame.
 */

export type Size = { width: number; height: number };
export type Rect = Size & { x: number; y: number };

export const NETWORKS = [
  { id: 'instagram', name: 'Instagram' },
  { id: 'tiktok', name: 'TikTok' },
  { id: 'youtube', name: 'YouTube' },
  { id: 'x', name: 'X' },
  { id: 'linkedin', name: 'LinkedIn' },
  { id: 'facebook', name: 'Facebook' },
  { id: 'custom', name: 'Custom' },
] as const;
export type NetworkId = (typeof NETWORKS)[number]['id'];

/** Part of a frame an app covers with its own names, captions or buttons (fractions, 0–1). */
export type CoveredArea = Rect & { label: string };

export type FrameFormat = {
  id: string;
  network: NetworkId;
  /** "Instagram post" */
  name: string;
  /** Within its network: "Post". */
  label: string;
  /** Exact pixels, or for a custom shape the ratio's two terms. */
  width: number;
  height: number;
  /** A custom shape has no fixed size: it's exported at the photo's own resolution. */
  ratio?: boolean;
  /** Approximate: apps move their buttons around. */
  covered?: CoveredArea[];
};

/** Stories and Reels: the name and progress bar on top, replies and captions below, Reels buttons. */
const STORY_COVERED: CoveredArea[] = [
  { x: 0, y: 0, width: 1, height: 0.13, label: 'Name and progress bar' },
  { x: 0, y: 0.8, width: 1, height: 0.2, label: 'Replies and captions' },
  { x: 0.86, y: 0.42, width: 0.14, height: 0.38, label: 'Reels buttons' },
];
const TIKTOK_COVERED: CoveredArea[] = [
  { x: 0, y: 0, width: 1, height: 0.09, label: 'Tabs' },
  { x: 0, y: 0.75, width: 1, height: 0.25, label: 'Caption and sound' },
  { x: 0.84, y: 0.36, width: 0.16, height: 0.39, label: 'Buttons' },
];

/** Every preset, grouped by network in the order they're offered. The one place sizes live. */
export const SOCIAL_FORMATS: readonly FrameFormat[] = [
  {
    id: 'instagram-post',
    network: 'instagram',
    name: 'Instagram post',
    label: 'Post',
    width: 1080,
    height: 1080,
  },
  {
    id: 'instagram-portrait',
    network: 'instagram',
    name: 'Instagram portrait',
    label: 'Portrait',
    width: 1080,
    height: 1350,
  },
  {
    id: 'instagram-story',
    network: 'instagram',
    name: 'Instagram story / Reels',
    label: 'Story / Reels',
    width: 1080,
    height: 1920,
    covered: STORY_COVERED,
  },
  {
    id: 'tiktok',
    network: 'tiktok',
    name: 'TikTok',
    label: 'Photo / cover',
    width: 1080,
    height: 1920,
    covered: TIKTOK_COVERED,
  },
  {
    id: 'youtube-thumbnail',
    network: 'youtube',
    name: 'YouTube thumbnail',
    label: 'Thumbnail',
    width: 1280,
    height: 720,
  },
  { id: 'x-post', network: 'x', name: 'X post', label: 'Post', width: 1600, height: 900 },
  { id: 'x-header', network: 'x', name: 'X header', label: 'Header', width: 1500, height: 500 },
  {
    id: 'linkedin-post',
    network: 'linkedin',
    name: 'LinkedIn post',
    label: 'Post',
    width: 1200,
    height: 627,
  },
  {
    id: 'linkedin-banner',
    network: 'linkedin',
    name: 'LinkedIn banner',
    label: 'Banner',
    width: 1584,
    height: 396,
  },
  {
    id: 'facebook-cover',
    network: 'facebook',
    name: 'Facebook cover',
    label: 'Cover',
    width: 1640,
    height: 624,
  },
];

/** What a first visit starts with: the sizes most people post. */
export const DEFAULT_FORMATS = [
  'instagram-post',
  'instagram-portrait',
  'instagram-story',
  'youtube-thumbnail',
];

/** The largest side anything is drawn or exported at: a phone's canvas limits start above it. */
export const MAX_SIDE = 4096;
/** Enlarged more than this and an export visibly softens: say so. */
export const SOFT_SCALE = 1.05;

export const FRAME_MODES = ['crop', 'fit'] as const;
export type FrameMode = (typeof FRAME_MODES)[number];

/**
 * What fills a fitted frame around the photo. A strategy, so AI Expand (generated photo instead
 * of a backdrop, Pro) slots in beside these later without changing a framing's shape.
 */
export const FILLS = ['blur', 'color'] as const;
export type Fill = (typeof FILLS)[number];

export type Framing = {
  mode: FrameMode;
  /** Where the photo sits in the room it has to move, 0–1 on each axis; 0.5 is centered. */
  x: number;
  y: number;
  /** Crop: 1 = the photo just covers the frame. Fit: 1 = the whole photo just fits. */
  zoom: number;
  backdrop: { fill: Fill; color: string };
};

export const ZOOM: Record<FrameMode, { min: number; max: number }> = {
  crop: { min: 1, max: 5 },
  fit: { min: 0.4, max: 1 },
};

export function newFraming(color = '#000000'): Framing {
  return { mode: 'crop', x: 0.5, y: 0.5, zoom: 1, backdrop: { fill: 'blur', color } };
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : (min + max) / 2;

/** Keeps a framing inside what its mode allows (a stray value can't push the photo off). */
export function clampFraming(framing: Framing): Framing {
  const { min, max } = ZOOM[framing.mode];
  return {
    ...framing,
    x: clamp(framing.x, 0, 1),
    y: clamp(framing.y, 0, 1),
    zoom: Number.isFinite(framing.zoom) ? Math.min(max, Math.max(min, framing.zoom)) : 1,
  };
}

/** Switching mode keeps where the photo leans (left stays left) and starts from a full view. */
export function withMode(framing: Framing, mode: FrameMode): Framing {
  return mode === framing.mode ? framing : clampFraming({ ...framing, mode, zoom: 1 });
}

export type Layout = {
  /** The part of the photo drawn (photo pixels). */
  source: Rect;
  /** Where it lands in the frame (output pixels). */
  target: Rect;
  /** Output pixels per photo pixel: above 1, the photo is being enlarged. */
  scale: number;
};

/** Where the photo lands in a frame of `output` pixels. */
export function layoutFrame(source: Size, output: Size, framing: Framing): Layout {
  const { mode, x, y, zoom } = clampFraming(framing);
  if (mode === 'crop') {
    const scale = Math.max(output.width / source.width, output.height / source.height) * zoom;
    const width = Math.min(source.width, output.width / scale);
    const height = Math.min(source.height, output.height / scale);
    return {
      source: { x: x * (source.width - width), y: y * (source.height - height), width, height },
      target: { x: 0, y: 0, width: output.width, height: output.height },
      scale,
    };
  }
  const scale = Math.min(output.width / source.width, output.height / source.height) * zoom;
  const width = Math.min(output.width, source.width * scale);
  const height = Math.min(output.height, source.height * scale);
  return {
    source: { x: 0, y: 0, width: source.width, height: source.height },
    target: { x: x * (output.width - width), y: y * (output.height - height), width, height },
    scale,
  };
}

/** An offset in room → a 0–1 position; with no room to move, the old position stands. */
const position = (offset: number, room: number, fallback: number) =>
  room > 1e-9 ? clamp(offset / room, 0, 1) : fallback;

/** Moves the photo by a drag of (dx, dy) output pixels: the photo follows the finger. */
export function panBy(source: Size, output: Size, framing: Framing, dx: number, dy: number) {
  const current = clampFraming(framing);
  const { source: part, target, scale } = layoutFrame(source, output, current);
  if (current.mode === 'crop')
    return {
      ...current,
      x: position(part.x - dx / scale, source.width - part.width, current.x),
      y: position(part.y - dy / scale, source.height - part.height, current.y),
    };
  return {
    ...current,
    x: position(target.x + dx, output.width - target.width, current.x),
    y: position(target.y + dy, output.height - target.height, current.y),
  };
}

/**
 * Zooms to `zoom` around `anchor` (a point in the frame, 0–1 across and down), so what's under
 * the anchor stays put, as far as the photo's edges allow. Center by default.
 */
export function zoomAt(
  source: Size,
  output: Size,
  framing: Framing,
  zoom: number,
  anchor = { x: 0.5, y: 0.5 },
): Framing {
  const current = clampFraming(framing);
  const next = clampFraming({ ...current, zoom });
  const before = layoutFrame(source, output, current);
  const after = layoutFrame(source, output, next);
  if (current.mode === 'crop') {
    const pointX = before.source.x + anchor.x * before.source.width;
    const pointY = before.source.y + anchor.y * before.source.height;
    return {
      ...next,
      x: position(
        pointX - anchor.x * after.source.width,
        source.width - after.source.width,
        current.x,
      ),
      y: position(
        pointY - anchor.y * after.source.height,
        source.height - after.source.height,
        current.y,
      ),
    };
  }
  const pointX = anchor.x * output.width;
  const pointY = anchor.y * output.height;
  const alongX = (pointX - before.target.x) / before.target.width;
  const alongY = (pointY - before.target.y) / before.target.height;
  return {
    ...next,
    x: position(pointX - alongX * after.target.width, output.width - after.target.width, current.x),
    y: position(
      pointY - alongY * after.target.height,
      output.height - after.target.height,
      current.y,
    ),
  };
}

/**
 * The size a frame exports at. Presets and custom pixel sizes are fixed. A custom shape follows
 * the photo: cropped, it's the crop at the photo's own resolution; fitted, the smallest frame of
 * that shape that holds the whole photo at full size. Never above MAX_SIDE.
 */
export function outputSize(format: FrameFormat, source: Size, framing: Framing): Size {
  if (!format.ratio) return { width: format.width, height: format.height };
  const ratio = format.width / format.height;
  const { mode, zoom } = clampFraming(framing);
  const wider = source.width / source.height > ratio;
  let width: number;
  let height: number;
  if (mode === 'crop') {
    width = (wider ? source.height * ratio : source.width) / zoom;
    height = (wider ? source.height : source.width / ratio) / zoom;
  } else {
    width = wider ? source.width : source.height * ratio;
    height = wider ? source.width / ratio : source.height;
  }
  const fit = Math.min(1, MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * fit)),
    height: Math.max(1, Math.round(height * fit)),
  };
}

/**
 * Softens RGBA pixels in place: three box-blur passes each way, which together look like a
 * Gaussian. Run on a tiny copy of the photo, it makes Fit's backdrop; edges repeat outward.
 */
export function blurPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  passes = 3,
) {
  const line = new Float64Array(Math.max(width, height));
  const span = radius * 2 + 1;
  const edge = (index: number, length: number) => Math.min(length - 1, Math.max(0, index));
  const blurLine = (start: number, step: number, length: number) => {
    for (let channel = 0; channel < 4; channel += 1) {
      const at = (index: number) => data[start + edge(index, length) * step + channel];
      let sum = 0;
      for (let index = -radius; index <= radius; index += 1) sum += at(index);
      for (let index = 0; index < length; index += 1) {
        line[index] = sum / span;
        sum += at(index + radius + 1) - at(index - radius);
      }
      for (let index = 0; index < length; index += 1)
        data[start + index * step + channel] = line[index];
    }
  };
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) blurLine(y * width * 4, 4, width);
    for (let x = 0; x < width; x += 1) blurLine(x * 4, width * 4, height);
  }
}

/** `outer` shrunk to `aspect`'s shape so it fits inside: a preview box, a stage. */
export function fitInside(outer: Size, aspect: Size): Size {
  const scale = Math.min(outer.width / aspect.width, outer.height / aspect.height);
  return { width: aspect.width * scale, height: aspect.height * scale };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const trim = (value: number) => String(Number(value.toFixed(2)));

/** 1080×1350 → "4:5", 1200×627 → "1.91:1": small whole numbers, or a decimal against 1. */
export function ratioLabel(width: number, height: number) {
  if (Number.isInteger(width) && Number.isInteger(height)) {
    const divisor = gcd(width, height);
    if (Math.max(width, height) / divisor <= 21) return `${width / divisor}:${height / divisor}`;
  }
  return width >= height ? `${trim(width / height)}:1` : `1:${trim(height / width)}`;
}

export const sizeLabel = ({ width, height }: Size) => `${width}×${height}`;

/**
 * What someone types in Custom: a shape ("3:2", "16x9", "1.91:1") or an exact size ("1200x628",
 * "1200 × 628 px"). An "x" between numbers of 100 or more is a size; smaller, it's a shape.
 */
export function parseCustom(text: string): { format: FrameFormat } | { error: string } {
  const clean = text
    .toLowerCase()
    .replace(/px/g, ' ')
    .replace(/\s+by\s+/g, 'x')
    .trim();
  const match = /^(\d+(?:[.,]\d+)?)\s*([:x×*/])\s*(\d+(?:[.,]\d+)?)$/.exec(clean);
  if (!match) return { error: 'Type a shape like 3:2, or a size like 1200x628.' };
  const first = Number(match[1].replace(',', '.'));
  const second = Number(match[3].replace(',', '.'));
  if (!(first > 0 && second > 0)) return { error: 'Both numbers need to be more than zero.' };
  const whole = Number.isInteger(first) && Number.isInteger(second);
  if (/[x×*]/.test(match[2]) && whole && Math.max(first, second) >= 100) {
    if (Math.max(first, second) > MAX_SIDE)
      return { error: `Sizes go up to ${MAX_SIDE} px on each side.` };
    if (Math.min(first, second) < 16) return { error: 'Make each side at least 16 px.' };
    return {
      format: {
        id: `size-${first}x${second}`,
        network: 'custom',
        name: `Custom ${first}×${second}`,
        label: `${first}×${second}`,
        width: first,
        height: second,
      },
    };
  }
  if (first / second > 10 || second / first > 10)
    return { error: 'Keep the shape between 1:10 and 10:1.' };
  // 6:4 is 3:2: one shape, one frame.
  const divisor = whole ? gcd(first, second) : 1;
  const width = Number((first / divisor).toFixed(2));
  const height = Number((second / divisor).toFixed(2));
  return {
    format: {
      id: `ratio-${width}x${height}`,
      network: 'custom',
      name: `Custom ${width}:${height}`,
      label: `${width}:${height}`,
      width,
      height,
      ratio: true,
    },
  };
}

/** "Beach.JPG" + Instagram post → "beach-instagram-post-1080x1080.jpg". */
export function frameFileName(
  photoName: string,
  format: FrameFormat,
  size: Size,
  extension: 'jpg' | 'png',
) {
  const photo = slugName(photoName.replace(/\.[^.]+$/, ''), 'photo');
  const frame = format.ratio
    ? slugName(`crop ${format.width}x${format.height}`)
    : format.network === 'custom'
      ? 'custom'
      : format.id;
  return `${photo}-${frame}-${size.width}x${size.height}.${extension}`;
}
