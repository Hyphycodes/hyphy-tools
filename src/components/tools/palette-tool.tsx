'use client';
import { takeCarried } from '@/lib/share/carry';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { download, downloadText, slugName } from '@/lib/files/download';
import {
  contrastLevel,
  cssVariables,
  DEFAULT_COLORS,
  extractPalette,
  formatHsl,
  formatRatio,
  formatRgb,
  formatShare,
  hexToRgb,
  locateColor,
  MAX_COLORS,
  MIN_COLORS,
  paletteJson,
  readablePairs,
  rgbToHex,
  roomColors,
  sampleColors,
  shareNear,
  SHEET_FONTS,
  sheetSvg,
  swatchSheet,
  tailwindTheme,
  textOn,
  type ColorSample,
  type RoomColors,
  type Swatch,
} from '@/lib/tools/palette';
import { ActionBar, Advanced, CountUp, DropObject, IconButton, Stage } from './kit';
import { LogoThumb, PaletteArt, SunsetThumb } from './palette-art';
import { colorName } from './palette-names';

/*
 * Palette: an image's key colors, measured on this device. The image is decoded once: a ~200 px
 * copy is what the palette is extracted from, a larger copy is shown and read while you hover,
 * and a tap reads the exact pixel from the full image (up to 4096 px). Nothing is uploaded.
 */

const MAX_BYTES = 40 * 1024 * 1024;
const SAMPLE_SIDE = 200;
const VIEW_SIDE = 1600;
const PICK_SIDE = 4096;
const MAX_ADDED = 6;
/**
 * Any image: on an iPhone this offers the photo library and the camera, and hands over HEIC photos
 * as JPEGs, which every browser opens.
 */
const ACCEPT = 'image/*';
const READABLE = /\.(jpe?g|png|webp|gif|avif|svg|hei[cf])$/i;
const HEIC_NOTE =
  'iPhone HEIC photos open only in Safari. Open this page in Safari, or share the photo as a JPG first.';
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Loaded = {
  name: string;
  size: Size;
  /** Up to 4096 px: a tap reads its exact pixel. */
  source: ImageBitmap | HTMLCanvasElement;
  /** What's shown, and read while the pointer hovers. */
  view: ImageData;
  sample: ColorSample;
};
/** A color you added: tapped on the image, or typed. */
type Added = Swatch & { at: Point | null; typed: boolean };
type Entry = Swatch & { key: string; at: Point | null; kind: 'found' | 'picked' | 'typed' };

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
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser couldn’t draw the image.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

function pixelsOf(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser couldn’t read the image.');
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

async function decode(file: File): Promise<{ image: ImageBitmap | HTMLCanvasElement; size: Size }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, size: { width: bitmap.width, height: bitmap.height } };
  } catch {
    // Safari reads some formats (HEIC) in an <img> that it won't hand to createImageBitmap, and
    // an SVG logo only draws through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const element = new Image();
      element.src = url;
      await element.decode();
      const size = { width: element.naturalWidth || 1024, height: element.naturalHeight || 1024 };
      return { image: copyOf(element, within(size, PICK_SIDE)), size };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function openImage(file: File): Promise<Loaded> {
  const decoded = await decode(file);
  const { size } = decoded;
  if (!size.width || !size.height) throw new Error('Empty image');
  const pick = within(size, PICK_SIDE);
  let source = decoded.image;
  if (source.width !== pick.width || source.height !== pick.height) {
    const copy = copyOf(source, pick);
    if (source instanceof ImageBitmap) source.close();
    source = copy;
  }
  const viewCanvas = copyOf(source, within(size, VIEW_SIDE));
  const view = pixelsOf(viewCanvas);
  freeCanvas(viewCanvas);
  const small = copyOf(source, within(size, SAMPLE_SIDE));
  const pixels = pixelsOf(small);
  freeCanvas(small);
  return {
    name: file.name,
    size,
    source,
    view,
    sample: sampleColors(pixels.data, pixels.width, pixels.height),
  };
}

function release(image: Loaded | null) {
  if (!image) return;
  if (image.source instanceof ImageBitmap) image.source.close();
  else freeCanvas(image.source);
}

let reader: CanvasRenderingContext2D | null = null;

/** The exact pixel at (x, y) of the full image, or null where it's see-through. */
function exactPixel(source: CanvasImageSource, x: number, y: number) {
  reader ??= canvasOf({ width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!reader) return null;
  reader.clearRect(0, 0, 1, 1);
  reader.imageSmoothingEnabled = false;
  reader.drawImage(source, x, y, 1, 1, 0, 0, 1, 1);
  const [r, g, b, a] = reader.getImageData(0, 0, 1, 1).data;
  return a < 128 ? null : { r, g, b };
}

/** The shown copy's pixel under a point (0–1 across and down): quick, for hovering. */
function viewPixel(view: ImageData, at: Point) {
  const x = Math.min(view.width - 1, Math.floor(at.x * view.width));
  const y = Math.min(view.height - 1, Math.floor(at.y * view.height));
  const index = (y * view.width + x) * 4;
  const { data } = view;
  return data[index + 3] < 128 ? null : { r: data[index], g: data[index + 1], b: data[index + 2] };
}

async function sheetPng(swatches: Swatch[]) {
  const sheet = swatchSheet(swatches);
  const scale = 2;
  const canvas = canvasOf({ width: sheet.width * scale, height: sheet.height * scale });
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser couldn’t draw the swatches.');
    context.scale(scale, scale);
    for (const shape of sheet.shapes) {
      context.fillStyle = shape.fill;
      if (shape.kind === 'rect') {
        context.beginPath();
        if (typeof context.roundRect === 'function')
          context.roundRect(shape.x, shape.y, shape.width, shape.height, shape.radius);
        else context.rect(shape.x, shape.y, shape.width, shape.height);
        context.fill();
      } else {
        const family = shape.mono ? SHEET_FONTS.mono : SHEET_FONTS.sans;
        context.font = `${shape.weight} ${shape.size}px ${family}`;
        context.fillText(shape.text, shape.x, shape.y);
      }
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Couldn’t make the PNG.');
    return blob;
  } finally {
    freeCanvas(canvas);
  }
}

/* ---------------- samples, drawn on this device ---------------- */

async function toFile(canvas: HTMLCanvasElement, name: string, type: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  freeCanvas(canvas);
  if (!blob) throw new Error('No sample');
  return new File([blob], name, { type });
}

/** A sunset over the water: bold, photo-like color. */
function sampleSunset() {
  const width = 1600;
  const height = 1100;
  const canvas = canvasOf({ width, height });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  let seed = 5;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const horizon = height * 0.6;
  const sky = context.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#2b1b4d');
  sky.addColorStop(0.45, '#8a2f6e');
  sky.addColorStop(0.75, '#e2555a');
  sky.addColorStop(1, '#f7a24e');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizon);
  context.fillStyle = '#ffd166';
  context.beginPath();
  context.arc(width * 0.62, horizon, 150, Math.PI, 0);
  context.fill();
  context.fillStyle = '#4a2358';
  context.beginPath();
  context.moveTo(0, horizon);
  for (let x = 0; x <= width * 0.45; x += 20)
    context.lineTo(x, horizon - 120 - Math.sin(x / 90) * 40 - (x < width * 0.25 ? x * 0.2 : 0));
  context.lineTo(width * 0.45, horizon);
  context.fill();
  const sea = context.createLinearGradient(0, horizon, 0, height);
  sea.addColorStop(0, '#1f3b63');
  sea.addColorStop(1, '#0d1b33');
  context.fillStyle = sea;
  context.fillRect(0, horizon, width, height - horizon);
  for (let line = 0; line < 260; line += 1) {
    const y = horizon + random() ** 1.4 * (height - horizon);
    const spread = 60 + (y - horizon) * 0.9;
    context.fillStyle = random() > 0.4 ? '#f7a24e' : '#ffd166';
    context.globalAlpha = 0.35 + random() * 0.5;
    context.fillRect(
      width * 0.62 - spread / 2 + (random() - 0.5) * spread,
      y,
      20 + random() * 70,
      3,
    );
  }
  context.globalAlpha = 1;
  context.fillStyle = '#120c1f';
  context.beginPath();
  context.moveTo(0, height);
  context.quadraticCurveTo(width * 0.3, height * 0.84, width * 0.62, height * 0.94);
  context.quadraticCurveTo(width * 0.85, height * 0.99, width, height * 0.9);
  context.lineTo(width, height);
  context.fill();
  return toFile(canvas, 'sample-sunset.jpg', 'image/jpeg');
}

/** A made-up brand mark on a transparent background: flat colors, clean edges. */
function sampleLogo() {
  const size = 1200;
  const canvas = canvasOf({ width: size, height: size });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  context.save();
  context.beginPath();
  context.arc(600, 500, 360, 0, Math.PI * 2);
  context.fillStyle = '#E4572E';
  context.fill();
  context.clip();
  context.fillStyle = '#1D3557';
  context.beginPath();
  context.moveTo(200, 620);
  for (let x = 200; x <= 1000; x += 10) context.lineTo(x, 600 + Math.sin(x / 70) * 34);
  context.lineTo(1000, 900);
  context.lineTo(200, 900);
  context.fill();
  context.strokeStyle = '#F1FAEE';
  context.lineWidth = 18;
  context.lineCap = 'round';
  context.beginPath();
  for (let x = 240; x <= 960; x += 10) context.lineTo(x, 720 + Math.sin(x / 70 + 1) * 24);
  context.stroke();
  context.fillStyle = '#F1FAEE';
  context.beginPath();
  context.arc(760, 330, 70, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.fillStyle = '#1D3557';
  context.font = '800 108px system-ui, -apple-system, sans-serif';
  context.textAlign = 'center';
  context.fillText('SALT & EMBER', 600, 1060);
  return toFile(canvas, 'sample-logo.png', 'image/png');
}

/* ---------------- the room ---------------- */

const ROOM_VARS = {
  '--accent': 'accent',
  '--glow': 'glow',
  '--third': 'third',
  '--accent-ink': 'accentInk',
  '--on-accent': 'onAccent',
} as const satisfies Record<string, keyof RoomColors>;

/**
 * The picture lights the room: its most vivid color becomes the page's accent, a second its glow.
 * Set on the tool's world (`.tool-world`) and put back as it was on a new image, a reset or on
 * leaving. Outside a tool page (inside a Space) there's no world to light, so nothing happens.
 */
function useRoom(anchor: RefObject<HTMLElement | null>, room: RoomColors | null) {
  const key = room ? Object.values(room).join(' ') : '';
  useEffect(() => {
    const world = anchor.current?.closest<HTMLElement>('.tool-world');
    if (!world || !room) return;
    const before = Object.keys(ROOM_VARS).map(
      (name) => [name, world.style.getPropertyValue(name)] as const,
    );
    for (const [name, field] of Object.entries(ROOM_VARS))
      world.style.setProperty(name, room[field]);
    world.dataset.lit = '';
    return () => {
      for (const [name, value] of before)
        if (value) world.style.setProperty(name, value);
        else world.style.removeProperty(name);
      delete world.dataset.lit;
    };
    // `key` stands for `room`: the same colors needn't repaint the room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, anchor]);
}

/** One tap, one copy, confirmed on the thing tapped (and to screen readers), not in a toast. */
function useTapCopy() {
  const toast = useToast();
  const [copied, setCopied] = useState<{ key: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      clearTimeout(timer.current);
      setCopied({ key, text });
      timer.current = setTimeout(() => setCopied(null), 1500);
      return true;
    } catch {
      toast({ title: 'Couldn’t copy. Select the text and copy it instead.', icon: 'alert' });
      return false;
    }
  };
  return { copy, copied: copied?.key ?? null, text: copied?.text ?? '' };
}

/* ---------------- the tool ---------------- */

const FORMATS = [
  { value: 'hex', label: 'HEX' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
] as const;
type ColorFormat = (typeof FORMATS)[number]['value'];

const valueIn = (format: ColorFormat, entry: Swatch) =>
  format === 'rgb' ? formatRgb(entry.rgb) : format === 'hsl' ? formatHsl(entry.rgb) : entry.hex;

export function PaletteTool() {
  const toast = useToast();
  const [image, setImage] = useState<Loaded | null>(null);
  const [opening, setOpening] = useState(false);
  const [count, setCount] = useState(DEFAULT_COLORS);
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [hidden, setHidden] = useState<string[]>([]);
  const [added, setAdded] = useState<Added[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [typing, setTyping] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [flash, setFlash] = useState(false);
  const current = useRef<Loaded | null>(null);
  const opener = useRef<(files: File[]) => void>(() => {});
  const root = useRef<HTMLDivElement>(null);
  const imagePanel = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { copy, copied, text: copiedText } = useTapCopy();

  const found = useMemo(() => (image ? extractPalette(image.sample, count) : []), [image, count]);
  const palette = useMemo(() => {
    const list: Entry[] = found
      .filter((swatch) => !hidden.includes(swatch.hex))
      .map((swatch) => ({
        ...swatch,
        key: `found-${swatch.hex}`,
        kind: 'found',
        at: image ? locateColor(image.sample, swatch.rgb) : null,
      }));
    for (const color of added)
      if (!list.some((entry) => entry.hex === color.hex))
        list.push({
          ...color,
          key: `added-${color.hex}`,
          kind: color.typed ? 'typed' : 'picked',
        });
    return list;
  }, [found, hidden, added, image]);
  const pairs = useMemo(() => readablePairs(palette.map((entry) => entry.rgb)), [palette]);
  // The room takes its light from the colors found in the picture.
  const room = useMemo(() => roomColors(found.map((swatch) => swatch.rgb)), [found]);
  useRoom(root, room);

  useEffect(() => {
    const holder = current;
    const timer = flashTimer;
    return () => {
      release(holder.current);
      clearTimeout(timer.current);
    };
  }, []);

  async function load(file: File) {
    setOpening(true);
    setMessage('');
    try {
      const next = await openImage(file);
      release(current.current);
      current.current = next;
      setImage(next);
      setHidden([]);
      setAdded([]);
      setTyping(false);
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
    if (!file || opening) return;
    if (!file.type.startsWith('image/') && !READABLE.test(file.name))
      return setMessage(`${file.name} isn’t an image this tool can open. Try a JPG, PNG or WebP.`);
    if (file.size > MAX_BYTES)
      return setMessage(`${file.name} is over 40 MB. Try a smaller copy of it.`);
    void load(file);
  }

  // An image pasted anywhere on the page (⌘V / Ctrl+V) opens too; once one is open, so does an
  // image dropped anywhere (before that, the drop target catches it).
  useLayoutEffect(() => {
    opener.current = open;
  });
  // A photo carried over from another tool (Resize's "Make social sizes") opens at once.
  useEffect(() => {
    const carried = takeCarried('palette');
    if (carried) opener.current([carried.file]);
  }, []);
  const loaded = image !== null;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith('image/'),
      );
      if (!file) return;
      event.preventDefault();
      opener.current([file]);
    };
    const onOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      opener.current(Array.from(event.dataTransfer.files));
    };
    window.addEventListener('paste', onPaste);
    if (loaded) {
      window.addEventListener('dragover', onOver);
      window.addEventListener('drop', onDrop);
    }
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [loaded]);

  async function trySample(make: () => Promise<File>) {
    if (opening) return;
    setOpening(true);
    try {
      await load(await make());
    } catch {
      setOpening(false);
      setMessage('Couldn’t draw a sample here. Choose an image of your own.');
    }
  }

  function clear() {
    release(current.current);
    current.current = null;
    setImage(null);
    setHidden([]);
    setAdded([]);
    setTyping(false);
    setMessage('');
  }

  function add(color: Added) {
    const known = palette.find((entry) => entry.hex === color.hex);
    if (known) {
      setFocus(known.key);
      toast({ title: `${color.hex} is already in the palette` });
      return;
    }
    if (added.length >= MAX_ADDED) {
      toast({ title: `Up to ${MAX_ADDED} added colors. Remove one first.`, icon: 'alert' });
      return;
    }
    setAdded([...added, color]);
  }

  function pickAt(at: Point) {
    if (!image) return;
    const { source } = image;
    const x = Math.min(source.width - 1, Math.floor(at.x * source.width));
    const y = Math.min(source.height - 1, Math.floor(at.y * source.height));
    const rgb = exactPixel(source, x, y);
    if (!rgb) {
      setMessage('That spot is see-through. Tap a colored part of the image.');
      return;
    }
    setMessage('');
    const hex = rgbToHex(rgb);
    add({ hex, rgb, share: shareNear(image.sample, rgb), at, typed: false });
  }

  function remove(entry: Entry) {
    if (entry.kind === 'found') setHidden([...hidden, entry.hex]);
    else setAdded(added.filter((color) => color.hex !== entry.hex));
  }

  /** "From the image": bring the image into view and point at it. */
  function pointAtImage() {
    imagePanel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setNudge((value) => value + 1);
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 2800);
  }

  if (!image)
    return (
      <div ref={root} className="mx-auto grid w-full max-w-[640px] gap-3 pt-2 pb-6 sm:pt-4">
        <DropObject
          shape="photo"
          accept={ACCEPT}
          onFiles={open}
          art={<PaletteArt busy={opening} />}
          title={opening ? 'Pulling the colors…' : 'Drop an image'}
          hint="Or paste one."
        >
          <div className="mt-3 grid w-full grid-cols-2 gap-2.5">
            {SAMPLES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => trySample(sample.make)}
                disabled={opening}
                aria-label={`Try a sample ${sample.label.toLowerCase()}`}
                className="fx-move group min-w-0 overflow-hidden rounded-[18px] bg-surface text-left shadow-[inset_0_0_0_1px_var(--color-line)] hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1.5px_var(--accent-ink)] active:scale-[.98] disabled:opacity-50"
              >
                <sample.Thumb className="block aspect-[16/8] w-full" />
                <span className="flex min-h-11 items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-[14px] font-semibold text-ink">
                    <span className="font-normal text-muted">Try a </span>
                    {sample.label.toLowerCase()}
                  </span>
                  <span aria-hidden="true" className="flex shrink-0 -space-x-1.5">
                    {sample.colors.map((hex) => (
                      <span
                        key={hex}
                        className="size-4 rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
                        style={{ background: hex }}
                      />
                    ))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </DropObject>
        <p role="status" className="min-h-5 text-center text-[13.5px] text-ink-2 empty:hidden">
          {message}
        </p>
      </div>
    );

  const stem = slugName(image.name.replace(/\.[^.]+$/, ''), 'image');
  const shortfall = found.length < count;
  const picked = added.some((color) => !color.typed);
  const allText = palette.map((entry) => valueIn(format, entry)).join('\n');

  return (
    <div
      ref={root}
      className="grid gap-x-8 gap-y-5 pb-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:items-start"
    >
      <style>{ROOM_FADE}</style>
      <p className="sr-only" aria-live="polite">
        {copied ? `Copied ${copiedText}` : ''}
      </p>

      {/* The payoff: how many colors came out of the picture. */}
      <header className="min-w-0 lg:col-start-2 lg:row-start-1 lg:pt-4">
        <p className="fx-pop inline-flex max-w-full items-center gap-2 rounded-full bg-ink/[.06] py-1.5 pr-3.5 pl-2 text-[13.5px] font-medium text-ink-2">
          <span
            className="grid size-5 shrink-0 place-items-center rounded-full text-[var(--on-accent,#12110d)]"
            style={{ background: ACCENT }}
          >
            <Icon name="check" size={12} strokeWidth={3} />
          </span>
          <span className="truncate">From {image.name}</span>
        </p>
        <h2
          aria-live="polite"
          className="fx-stamp mt-3 font-display text-[52px] leading-[.9] font-extrabold tracking-[-0.045em] text-ink sm:text-[76px]"
          style={{ fontVariationSettings: "'wdth' 112" }}
        >
          <CountUp value={palette.length} duration={500} className={DISPLAY_NUMBER} />{' '}
          {palette.length === 1 ? 'color' : 'colors'}
          <span className="block text-[var(--accent-ink)]">pulled</span>
        </h2>
        <p className="mt-3 text-[15.5px] text-ink-2">Tap a color to copy it.</p>
      </header>

      {/* The object: the picture, and its colors coming out of it. */}
      <div
        ref={imagePanel}
        className="min-w-0 scroll-mt-24 lg:col-start-1 lg:row-span-3 lg:row-start-1"
      >
        <Stage material="paper" className="z-10 grid gap-2.5 !p-2.5 sm:!p-3">
          <Picker
            image={image}
            palette={palette}
            focus={focus}
            hint={!picked || flash}
            nudge={nudge}
            onPick={pickAt}
            onFocus={setFocus}
          />
          {palette.length > 0 && <ShareBar palette={palette} focus={focus} />}
          <ImageBar image={image} busy={opening} onReplace={open} onRemove={clear} />
        </Stage>

        {palette.length === 0 && (
          <p className="mt-4 rounded-[16px] bg-ink/[.05] px-4 py-5 text-center text-[14px] text-muted">
            This image is entirely see-through, so there are no colors to find. Add one of your own.
          </p>
        )}

        <ul
          key={image.name + image.size.width + image.size.height}
          aria-label="The colors"
          className="mt-3 grid gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(76px,1fr))] sm:gap-2"
        >
          {palette.map((entry, index) => (
            <SwatchChip
              key={entry.key}
              entry={entry}
              index={index}
              value={valueIn(format, entry)}
              copied={copied === entry.key}
              focused={focus === entry.key}
              onCopy={() => copy(entry.key, valueIn(format, entry))}
              onFocus={setFocus}
              onRemove={() => remove(entry)}
            />
          ))}
          <li className="fx-emerge min-w-0" style={{ '--i': palette.length } as CSSProperties}>
            <div className="grid h-full grid-cols-2 gap-1 rounded-[18px] border-[1.5px] border-dashed border-line-strong p-1 sm:min-h-[176px] sm:grid-cols-1 sm:content-center">
              <button
                type="button"
                onClick={pointAtImage}
                className="flex min-h-12 items-center justify-center gap-2 rounded-[13px] px-2 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink sm:flex-col sm:gap-1"
              >
                <Icon name="pipette" size={18} className="shrink-0 text-[var(--accent-ink)]" />
                Pick one
              </button>
              <button
                type="button"
                aria-expanded={typing}
                onClick={() => setTyping(!typing)}
                className="flex min-h-12 items-center justify-center gap-2 rounded-[13px] px-2 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink sm:flex-col sm:gap-1"
              >
                <Icon name="hash" size={18} className="shrink-0 text-[var(--accent-ink)]" />
                Type a code
              </button>
            </div>
          </li>
        </ul>

        {typing && (
          <AddColor
            onClose={() => setTyping(false)}
            onAdd={(color) =>
              add({ ...color, share: shareNear(image.sample, color.rgb), at: null, typed: true })
            }
          />
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <FormatSwitch value={format} onChange={setFormat} />
          <Stepper count={count} onChange={setCount} />
        </div>

        <p role="status" className="mt-2 text-[13px] text-muted empty:hidden">
          {message}
        </p>
        {(shortfall || hidden.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
            {shortfall && (
              <span>
                {found.length === 1
                  ? 'This image has just one main color.'
                  : `This image has ${found.length} main colors.`}
              </span>
            )}
            {hidden.length > 0 && (
              <button
                type="button"
                onClick={() => setHidden([])}
                className="min-h-11 font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
              >
                Bring back {hidden.length} removed
              </button>
            )}
          </div>
        )}
      </div>

      {palette.length > 0 && (
        <>
          <Exports
            className="lg:col-start-2 lg:row-start-2"
            palette={palette}
            stem={stem}
            format={format}
            allText={allText}
            copy={copy}
            copied={copied}
          />
          <Pairs className="lg:col-start-2 lg:row-start-3" palette={palette} pairs={pairs} />
        </>
      )}
    </div>
  );
}

const ACCENT = 'var(--accent, #ff7ab6)';
/** A counting number in the headline's own type (CountUp is monospaced by default). */
const DISPLAY_NUMBER =
  '![font-family:inherit] ![font-variation-settings:inherit] ![letter-spacing:inherit]';

/** The room's light eases from one picture's colors to the next rather than jumping. */
const ROOM_FADE = `
@property --accent { syntax: '<color>'; inherits: true; initial-value: #ff7ab6; }
@property --glow { syntax: '<color>'; inherits: true; initial-value: #ffd166; }
.tool-world { transition: --accent .6s ease, --glow .6s ease; }
@media (prefers-reduced-motion: reduce) { .tool-world { transition: none; } }
`;

const SAMPLES = [
  {
    label: 'Photo',
    make: sampleSunset,
    Thumb: SunsetThumb,
    colors: ['#8a2f6e', '#e2555a', '#ffd166'],
  },
  { label: 'Logo', make: sampleLogo, Thumb: LogoThumb, colors: ['#E4572E', '#1D3557', '#F1FAEE'] },
];

/* ---------------- parts ---------------- */

function ImageBar({
  image,
  busy,
  onReplace,
  onRemove,
}: {
  image: Loaded;
  busy: boolean;
  onReplace: (files: File[]) => void;
  onRemove: () => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 px-1">
      <p className="min-w-0 flex-1 truncate text-[13px] text-muted">
        <span className="font-medium text-ink-2">{image.name}</span>
        <span className="mono-num ml-2 text-[11.5px]">
          {image.size.width}×{image.size.height}
        </span>
      </p>
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
          'inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-ink/[.06] px-3.5 text-[14px] font-medium text-ink-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent-ink)] hover:bg-ink/10 hover:text-ink lg:h-10 lg:text-[13.5px]',
          busy && 'pointer-events-none opacity-45',
        )}
      >
        <Icon name={busy ? 'loader' : 'replace'} size={15} className={cn(busy && 'animate-spin')} />
        New image
      </label>
      <IconButton icon="x" label="Remove the image" onClick={onRemove} disabled={busy} />
    </div>
  );
}

/** How much of the picture each color covers: the strip the swatches come out of. */
function ShareBar({ palette, focus }: { palette: Entry[]; focus: string | null }) {
  return (
    <div
      role="img"
      aria-label={`How much of the image each color covers: ${palette
        .map((entry) => `${entry.hex} ${formatShare(entry.share)}`)
        .join(', ')}`}
      className="flex h-2 gap-[2px] overflow-hidden rounded-full"
    >
      {palette.map((entry) => (
        <span
          key={entry.key}
          className={cn('fx-move h-full min-w-2', focus && focus !== entry.key && 'opacity-40')}
          style={{ background: entry.hex, flexGrow: Math.max(entry.share, 0.025) }}
        />
      ))}
    </div>
  );
}

/** The image, with an eyedropper: hover to preview a color, tap or click to add it. */
function Picker({
  image,
  palette,
  focus,
  hint,
  nudge,
  onPick,
  onFocus,
}: {
  image: Loaded;
  palette: Entry[];
  focus: string | null;
  /** Show "Tap to add a color" on the image. */
  hint: boolean;
  /** Changes when the hint should play again. */
  nudge: number;
  onPick: (at: Point) => void;
  onFocus: (key: string | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<(Point & { hex: string | null; touch: boolean }) | null>(null);
  const { view } = image;

  useEffect(() => {
    const element = canvas.current;
    element?.getContext('2d')?.putImageData(view, 0, 0);
  }, [view]);

  // A tap shows the color it took for a moment.
  useEffect(() => {
    if (!hover?.touch) return;
    const timer = setTimeout(() => setHover(null), 900);
    return () => clearTimeout(timer);
  }, [hover]);

  const where = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };
  const preview = (at: Point, touch: boolean) => {
    const rgb = viewPixel(view, at);
    setHover({ ...at, hex: rgb ? rgbToHex(rgb) : null, touch });
  };

  return (
    <div className="grid place-items-center overflow-hidden rounded-[18px] bg-ink/[.04]">
      <div
        className="fx-pop relative max-w-full overflow-hidden"
        style={{
          backgroundImage: 'repeating-conic-gradient(#dcd8d0 0% 25%, #ffffff 0% 50%)',
          backgroundSize: '16px 16px',
        }}
      >
        <canvas
          ref={canvas}
          width={view.width}
          height={view.height}
          role="img"
          aria-label={`${image.name}. Tap anywhere to add that color to the palette.`}
          onPointerDown={(event) => {
            press.current = { x: event.clientX, y: event.clientY };
            if (event.pointerType !== 'mouse') preview(where(event), true);
          }}
          onPointerMove={(event) => {
            if (event.pointerType === 'mouse') preview(where(event), false);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setHover(null);
          }}
          onPointerUp={(event) => {
            const start = press.current;
            press.current = null;
            // A tap or a click, not the start of a scroll.
            if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
            onPick(where(event));
          }}
          className="block h-auto max-h-[min(46vh,420px)] w-auto max-w-full cursor-crosshair touch-manipulation lg:max-h-[min(58vh,520px)]"
        />
        {palette.map(
          (entry) =>
            entry.at && (
              <span
                key={entry.key}
                aria-hidden="true"
                onPointerEnter={() => onFocus(entry.key)}
                onPointerLeave={() => onFocus(null)}
                className={cn(
                  'fx-move absolute -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_#fff,0_2px_8px_rgb(0_0_0/.45)]',
                  focus === entry.key ? 'z-10 size-7' : 'size-3.5',
                )}
                style={{
                  left: `${entry.at.x * 100}%`,
                  top: `${entry.at.y * 100}%`,
                  background: entry.hex,
                }}
              />
            ),
        )}
        {hint && !hover && (
          <span
            key={nudge}
            aria-hidden="true"
            className="fx-pop pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#12110d]/80 py-1.5 pr-3.5 pl-1.5 text-[13px] font-medium whitespace-nowrap text-white shadow-[0_8px_24px_-8px_rgb(0_0_0/.6)]"
          >
            <span
              className="grid size-6 place-items-center rounded-full text-[var(--on-accent,#12110d)]"
              style={{ background: ACCENT }}
            >
              <Icon name="pipette" size={13} />
            </span>
            Tap the picture to add a color
          </span>
        )}
        {hover && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute z-20 flex -translate-x-1/2 flex-col items-center gap-1"
            style={{
              left: `${hover.x * 100}%`,
              top: `${hover.y * 100}%`,
              transform: `translate(-50%, calc(-100% - ${hover.touch ? 36 : 18}px))`,
            }}
          >
            <span
              className="size-12 rounded-full shadow-[0_0_0_3px_#fff,0_6px_18px_rgb(0_0_0/.5)]"
              style={
                hover.hex
                  ? { background: hover.hex }
                  : ({
                      backgroundImage: 'repeating-conic-gradient(#dcd8d0 0% 25%, #fff 0% 50%)',
                      backgroundSize: '10px 10px',
                    } as CSSProperties)
              }
            />
            <span className="mono-num rounded-full bg-[#12110d] px-2 py-0.5 text-[11px] text-white">
              {hover.hex ?? 'See-through'}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function FormatSwitch({
  value,
  onChange,
}: {
  value: ColorFormat;
  onChange: (value: ColorFormat) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show colors as"
      className="flex shrink-0 rounded-full bg-ink/[.06] p-1"
    >
      {FORMATS.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'fx-move mono-num h-10 min-w-[52px] rounded-full px-3 text-[12.5px] font-semibold tracking-[.04em] lg:h-9',
              on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Stepper({ count, onChange }: { count: number; onChange: (count: number) => void }) {
  return (
    <div
      role="group"
      aria-label="How many colors to find"
      className="flex shrink-0 items-center rounded-full bg-ink/[.06] p-1"
    >
      <button
        type="button"
        aria-label="Fewer colors"
        disabled={count <= MIN_COLORS}
        onClick={() => onChange(count - 1)}
        className="grid size-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface hover:text-ink disabled:opacity-35 lg:size-9"
      >
        <Icon name="minus" size={16} />
      </button>
      <span className="mono-num w-[64px] text-center text-[12.5px] text-ink-2" aria-live="polite">
        Up to {count}
      </span>
      <button
        type="button"
        aria-label="More colors"
        disabled={count >= MAX_COLORS}
        onClick={() => onChange(count + 1)}
        className="grid size-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface hover:text-ink disabled:opacity-35 lg:size-9"
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

/** Text that reads on a color: near-white or near-black. */
const inkOn = (entry: Swatch) => (textOn(entry.rgb).text === 'white' ? '#FFFFFF' : '#12110d');

/**
 * A color, big, out of the picture: tap it to copy. The swatch itself says it took ("Copied"),
 * a stripe on a phone and a tall chip on a larger screen.
 */
function SwatchChip({
  entry,
  index,
  value,
  copied,
  focused,
  onCopy,
  onFocus,
  onRemove,
}: {
  entry: Entry;
  index: number;
  value: string;
  copied: boolean;
  focused: boolean;
  onCopy: () => void;
  onFocus: (key: string | null) => void;
  onRemove: () => void;
}) {
  const ink = inkOn(entry);
  const name = colorName(entry.rgb);
  const share =
    entry.kind === 'typed' && entry.share === 0
      ? 'Not in the image'
      : `Covers ${formatShare(entry.kind === 'picked' ? Math.max(entry.share, 0.001) : entry.share)}`;
  return (
    <li
      onPointerEnter={() => onFocus(entry.key)}
      onPointerLeave={() => onFocus(null)}
      className="fx-emerge relative min-w-0"
      style={{ '--i': index } as CSSProperties}
    >
      <button
        type="button"
        onClick={onCopy}
        aria-label={`${name}, ${value}, ${share}. Copy`}
        className={cn(
          'fx-move relative flex h-[68px] w-full items-center justify-between gap-3 overflow-hidden rounded-[18px] py-2 pr-14 pl-4 text-left shadow-[inset_0_0_0_1px_rgb(0_0_0/.12)] active:scale-[.97] sm:h-[176px] sm:flex-col sm:items-start sm:p-3 sm:pr-3 sm:hover:-translate-y-1',
          focused &&
            'shadow-[inset_0_0_0_1px_rgb(0_0_0/.12),0_0_0_3px_var(--color-canvas),0_0_0_5px_var(--accent-ink)]',
          copied && 'fx-ping',
        )}
        style={{ background: entry.hex, color: ink }}
      >
        <span className="min-w-0 sm:w-full sm:pr-4">
          <span
            className="block truncate font-display text-[17px] leading-tight font-bold tracking-[-0.02em] sm:overflow-visible sm:text-[14.5px] sm:whitespace-normal"
            style={{ fontVariationSettings: "'wdth' 106" }}
          >
            {name}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[12px] leading-tight opacity-75">
            {entry.kind !== 'found' && (
              <Icon name={entry.kind === 'picked' ? 'pipette' : 'hash'} size={11} />
            )}
            {share}
          </span>
        </span>
        <span className="mono-num shrink-0 text-[13px] font-semibold tracking-[0.01em] sm:text-[12.5px] sm:[overflow-wrap:anywhere]">
          {value}
        </span>
        {copied && (
          <span
            aria-hidden="true"
            className="fx-pop absolute inset-0 flex items-center justify-center gap-2 text-[15px] font-bold sm:flex-col sm:gap-1.5"
            style={{ background: entry.hex }}
          >
            <span
              className="grid size-8 place-items-center rounded-full"
              style={{ background: ink, color: entry.hex }}
            >
              <Icon name="check" size={17} strokeWidth={3} />
            </span>
            Copied
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entry.hex}`}
        title="Remove"
        className="absolute top-1/2 right-1.5 grid size-11 -translate-y-1/2 place-items-center rounded-full opacity-55 transition-opacity hover:opacity-100 focus-visible:opacity-100 sm:-top-0.5 sm:-right-0.5 sm:size-9 sm:translate-y-0"
        style={{ color: ink }}
      >
        <Icon name="x" size={16} />
      </button>
    </li>
  );
}

function AddColor({ onAdd, onClose }: { onAdd: (color: Swatch) => void; onClose: () => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const rgb = hexToRgb(text);
    if (!rgb) return setError('That doesn’t look like a color code. Try one like #1D3557.');
    onAdd({ hex: rgbToHex(rgb), rgb, share: 0 });
    setText('');
    setError('');
  };
  const preview = hexToRgb(text);
  return (
    <form onSubmit={submit} className="fx-pop mt-2 grid gap-2">
      <label htmlFor={`${id}-hex`} className="sr-only">
        A color code
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-6 -translate-y-1/2 rounded-full shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
            style={{ background: preview ? rgbToHex(preview) : 'transparent' }}
          />
          <input
            id={`${id}-hex`}
            placeholder="#1D3557"
            value={text}
            maxLength={9}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="done"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError('');
            }}
            className="mono-num h-12 w-full rounded-full bg-surface pr-3 pl-12 text-[16px] text-ink uppercase shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint placeholder:normal-case focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
          />
        </div>
        <button
          type="submit"
          disabled={!text.trim()}
          className="inline-flex h-12 items-center gap-1.5 rounded-full px-5 text-[15px] font-semibold text-[var(--on-accent,#12110d)] transition-opacity disabled:opacity-40"
          style={{ background: ACCENT }}
        >
          <Icon name="plus" size={16} /> Add
        </button>
        <IconButton icon="x" label="Close" onClick={onClose} className="!size-12" />
      </div>
      {error && (
        <p id={`${id}-error`} className="px-2 text-[13px] text-critical">
          {error}
        </p>
      )}
    </form>
  );
}

const PAIR_LINES = ['Easy to read', 'Clear at a glance', 'Headline ready', 'Reads well small'];

/** Which colors can carry text on each other, shown as text on color. */
function Pairs({
  palette,
  pairs,
  className,
}: {
  palette: Entry[];
  pairs: ReturnType<typeof readablePairs>;
  className?: string;
}) {
  const id = useId();
  const [all, setAll] = useState(false);
  const shown = all ? pairs : pairs.slice(0, 4);
  return (
    <section className={cn('grid min-w-0 gap-3', className)} aria-labelledby={`${id}-pairs`}>
      <div>
        <h3 id={`${id}-pairs`} className="text-[15px] font-semibold text-ink">
          Easy to read together
        </h3>
        {!pairs.length && (
          <p className="mt-1 text-[13.5px] text-muted">
            None of these are far enough apart to carry small text on each other.
          </p>
        )}
      </div>
      {pairs.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {shown.map((pair, index) => {
            const back = palette[pair.first];
            const front = palette[pair.second];
            return (
              <li
                key={`${back.key}-${front.key}`}
                aria-label={`${colorName(front.rgb)} text on ${colorName(back.rgb).toLowerCase()} (${front.hex} on ${back.hex}), contrast ${formatRatio(pair.ratio)}`}
                className="fx-rise flex min-h-[112px] min-w-0 flex-col justify-between gap-2 rounded-[18px] p-3.5 shadow-[inset_0_0_0_1px_rgb(0_0_0/.12)]"
                style={{ background: back.hex, color: front.hex, '--i': index } as CSSProperties}
              >
                <span aria-hidden="true">
                  <span
                    className="block font-display text-[30px] leading-none font-bold tracking-[-0.03em]"
                    style={{ fontVariationSettings: "'wdth' 110" }}
                  >
                    Aa
                  </span>
                  <span className="mt-1 block text-[14px] leading-tight font-semibold">
                    {PAIR_LINES[index % PAIR_LINES.length]}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="mono-num flex items-center gap-1.5 text-[11px] opacity-80"
                >
                  {formatRatio(pair.ratio)}
                  <span className="rounded-full px-1.5 py-px text-[10px] font-semibold shadow-[inset_0_0_0_1px_currentColor]">
                    {contrastLevel(pair.ratio)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {pairs.length > 4 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="min-h-11 justify-self-start text-[14px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
        >
          {all ? 'Show fewer' : `Show all ${pairs.length}`}
        </button>
      )}
    </section>
  );
}

const CODES = [
  { value: 'css', label: 'CSS variables' },
  { value: 'tailwind', label: 'Tailwind' },
  { value: 'json', label: 'JSON' },
] as const;
type Code = ColorFormat | (typeof CODES)[number]['value'];
const CODE_NAMES: Record<Code, string> = {
  hex: 'HEX codes',
  rgb: 'RGB',
  hsl: 'HSL',
  css: 'CSS variables',
  tailwind: 'Tailwind',
  json: 'JSON',
};

function codeFor(format: Code, palette: Entry[]) {
  const hexes = palette.map((entry) => entry.hex);
  if (format === 'hex') return hexes.join('\n');
  if (format === 'rgb') return palette.map((entry) => formatRgb(entry.rgb)).join('\n');
  if (format === 'hsl') return palette.map((entry) => formatHsl(entry.rgb)).join('\n');
  if (format === 'css') return cssVariables(hexes);
  if (format === 'tailwind') return tailwindTheme(hexes);
  return paletteJson(palette.map(({ hex, rgb, share }) => ({ hex, rgb, share })));
}

/**
 * The whole palette in a tap: every color in the chosen format (the big button), for code, or as a
 * picture of the swatches.
 */
function Exports({
  palette,
  stem,
  format,
  allText,
  copy,
  copied,
  className,
}: {
  palette: Entry[];
  stem: string;
  format: ColorFormat;
  allText: string;
  copy: (key: string, text: string) => Promise<boolean>;
  copied: string | null;
  className?: string;
}) {
  const toast = useToast();
  const [shown, setShown] = useState<Code>('css');
  const code = codeFor(shown, palette);

  const savePng = async () => {
    try {
      download(await sheetPng(palette), `${stem}-palette.png`);
      toast({ title: 'Swatches downloaded', description: `${stem}-palette.png`, icon: 'download' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Couldn’t make the PNG.',
        icon: 'alert',
      });
    }
  };
  const saveSvg = () => {
    downloadText(sheetSvg(swatchSheet(palette)), `${stem}-palette.svg`, 'image/svg+xml');
    toast({ title: 'Swatches downloaded', description: `${stem}-palette.svg`, icon: 'download' });
  };

  const chip =
    'fx-move inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium active:scale-[.97] lg:min-h-10';
  const allDone = copied === 'all';

  return (
    <section className={cn('grid min-w-0 gap-3', className)} aria-label="Use the palette">
      <ActionBar className="!mt-0 from-canvas via-canvas/95 sm:!pt-0">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => copy('all', allText)}
            aria-label={`Copy all ${palette.length} as ${CODE_NAMES[format]}`}
            className={cn(
              'fx-move inline-flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-5 text-[16.5px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_16px_32px_-18px_var(--accent)] active:scale-[.97]',
              allDone && 'fx-ping',
            )}
            style={{ background: ACCENT }}
          >
            <Icon name={allDone ? 'check' : 'copy'} size={19} strokeWidth={allDone ? 3 : 2} />
            {allDone ? 'Copied' : `Copy all ${palette.length}`}
            <span className="mono-num text-[12.5px] font-bold opacity-70">
              {format.toUpperCase()}
            </span>
          </button>
          <button
            type="button"
            onClick={savePng}
            aria-label="Save the swatches as a picture"
            className="fx-move inline-flex h-14 shrink-0 items-center gap-2 rounded-full bg-surface px-5 text-[15px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.04] active:scale-[.97]"
          >
            <Icon name="download" size={18} />
            <span className="max-sm:sr-only">Picture</span>
          </button>
        </div>
      </ActionBar>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-0.5 text-[13.5px] text-muted">Copy as</span>
        {CODES.map((option) => {
          const done = copied === `code-${option.value}`;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={`Copy as ${option.label}`}
              onClick={() => {
                setShown(option.value);
                void copy(`code-${option.value}`, codeFor(option.value, palette));
              }}
              className={cn(
                chip,
                done
                  ? 'fx-ping text-[var(--on-accent,#12110d)]'
                  : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10 hover:text-ink',
              )}
              style={done ? { background: ACCENT } : undefined}
            >
              <Icon name={done ? 'check' : 'braces'} size={15} />
              {done ? 'Copied' : option.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={saveSvg}
          className={cn(chip, 'bg-ink/[.06] text-ink-2 hover:bg-ink/10 hover:text-ink')}
        >
          <Icon name="download" size={15} /> SVG
        </button>
      </div>

      <Advanced summary={`See the code · ${CODE_NAMES[shown]}`}>
        <div className="grid gap-2">
          <div role="radiogroup" aria-label="Code to show" className="flex flex-wrap gap-1.5">
            {(Object.keys(CODE_NAMES) as Code[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={shown === value}
                onClick={() => setShown(value)}
                className={cn(
                  'min-h-10 rounded-full px-3 text-[13px] font-medium',
                  shown === value
                    ? 'bg-ink text-on-ink'
                    : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10 hover:text-ink',
                )}
              >
                {CODE_NAMES[value]}
              </button>
            ))}
          </div>
          <pre className="max-h-64 overflow-auto rounded-[14px] bg-ink/[.045] p-4 text-[12.5px] leading-relaxed text-ink-2">
            <code className="mono-num">
              {code.split('\n').map((line, index) => {
                // A dot of each color beside its line (JSON has several lines per color).
                const dot =
                  shown === 'json'
                    ? undefined
                    : shown === 'css' || shown === 'tailwind'
                      ? /#[0-9A-F]{6}/.exec(line)?.[0]
                      : palette[index]?.hex;
                return (
                  <span key={index} className="block whitespace-pre">
                    {line}
                    {dot && (
                      <span
                        aria-hidden="true"
                        className="ml-2 inline-block size-2.5 rounded-full align-[-1px] shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                        style={{ background: dot }}
                      />
                    )}
                  </span>
                );
              })}
            </code>
          </pre>
        </div>
      </Advanced>
    </section>
  );
}
