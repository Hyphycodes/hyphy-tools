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
import { CopyButton, FileDrop, IconButton, Label, Surface, useCopy } from './kit';

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
const ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml,image/heic,image/heif,.heic,.heif';
const READABLE = /\.(jpe?g|png|webp|gif|avif|svg|hei[cf])$/i;
const HEIC_NOTE =
  'iPhone HEIC photos open only in Safari. Open this page in Safari, or share the photo as a JPG first.';
const CODE = {
  css: { label: 'CSS', copy: 'Copy CSS variables' },
  tailwind: { label: 'Tailwind', copy: 'Copy @theme block' },
  json: { label: 'JSON', copy: 'Copy JSON' },
} as const;
type CodeFormat = keyof typeof CODE;
/** The palette in the header art: shown, clearly as an example, before an image is added. */
const EXAMPLE = ['#E9C46A', '#F4A261', '#E76F51', '#2A9D8F', '#264653'];

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
  const current = useRef<Loaded | null>(null);
  const opener = useRef<(files: File[]) => void>(() => {});

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
    return () => release(holder.current);
  }, []);

  async function load(file: File) {
    setOpening(true);
    setMessage(`Measuring ${file.name}…`);
    try {
      const next = await openImage(file);
      release(current.current);
      current.current = next;
      setImage(next);
      setHidden([]);
      setAdded([]);
      setMessage(`${file.name}: its key colors, most of the image first.`);
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
    toast({ title: `Added ${color.hex}`, icon: 'pipette' });
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
    const hex = rgbToHex(rgb);
    add({ hex, rgb, share: shareNear(image.sample, rgb), at, typed: false });
  }

  function remove(entry: Entry) {
    if (entry.kind === 'found') setHidden([...hidden, entry.hex]);
    else setAdded(added.filter((color) => color.hex !== entry.hex));
  }

  const stem = image ? slugName(image.name.replace(/\.[^.]+$/, ''), 'image') : 'palette';
  const shortfall = image !== null && found.length < count;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,.92fr)_minmax(0,1.08fr)] lg:items-start">
      <div className="grid min-w-0 gap-5 lg:sticky lg:top-24">
        {image ? (
          <Surface className="grid gap-4">
            <ImageBar image={image} busy={opening} onReplace={open} onRemove={clear} />
            <Picker
              image={image}
              palette={palette}
              focus={focus}
              onPick={pickAt}
              onFocus={setFocus}
            />
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Icon name="pipette" size={15} className="shrink-0" />
              Tap the image to add the exact color under your finger.
            </p>
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
              icon="palette"
              accent="#a78bfa"
              title="Drop in a photo or a logo"
              disabled={opening}
              hint={
                <>
                  JPG, PNG, WebP, GIF, AVIF or SVG, up to 40 MB. You can also paste one. See-through
                  pixels don’t count. iPhone HEIC photos open only in Safari.
                </>
              }
              className="sm:!py-14"
            />
            <div className="flex flex-wrap items-center justify-center gap-1">
              <span className="text-[13.5px] text-muted">Try a sample:</span>
              {(
                [
                  ['A photo', sampleSunset],
                  ['A logo', sampleLogo],
                ] as const
              ).map(([label, make]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => trySample(make)}
                  disabled={opening}
                  className="flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-signal-ink transition-colors hover:bg-signal-soft disabled:opacity-50 lg:h-9 lg:text-[13.5px]"
                >
                  <Icon name="sparkles" size={15} /> {label}
                </button>
              ))}
            </div>
            <p role="status" className="min-h-5 text-center text-[13px] text-muted">
              {opening ? 'Measuring…' : message}
            </p>
          </Surface>
        )}
      </div>

      <div className="grid min-w-0 gap-5">
        <Surface className="grid gap-5 !p-5 sm:!p-6" aria-labelledby={`${id}-colors`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Label id={`${id}-colors`}>{image ? 'The palette' : 'Your palette'}</Label>
              <p
                aria-live="polite"
                className="mt-1 font-display text-[30px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                style={{ fontVariationSettings: "'wdth' 110" }}
              >
                {image
                  ? `${palette.length} ${palette.length === 1 ? 'color' : 'colors'}`
                  : 'Colors'}
              </p>
            </div>
            <Stepper count={count} onChange={setCount} />
          </div>

          {image ? (
            palette.length ? (
              <>
                <div
                  role="img"
                  aria-label={`How much of the image each color covers: ${palette
                    .map((entry) => `${entry.hex} ${formatShare(entry.share)}`)
                    .join(', ')}`}
                  className="flex h-14 gap-[3px] overflow-hidden rounded-[16px]"
                >
                  {palette.map((entry) => (
                    <span
                      key={entry.key}
                      onPointerEnter={() => setFocus(entry.key)}
                      onPointerLeave={() => setFocus(null)}
                      className={cn(
                        'h-full min-w-3 transition-[flex-grow,opacity] duration-300 first:rounded-l-[16px] last:rounded-r-[16px]',
                        focus && focus !== entry.key && 'opacity-60',
                      )}
                      style={{ background: entry.hex, flexGrow: Math.max(entry.share, 0.025) }}
                    />
                  ))}
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {palette.map((entry) => (
                    <SwatchCard
                      key={entry.key}
                      entry={entry}
                      focused={focus === entry.key}
                      onFocus={setFocus}
                      onRemove={() => remove(entry)}
                    />
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
                  {shortfall && (
                    <span>
                      This image has{' '}
                      {found.length === 1 ? 'one main color' : `${found.length} main colors`}, so
                      that’s all there is to show.
                    </span>
                  )}
                  {hidden.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHidden([])}
                      className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
                    >
                      Bring back {hidden.length} removed
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="rounded-[14px] bg-subtle px-4 py-8 text-center text-[14px] text-muted">
                This image is entirely see-through, so there are no colors to measure.
              </p>
            )
          ) : (
            <Example />
          )}

          <AddColor
            disabled={!image}
            onAdd={(color) =>
              image &&
              add({ ...color, share: shareNear(image.sample, color.rgb), at: null, typed: true })
            }
          />
        </Surface>

        {image && palette.length > 0 && (
          <>
            <Pairs palette={palette} pairs={pairs} />
            <Exports palette={palette} stem={stem} />
          </>
        )}
      </div>
    </div>
  );
}

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
          'inline-flex h-10 items-center gap-1.5 rounded-[11px] bg-well px-3 text-[13.5px] font-medium text-ink-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal hover:bg-ink/10 hover:text-ink lg:h-9',
          busy && 'pointer-events-none opacity-45',
        )}
      >
        <Icon name="replace" size={15} /> Replace
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
  onPick,
  onFocus,
}: {
  image: Loaded;
  palette: Entry[];
  focus: string | null;
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
    <div className="grid place-items-center rounded-[16px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div
        className="relative max-w-full"
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
      className="flex items-center rounded-[12px] bg-well p-1"
    >
      <button
        type="button"
        aria-label="Fewer colors"
        disabled={count <= MIN_COLORS}
        onClick={() => onChange(count - 1)}
        className="grid size-10 place-items-center rounded-[9px] text-ink-2 transition-colors hover:bg-surface hover:text-ink disabled:opacity-35 lg:size-8"
      >
        <Icon name="minus" size={16} />
      </button>
      <span className="mono-num w-[104px] text-center text-[13px] text-ink" aria-live="polite">
        Find up to {count}
      </span>
      <button
        type="button"
        aria-label="More colors"
        disabled={count >= MAX_COLORS}
        onClick={() => onChange(count + 1)}
        className="grid size-10 place-items-center rounded-[9px] text-ink-2 transition-colors hover:bg-surface hover:text-ink disabled:opacity-35 lg:size-8"
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function CopyValue({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  const { copy, copied } = useCopy();
  const done = copied === value;
  return (
    <button
      type="button"
      onClick={() => copy(value, `Copied ${value}`)}
      aria-label={`Copy ${label} ${value}`}
      className="group/value flex h-10 w-full items-center gap-2 rounded-[10px] px-2 text-left transition-colors hover:bg-ink/5 lg:h-8"
    >
      <span className="label w-8 shrink-0 !text-[9.5px]">{label}</span>
      <span
        className={cn(
          'mono-num min-w-0 flex-1 truncate',
          strong ? 'text-[14px] font-semibold text-ink' : 'text-[12px] text-ink-2',
        )}
      >
        {value}
      </span>
      <Icon
        name={done ? 'check' : 'copy'}
        size={13}
        className={cn(
          'shrink-0 transition-opacity',
          done ? 'text-positive' : 'text-muted opacity-40 group-hover/value:opacity-100',
        )}
      />
    </button>
  );
}

function SwatchCard({
  entry,
  focused,
  onFocus,
  onRemove,
}: {
  entry: Entry;
  focused: boolean;
  onFocus: (key: string | null) => void;
  onRemove: () => void;
}) {
  const text = textOn(entry.rgb);
  const ink = text.text === 'white' ? '#FFFFFF' : '#000000';
  const level = contrastLevel(text.ratio);
  return (
    <li
      onPointerEnter={() => onFocus(entry.key)}
      onPointerLeave={() => onFocus(null)}
      className={cn(
        'min-w-0 animate-rise overflow-hidden rounded-[18px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow',
        focused && 'shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-ink))]',
      )}
    >
      <div
        className="relative flex h-32 flex-col justify-between p-3 sm:h-36"
        style={{ background: entry.hex, color: ink }}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className="font-display text-[30px] leading-none font-extrabold tracking-[-0.03em]"
            style={{ fontVariationSettings: "'wdth' 110" }}
            aria-hidden="true"
          >
            Aa
          </span>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${entry.hex}`}
            title="Remove"
            className="-mt-1 -mr-1 grid size-8 place-items-center rounded-full opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 focus-visible:opacity-100"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="grid gap-0.5 text-[11.5px] font-medium">
          <span className="mono-num flex items-center gap-1 text-[13px] font-semibold">
            {entry.kind !== 'found' && (
              <Icon
                name={entry.kind === 'picked' ? 'pipette' : 'hash'}
                size={12}
                label={entry.kind === 'picked' ? 'Picked' : 'Added'}
              />
            )}
            {entry.kind === 'typed' && entry.share === 0
              ? 'Not in the image'
              : `${formatShare(entry.kind === 'picked' ? Math.max(entry.share, 0.001) : entry.share)} of the image`}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5">
            {text.text === 'white' ? 'White' : 'Black'} text {formatRatio(text.ratio)}
            <span className="rounded-full px-1.5 py-px text-[10px] font-semibold shadow-[inset_0_0_0_1px_currentColor]">
              {level}
            </span>
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] p-1.5">
        <CopyValue label="HEX" value={entry.hex} strong />
        <CopyValue label="RGB" value={formatRgb(entry.rgb)} />
        <CopyValue label="HSL" value={formatHsl(entry.rgb)} />
      </div>
    </li>
  );
}

function AddColor({ disabled, onAdd }: { disabled: boolean; onAdd: (color: Swatch) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const rgb = hexToRgb(text);
    if (!rgb) return setError('Type a HEX color like #1D3557.');
    onAdd({ hex: rgbToHex(rgb), rgb, share: 0 });
    setText('');
    setError('');
  };
  const preview = hexToRgb(text);
  return (
    <form onSubmit={submit} className="grid gap-1.5 border-t border-line pt-4">
      <label htmlFor={`${id}-hex`} className="text-[13px] font-medium text-ink-2">
        Add a color by HEX{' '}
        <span className="font-normal text-muted">
          — your brand color, to check it against these
        </span>
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 rounded-full shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
            style={{ background: preview ? rgbToHex(preview) : 'transparent' }}
          />
          <input
            id={`${id}-hex`}
            placeholder="#1D3557"
            value={text}
            disabled={disabled}
            maxLength={9}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError('');
            }}
            className="mono-num h-11 w-full rounded-[11px] bg-subtle pr-3 pl-9 text-[16px] text-ink uppercase shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint placeholder:normal-case focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] disabled:opacity-50 lg:h-9 lg:text-[14px]"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="inline-flex h-11 items-center gap-1.5 rounded-[11px] bg-well px-3.5 text-[14px] font-medium text-ink transition-colors hover:bg-ink/10 disabled:opacity-40 lg:h-9 lg:text-[13.5px]"
        >
          <Icon name="plus" size={15} /> Add
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-[12.5px] text-critical">
          {error}
        </p>
      )}
    </form>
  );
}

/** Before an image: what the palette will look like, marked as an example. */
function Example() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <div className="flex h-14 gap-[3px] overflow-hidden rounded-[16px] opacity-90">
        {EXAMPLE.map((hex, index) => (
          <span
            key={hex}
            className="h-full first:rounded-l-[16px] last:rounded-r-[16px]"
            style={{ background: hex, flexGrow: [0.34, 0.22, 0.18, 0.15, 0.11][index] }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 opacity-80 sm:grid-cols-3">
        {EXAMPLE.slice(0, 3).map((hex) => (
          <div key={hex} className="overflow-hidden rounded-[18px] bg-subtle">
            <div className="h-20 p-3" style={{ background: hex }} />
            <p className="mono-num px-3 py-2.5 text-[13px] font-semibold text-ink-2">{hex}</p>
          </div>
        ))}
      </div>
      <p className="text-[14px] text-ink-2">
        An example. Add an image and its own colors appear here, strongest first, with HEX, RGB and
        HSL, the text color that reads on each, and CSS ready to paste.
      </p>
    </div>
  );
}

function Pairs({ palette, pairs }: { palette: Entry[]; pairs: ReturnType<typeof readablePairs> }) {
  const id = useId();
  const [all, setAll] = useState(false);
  const shown = all ? pairs : pairs.slice(0, 6);
  return (
    <Surface className="grid gap-4" aria-labelledby={`${id}-pairs`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label id={`${id}-pairs`}>Readable pairs · {pairs.length}</Label>
        <span className="text-[12px] text-muted">
          Text and background at 4.5:1 or more (WCAG AA)
        </span>
      </div>
      {pairs.length === 0 ? (
        <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13.5px] text-muted">
          No two of these colors reach 4.5:1, so none should carry small text on the other. Each
          swatch shows whether white or black text reads on it instead.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {shown.map((pair) => {
            const back = palette[pair.first];
            const front = palette[pair.second];
            return (
              <li
                key={`${back.key}-${front.key}`}
                className="flex items-center gap-3 rounded-[14px] bg-subtle p-2 pr-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                <span className="flex h-14 w-28 shrink-0 overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_var(--color-line)]">
                  <span
                    className="grid flex-1 place-items-center font-display text-[20px] font-bold"
                    style={{ background: back.hex, color: front.hex }}
                  >
                    Aa
                  </span>
                  <span
                    className="grid flex-1 place-items-center font-display text-[20px] font-bold"
                    style={{ background: front.hex, color: back.hex }}
                  >
                    Aa
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mono-num block truncate text-[12.5px] text-ink">
                    {front.hex} · {back.hex}
                  </span>
                  <span className="mono-num mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                    {formatRatio(pair.ratio)}
                    <span className="rounded-full bg-positive-soft px-1.5 text-[10.5px] font-semibold text-positive">
                      {contrastLevel(pair.ratio)}
                    </span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {pairs.length > 6 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="justify-self-start text-[13px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
        >
          {all ? 'Show the best 6' : `Show all ${pairs.length}`}
        </button>
      )}
    </Surface>
  );
}

function Exports({ palette, stem }: { palette: Entry[]; stem: string }) {
  const id = useId();
  const toast = useToast();
  const [format, setFormat] = useState<CodeFormat>('css');
  const hexes = palette.map((entry) => entry.hex);
  const code =
    format === 'css'
      ? cssVariables(hexes)
      : format === 'tailwind'
        ? tailwindTheme(hexes)
        : paletteJson(palette.map(({ hex, rgb, share }) => ({ hex, rgb, share })));

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

  return (
    <Surface className="grid gap-4" aria-labelledby={`${id}-use`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label id={`${id}-use`}>Use it</Label>
        <div
          role="radiogroup"
          aria-label="Code to copy"
          className="flex rounded-[12px] bg-well p-1"
        >
          {(Object.keys(CODE) as CodeFormat[]).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={format === option}
              onClick={() => setFormat(option)}
              className={cn(
                'h-10 rounded-[9px] px-3 text-[13.5px] font-medium transition-colors lg:h-8',
                format === option ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
              )}
            >
              {CODE[option].label}
            </button>
          ))}
        </div>
      </div>
      <pre className="max-h-64 overflow-auto rounded-[14px] bg-subtle p-4 text-[12.5px] leading-relaxed text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <code className="mono-num">
          {code.split('\n').map((line, index) => {
            const hex = /#[0-9A-F]{6}/.exec(line)?.[0];
            return (
              <span key={index} className="block whitespace-pre">
                {line}
                {hex && format !== 'json' && (
                  <span
                    aria-hidden="true"
                    className="ml-2 inline-block size-2.5 rounded-full align-[-1px] shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                    style={{ background: hex }}
                  />
                )}
              </span>
            );
          })}
        </code>
      </pre>
      <div className="flex flex-wrap gap-2">
        <CopyButton
          text={code}
          label={CODE[format].copy}
          what={`${CODE[format].label} copied`}
          variant="solid"
          className="!h-11 lg:!h-10"
        />
        <button
          type="button"
          onClick={savePng}
          className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-well px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-10 lg:text-[13.5px]"
        >
          <Icon name="download" size={15} /> Swatches PNG
        </button>
        <button
          type="button"
          onClick={saveSvg}
          className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-well px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-10 lg:text-[13.5px]"
        >
          <Icon name="download" size={15} /> Swatches SVG
        </button>
      </div>
      <p className="text-[12px] text-faint">
        Measured in your browser. Your image is never uploaded.
      </p>
    </Surface>
  );
}
