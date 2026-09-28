'use client';
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
  sampleColors,
  shareNear,
  SHEET_FONTS,
  sheetSvg,
  swatchSheet,
  tailwindTheme,
  textOn,
  type ColorSample,
  type Swatch,
} from '@/lib/tools/palette';
import { FileDrop, IconButton, Label, MoreOptions, StartPanel, Surface, useCopy } from './kit';
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

/* ---------------- the tool ---------------- */

export function PaletteTool() {
  const id = useId();
  const toast = useToast();
  const [image, setImage] = useState<Loaded | null>(null);
  const [opening, setOpening] = useState(false);
  const [count, setCount] = useState(DEFAULT_COLORS);
  const [hidden, setHidden] = useState<string[]>([]);
  const [added, setAdded] = useState<Added[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [typing, setTyping] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [flash, setFlash] = useState(false);
  const current = useRef<Loaded | null>(null);
  const opener = useRef<(files: File[]) => void>(() => {});
  const imagePanel = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
    setMessage(`Mixing the colors of ${file.name}…`);
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

  // An image pasted anywhere on the page (⌘V / Ctrl+V) opens too.
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
    toast({ title: `Added ${colorName(color.rgb).toLowerCase()} · ${color.hex}`, icon: 'pipette' });
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

  /** "Add from the image": bring the image into view and point at it. */
  function pointAtImage() {
    imagePanel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setNudge((value) => value + 1);
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 2800);
  }

  if (!image)
    return (
      <StartPanel
        art={<PaletteArt busy={opening} />}
        eyebrow="Photo to palette"
        title="Every picture has a palette"
        lead="Drop in a photo or a logo. Its main colors come out, ready to copy."
        footer={
          <p role="status" className="min-h-5">
            {opening ? 'Mixing the colors…' : message}
          </p>
        }
      >
        <FileDrop
          onFiles={open}
          accept={ACCEPT}
          multiple={false}
          icon="image"
          accent={ACCENT}
          title="Drop an image"
          disabled={opening}
          hint="Or paste one. It stays on this device."
          compact
        />
        <div className="mt-6">
          <p className="mb-2.5 flex items-center justify-center gap-1.5 text-[14px] font-medium text-ink-2">
            <Icon name="sparkles" size={15} className="text-signal-ink" />
            No image handy? Try a sample
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {SAMPLES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => trySample(sample.make)}
                disabled={opening}
                aria-label={`Try a sample ${sample.label.toLowerCase()}`}
                className="group min-w-0 overflow-hidden rounded-[18px] bg-well text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-[transform,box-shadow] hover:shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-ink))] active:scale-[.98] disabled:opacity-50"
              >
                <sample.Thumb className="block aspect-[16/10] w-full sm:aspect-[16/7]" />
                <span className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="truncate text-[14.5px] font-semibold text-ink">
                    {sample.label}
                  </span>
                  <span aria-hidden="true" className="flex shrink-0 -space-x-1.5">
                    {sample.colors.map((hex) => (
                      <span
                        key={hex}
                        className="size-4 rounded-full shadow-[0_0_0_2px_var(--color-well)]"
                        style={{ background: hex }}
                      />
                    ))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </StartPanel>
    );

  const stem = slugName(image.name.replace(/\.[^.]+$/, ''), 'image');
  const shortfall = found.length < count;
  const picked = added.some((color) => !color.typed);

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:items-start">
      <div
        ref={imagePanel}
        className="order-2 min-w-0 scroll-mt-24 lg:sticky lg:top-24 lg:order-none"
      >
        <Surface className="grid gap-3">
          <ImageBar image={image} busy={opening} onReplace={open} onRemove={clear} />
          <Picker
            image={image}
            palette={palette}
            focus={focus}
            hint={!picked || flash}
            nudge={nudge}
            onPick={pickAt}
            onFocus={setFocus}
          />
          <p role="status" className="min-h-5 text-[13px] text-muted empty:hidden">
            {message}
          </p>
        </Surface>
      </div>

      <div className="contents lg:grid lg:min-w-0 lg:gap-5">
        <Surface className="order-1 grid gap-4 !p-4 sm:!p-6" aria-labelledby={`${id}-colors`}>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <Label id={`${id}-colors`}>Your palette</Label>
              <p
                aria-live="polite"
                className="mt-1 font-display text-[32px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                style={{ fontVariationSettings: "'wdth' 110" }}
              >
                {palette.length} {palette.length === 1 ? 'color' : 'colors'}
              </p>
            </div>
            <Stepper count={count} onChange={setCount} />
          </div>

          {palette.length > 0 ? (
            <div
              role="img"
              aria-label={`How much of the image each color covers: ${palette
                .map((entry) => `${entry.hex} ${formatShare(entry.share)}`)
                .join(', ')}`}
              className="flex h-3 gap-[2px] overflow-hidden rounded-full"
            >
              {palette.map((entry) => (
                <span
                  key={entry.key}
                  className={cn(
                    'h-full min-w-2 transition-[flex-grow,opacity] duration-300',
                    focus && focus !== entry.key && 'opacity-50',
                  )}
                  style={{ background: entry.hex, flexGrow: Math.max(entry.share, 0.025) }}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-[14px] bg-subtle px-4 py-6 text-center text-[14px] text-muted">
              This image is entirely see-through, so there are no colors to find. Add one of your
              own below.
            </p>
          )}

          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {palette.map((entry, index) => (
              <SwatchCard
                key={entry.key}
                entry={entry}
                big={index === 0}
                focused={focus === entry.key}
                onFocus={setFocus}
                onRemove={() => remove(entry)}
              />
            ))}
            <li className="min-w-0">
              <div className="flex h-40 flex-col justify-center gap-1 rounded-[20px] border-[1.5px] border-dashed border-line-strong p-2">
                <p className="px-2.5 pb-1 text-[13px] font-medium text-muted">Add a color</p>
                <button
                  type="button"
                  onClick={pointAtImage}
                  className="flex min-h-11 items-center gap-2 rounded-[12px] px-2.5 text-left text-[14px] font-medium text-ink transition-colors hover:bg-well"
                >
                  <Icon name="pipette" size={16} className="shrink-0 text-signal-ink" />
                  From the image
                </button>
                <button
                  type="button"
                  aria-expanded={typing}
                  onClick={() => setTyping(!typing)}
                  className="flex min-h-11 items-center gap-2 rounded-[12px] px-2.5 text-left text-[14px] font-medium text-ink transition-colors hover:bg-well"
                >
                  <Icon name="hash" size={16} className="shrink-0 text-signal-ink" />
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

          {(shortfall || hidden.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
              {shortfall && (
                <span>
                  This image has{' '}
                  {found.length === 1 ? 'one main color' : `${found.length} main colors`}, so that’s
                  all there is to show.
                </span>
              )}
              {hidden.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHidden([])}
                  className="min-h-11 font-medium text-ink-2 underline underline-offset-2 hover:text-ink lg:min-h-0"
                >
                  Bring back {hidden.length} removed
                </button>
              )}
            </div>
          )}
        </Surface>

        {palette.length > 0 && (
          <>
            <Pairs className="order-3" palette={palette} pairs={pairs} />
            <Exports className="order-4" palette={palette} stem={stem} />
          </>
        )}
      </div>
    </div>
  );
}

const ACCENT = 'var(--accent, #ff7ab6)';

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
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-well text-ink-2">
        <Icon name="image" size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{image.name}</p>
        <p className="mono-num truncate text-[11.5px] text-muted">
          {image.size.width}×{image.size.height}
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
          'inline-flex h-11 items-center gap-1.5 rounded-[11px] bg-well px-3 text-[14px] font-medium text-ink-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal hover:bg-ink/10 hover:text-ink lg:h-9 lg:text-[13.5px]',
          busy && 'pointer-events-none opacity-45',
        )}
      >
        <Icon name="replace" size={15} /> New image
      </label>
      <IconButton icon="x" label="Remove the image" onClick={onRemove} disabled={busy} />
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
    <div className="grid place-items-center rounded-[16px] bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-3">
      <div
        className="relative max-w-full overflow-hidden rounded-[10px]"
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
          className="block h-auto max-h-[min(62vh,560px)] w-auto max-w-full cursor-crosshair touch-manipulation"
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
                  'absolute -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_#fff,0_2px_8px_rgb(0_0_0/.45)] transition-[width,height] duration-200',
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
            className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 animate-pop items-center gap-2 rounded-full bg-[#12110d]/85 py-2 pr-3.5 pl-2 text-[13.5px] font-medium whitespace-nowrap text-white shadow-[0_8px_24px_-8px_rgb(0_0_0/.6)]"
          >
            <span
              className="grid size-6 place-items-center rounded-full text-[#12110d]"
              style={{ background: ACCENT }}
            >
              <Icon name="pipette" size={13} />
            </span>
            Tap anywhere to add a color
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
            <span className="mono-num rounded-full bg-night px-2 py-0.5 text-[11px] text-white">
              {hover.hex ?? 'See-through'}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function Stepper({ count, onChange }: { count: number; onChange: (count: number) => void }) {
  return (
    <div
      role="group"
      aria-label="How many colors to find"
      className="flex shrink-0 items-center rounded-full bg-well p-1"
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
      <span className="mono-num w-[62px] text-center text-[13px] text-ink" aria-live="polite">
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

/** A big color you can tap to copy, with its nickname and how much of the image it covers. */
function SwatchCard({
  entry,
  big,
  focused,
  onFocus,
  onRemove,
}: {
  entry: Entry;
  big: boolean;
  focused: boolean;
  onFocus: (key: string | null) => void;
  onRemove: () => void;
}) {
  const { copy, copied } = useCopy();
  const done = copied === entry.hex;
  const ink = inkOn(entry);
  const light = ink === '#FFFFFF';
  const name = colorName(entry.rgb);
  const share =
    entry.kind === 'typed' && entry.share === 0
      ? 'Not in the image'
      : `Covers ${formatShare(entry.kind === 'picked' ? Math.max(entry.share, 0.001) : entry.share)}`;
  return (
    <li
      onPointerEnter={() => onFocus(entry.key)}
      onPointerLeave={() => onFocus(null)}
      className={cn('relative min-w-0 animate-rise', big && 'col-span-2')}
    >
      <button
        type="button"
        onClick={() => copy(entry.hex, `Copied ${name.toLowerCase()} · ${entry.hex}`)}
        aria-label={`${name}, ${entry.hex}, ${share}. Copy`}
        className={cn(
          'flex w-full flex-col justify-between rounded-[20px] p-4 text-left shadow-[inset_0_0_0_1px_rgb(0_0_0/.14)] transition-[transform,box-shadow] duration-200 active:scale-[.98]',
          big ? 'h-48 sm:h-52' : 'h-40',
          focused &&
            'shadow-[inset_0_0_0_1px_rgb(0_0_0/.14),0_0_0_3px_var(--color-surface),0_0_0_5px_var(--accent,var(--color-ink))]',
        )}
        style={{ background: entry.hex, color: ink }}
      >
        <span className="min-w-0 pr-8">
          <span
            className={cn(
              'block font-display leading-[1.02] font-bold tracking-[-0.025em] text-balance',
              big ? 'text-[30px] sm:text-[34px]' : 'text-[18px]',
            )}
            style={{ fontVariationSettings: "'wdth' 108" }}
          >
            {name}
          </span>
          {entry.kind !== 'found' && (
            <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium opacity-80">
              <Icon name={entry.kind === 'picked' ? 'pipette' : 'hash'} size={12} />
              {entry.kind === 'picked' ? 'Picked' : 'Added'}
            </span>
          )}
        </span>
        <span className="flex items-end justify-between gap-2">
          <span className="min-w-0">
            <span
              className={cn(
                'mono-num block font-semibold tracking-[0.01em]',
                big ? 'text-[20px]' : 'text-[15px]',
              )}
            >
              {entry.hex}
            </span>
            <span className="mt-0.5 block text-[12px] leading-tight opacity-75">{share}</span>
          </span>
          <span
            key={done ? 'done' : 'copy'}
            aria-hidden="true"
            className={cn(
              'shrink-0 animate-pop place-items-center rounded-full',
              big ? 'flex h-9 items-center gap-1.5 px-3 text-[13px] font-semibold' : 'grid size-8',
            )}
            style={{ background: light ? 'rgb(255 255 255 / .18)' : 'rgb(0 0 0 / .08)' }}
          >
            <Icon name={done ? 'check' : 'copy'} size={15} />
            {big && (done ? 'Copied' : 'Copy')}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entry.hex}`}
        title="Remove"
        className="absolute top-1.5 right-1.5 grid size-10 place-items-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
    <form
      onSubmit={submit}
      className="grid animate-pop gap-2 rounded-[18px] bg-subtle p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={`${id}-hex`} className="pt-1 text-[14px] font-medium text-ink">
          Type a color code{' '}
          <span className="block text-[13px] font-normal text-muted">
            Your brand color, say, to see it next to these.
          </span>
        </label>
        <IconButton icon="x" label="Close" onClick={onClose} size="sm" />
      </div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-5 -translate-y-1/2 rounded-full shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
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
            className="mono-num h-12 w-full rounded-[12px] bg-surface pr-3 pl-10 text-[16px] text-ink uppercase shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint placeholder:normal-case focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:h-10 lg:text-[14px]"
          />
        </div>
        <button
          type="submit"
          disabled={!text.trim()}
          className="inline-flex h-12 items-center gap-1.5 rounded-[12px] px-4 text-[15px] font-semibold text-[#12110d] transition-opacity disabled:opacity-40 lg:h-10 lg:text-[14px]"
          style={{ background: ACCENT }}
        >
          <Icon name="plus" size={16} /> Add
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-[13px] text-critical">
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
    <Surface className={cn('grid gap-4', className)} aria-labelledby={`${id}-pairs`}>
      <div>
        <Label id={`${id}-pairs`}>Easy to read together</Label>
        <p className="mt-1 text-[14px] text-muted">
          {pairs.length
            ? 'Text in one of these colors stays clear on the other.'
            : 'No two of these colors are far enough apart to carry small text on each other. Each swatch above shows the text color that reads on it instead.'}
        </p>
      </div>
      {pairs.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {shown.map((pair, index) => {
            const back = palette[pair.first];
            const front = palette[pair.second];
            return (
              <li
                key={`${back.key}-${front.key}`}
                aria-label={`${colorName(front.rgb)} text on ${colorName(back.rgb).toLowerCase()} (${front.hex} on ${back.hex}), contrast ${formatRatio(pair.ratio)}`}
                className="flex min-h-[132px] min-w-0 animate-rise flex-col justify-between gap-2 rounded-[18px] p-3.5 shadow-[inset_0_0_0_1px_rgb(0_0_0/.14)]"
                style={{ background: back.hex, color: front.hex }}
              >
                <span aria-hidden="true">
                  <span
                    className="block font-display text-[34px] leading-none font-bold tracking-[-0.03em]"
                    style={{ fontVariationSettings: "'wdth' 110" }}
                  >
                    Aa
                  </span>
                  <span className="mt-1.5 block text-[14.5px] leading-tight font-semibold">
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
          className="min-h-11 justify-self-start text-[14px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink lg:min-h-0"
        >
          {all ? 'Show fewer' : `Show all ${pairs.length}`}
        </button>
      )}
    </Surface>
  );
}

const FORMATS = [
  { value: 'hex', label: 'HEX codes' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'css', label: 'CSS variables' },
  { value: 'tailwind', label: 'Tailwind' },
  { value: 'json', label: 'JSON' },
] as const;
type Format = (typeof FORMATS)[number]['value'];

function codeFor(format: Format, palette: Entry[]) {
  const hexes = palette.map((entry) => entry.hex);
  if (format === 'hex') return hexes.join('\n');
  if (format === 'rgb') return palette.map((entry) => formatRgb(entry.rgb)).join('\n');
  if (format === 'hsl') return palette.map((entry) => formatHsl(entry.rgb)).join('\n');
  if (format === 'css') return cssVariables(hexes);
  if (format === 'tailwind') return tailwindTheme(hexes);
  return paletteJson(palette.map(({ hex, rgb, share }) => ({ hex, rgb, share })));
}

/** The whole palette, in a tap: as codes for a design app or a stylesheet, or as a picture. */
function Exports({
  palette,
  stem,
  className,
}: {
  palette: Entry[];
  stem: string;
  className?: string;
}) {
  const id = useId();
  const toast = useToast();
  const { copy, copied } = useCopy();
  const [shown, setShown] = useState<Format>('css');
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
    'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14.5px] font-medium transition-[background-color,color,transform] active:scale-[.97] lg:min-h-10 lg:text-[14px]';

  return (
    <Surface className={cn('grid gap-4', className)} aria-labelledby={`${id}-use`}>
      <div>
        <Label id={`${id}-use`}>Copy as…</Label>
        <p className="mt-1 text-[14px] text-muted">
          All {palette.length} colors at once, for a design app or your code.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map((format) => {
          const text = codeFor(format.value, palette);
          const done = copied === text;
          return (
            <button
              key={format.value}
              type="button"
              aria-label={`Copy as ${format.label}`}
              onClick={() => {
                setShown(format.value);
                void copy(text, `${format.label} copied`);
              }}
              className={cn(
                chip,
                done ? 'text-[#12110d]' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
              )}
              style={done ? { background: ACCENT } : undefined}
            >
              <Icon name={done ? 'check' : 'copy'} size={15} />
              {format.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <span className="mr-1 text-[14px] text-muted">Save the swatches</span>
        <button
          type="button"
          onClick={savePng}
          className={cn(chip, 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink')}
        >
          <Icon name="download" size={15} /> Picture
        </button>
        <button
          type="button"
          onClick={saveSvg}
          className={cn(chip, 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink')}
        >
          <Icon name="download" size={15} /> SVG
        </button>
      </div>
      <MoreOptions
        label="See the code"
        summary={FORMATS.find((format) => format.value === shown)?.label}
      >
        <pre className="max-h-64 overflow-auto rounded-[14px] bg-subtle p-4 text-[12.5px] leading-relaxed text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
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
      </MoreOptions>
    </Surface>
  );
}
