'use client';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { download } from '@/lib/files/download';
import { zip } from '@/lib/files/zip';
import { formatBytes, plural } from '@/lib/platform/format';
import {
  baseName,
  buildPdf,
  DEFAULT_SETUP,
  embedPlan,
  hasTransparency,
  jpegOrientation,
  kindOf,
  layoutPage,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  PAGE_JPEG_QUALITY,
  pageImageName,
  pagePixels,
  pagesZipName,
  pdfName,
  previewBoxes,
  REDRAW_QUALITY,
  redrawSize,
  redrawType,
  RESOLUTIONS,
  sizeChange,
  SMALLER,
  sniffImage,
  type PageLayout,
  type PageSetup,
  type PdfImage,
  type PdfSource,
  type Resolution,
  type Size,
} from '@/lib/tools/convert';
import { formatRange, parseRange } from '@/lib/tools/pdf';
import type { PdfOpenError, RenderablePdf } from '@/lib/tools/pdf-render';
import { FileDrop, MoreOptions, Note, Surface } from './kit';

/*
 * Convert: photos and scans into one PDF, in the order you choose, or the pages of a PDF out as
 * JPG or PNG images. All of it happens on this device: pdf-lib builds the PDF, PDF.js draws the
 * pages, and a canvas redraws what a PDF can't take as it is. Nothing is uploaded.
 */

type Mode = 'images' | 'pdf';
/** How one side hands files to the other: a PDF dropped among photos, say. */
type Intake = { take: (files: File[]) => void };

/** Page previews are drawn in a 4:5 frame, whatever the page's shape. */
const FRAME = 4 / 5;
/** Picture thumbnails, long side in pixels: sharp in a tile on a phone, light in memory. */
const THUMB_SIDE = 360;
/** PDF page thumbnails, in CSS pixels. */
const PAGE_THUMB_WIDTH = 132;
const ACCENT_TINT = 'bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]';

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

/** “a.jpg” and “b.png”; “a.jpg”, “b.png” and 3 more. */
function names(list: string[]) {
  const quoted = list.map((name) => `“${name}”`);
  if (quoted.length <= 2) return quoted.join(' and ');
  return `${quoted[0]}, ${quoted[1]} and ${quoted.length - 2} more`;
}

export function ConvertTool() {
  const [mode, setMode] = useState<Mode>('images');
  const [started, setStarted] = useState<Record<Mode, boolean>>({ images: false, pdf: false });
  const images = useRef<Intake>(null);
  const pdfs = useRef<Intake>(null);
  const startedImages = useCallback(
    (yes: boolean) => setStarted((current) => ({ ...current, images: yes })),
    [],
  );
  const startedPdf = useCallback(
    (yes: boolean) => setStarted((current) => ({ ...current, pdf: yes })),
    [],
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <ModeSwitch value={mode} onChange={setMode} compact={started[mode]} />
      <ImagesToPdf
        ref={images}
        hidden={mode !== 'images'}
        onStarted={startedImages}
        onPdfs={(files) => {
          setMode('pdf');
          pdfs.current?.take(files);
        }}
      />
      <PdfToImages
        ref={pdfs}
        hidden={mode !== 'pdf'}
        onStarted={startedPdf}
        onImages={(files) => {
          setMode('images');
          images.current?.take(files);
        }}
      />
    </div>
  );
}

/* ---------------- Shared parts ---------------- */

/** Arrow keys move a radio group's choice, the way native radio buttons do. */
function arrowTo<T>(
  event: KeyboardEvent<HTMLElement>,
  options: readonly T[],
  index: number,
  pick: (option: T) => void,
) {
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  if (!forward && !back) return;
  event.preventDefault();
  const next = (index + (forward ? 1 : -1) + options.length) % options.length;
  pick(options[next]);
  const sibling = event.currentTarget.parentElement?.children[next];
  if (sibling instanceof HTMLElement) sibling.focus();
}

const MODES: { value: Mode; from: string; to: string; icon: IconName; hint: string }[] = [
  {
    value: 'images',
    from: 'Images',
    to: 'PDF',
    icon: 'file-image',
    hint: 'Photos and scans into one PDF',
  },
  { value: 'pdf', from: 'PDF', to: 'images', icon: 'pdf', hint: 'Every page as a JPG or PNG' },
];

/** Photos and a page, drawn: which way the files go. */
function DirectionArt({ mode }: { mode: Mode }) {
  const photos = (x: number) =>
    [0, 1, 2].map((index) => (
      <g key={index} transform={`rotate(${[-9, 0, 9][index]} ${x + 13} 26)`}>
        <rect
          x={x + index * 7}
          y={12 + index * 2}
          width="22"
          height="18"
          rx="3"
          fill={['#f6b77a', '#9fc3a8', '#8a6a4f'][index]}
          className="stroke-[rgb(0_0_0/.18)]"
        />
        <path
          d={`M${x + index * 7 + 3} ${27 + index * 2}l5-6 4 4 3-3 5 5`}
          className="fill-none stroke-white/70"
          strokeWidth="1.4"
        />
      </g>
    ));
  const sheet = (x: number) => (
    <g>
      <rect
        x={x}
        y="5"
        width="28"
        height="36"
        rx="3.5"
        className="fill-white stroke-[rgb(0_0_0/.14)]"
      />
      <rect x={x} y="5" width="28" height="5" rx="2" style={{ fill: 'var(--accent)' }} />
      {[16, 21, 26, 31].map((y) => (
        <rect key={y} x={x + 5} y={y} width={y === 31 ? 11 : 18} height="2" rx="1" fill="#d8d3c8" />
      ))}
    </g>
  );
  const arrow = (
    <g className="stroke-[var(--accent)]" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <path d="M52 23h16" />
      <path d="M63 18l5 5-5 5" strokeLinejoin="round" />
    </g>
  );
  return (
    <svg viewBox="0 0 112 46" aria-hidden="true" className="h-11 w-[108px] overflow-visible">
      {mode === 'images' ? (
        <>
          {photos(4)}
          {arrow}
          {sheet(78)}
        </>
      ) : (
        <>
          {sheet(10)}
          {arrow}
          {photos(76)}
        </>
      )}
    </svg>
  );
}

/**
 * Which way: two big picture cards to start, a slim switch once there are files. Each side keeps
 * its own files, so switching back finds them where they were.
 */
function ModeSwitch({
  value,
  onChange,
  compact,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
  compact: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="What to convert"
      className={cn(
        'grid grid-cols-2',
        compact ? 'gap-1 rounded-[18px] bg-well p-1 sm:max-w-[620px]' : 'gap-2.5 sm:gap-3',
      )}
    >
      {MODES.map((option, index) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${option.from} to ${option.to}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => arrowTo(event, MODES, index, (next) => onChange(next.value))}
            className={cn(
              'text-left transition-[background-color,box-shadow,color,transform]',
              compact
                ? cn(
                    'flex min-h-14 items-center gap-2.5 rounded-[14px] px-2.5 sm:gap-3 sm:px-4',
                    on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
                  )
                : cn(
                    'flex min-w-0 flex-col items-start gap-3 rounded-[22px] p-4 active:scale-[.98] sm:p-5',
                    on
                      ? 'bg-[color-mix(in_srgb,var(--accent)_14%,var(--color-surface))] text-ink shadow-[inset_0_0_0_2px_var(--accent)]'
                      : 'bg-surface text-ink-2 shadow-card hover:text-ink',
                  ),
            )}
          >
            {compact ? (
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors sm:size-9 sm:rounded-[11px]',
                  on ? 'text-[#12110d]' : 'bg-ink/5',
                )}
                style={on ? { background: 'var(--accent)' } : undefined}
              >
                <Icon name={option.icon} size={18} />
              </span>
            ) : (
              <DirectionArt mode={option.value} />
            )}
            <span className="min-w-0">
              <span
                className={cn(
                  'flex items-center gap-1.5 font-semibold',
                  compact ? 'text-[15px]' : 'text-[17px] sm:text-[19px]',
                )}
              >
                {option.from}
                <Icon name="arrow-right" size={compact ? 14 : 16} className="text-muted" />
                {option.to}
              </span>
              <span
                className={cn(
                  'text-[12.5px] leading-snug text-muted',
                  compact ? 'hidden truncate sm:block' : 'mt-0.5 block sm:text-[13.5px]',
                )}
              >
                {option.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

type Option<T extends string> = { value: T; label: ReactNode; detail?: ReactNode };

/** A labelled row of choices (a radio group of buttons). */
function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <span id={id} className="text-[13.5px] font-medium text-ink-2">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-[12px] bg-well p-1"
      >
        {options.map((option, index) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => arrowTo(event, options, index, (next) => onChange(next.value))}
              className={cn(
                'min-h-11 rounded-[9px] px-1.5 py-1 text-[14px] leading-tight font-medium transition-colors disabled:opacity-50 lg:min-h-9 lg:text-[13.5px]',
                on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
              )}
            >
              {option.label}
              {option.detail && (
                <span className="mono-num mt-0.5 block text-[11px] font-normal text-muted">
                  {option.detail}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-[12.5px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

/** Work in progress: what's happening, how far along, and a way to stop. */
function Progress({
  name,
  done,
  total,
  label,
  onCancel,
}: {
  name: string;
  done: number;
  total: number;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-[14px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="flex items-center gap-2.5">
        <Icon name="loader" size={16} className="shrink-0 animate-spin text-muted" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2">{label}</span>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 shrink-0 rounded-[10px] px-3 text-[14px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-9 lg:text-[13.5px]"
        >
          Cancel
        </button>
      </div>
      <div
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total}`}
        className="h-1.5 overflow-hidden rounded-full bg-well"
      >
        <span
          className="block h-full rounded-full bg-[var(--accent,var(--color-signal))] transition-[width] duration-300"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/** On a phone a result lands below the settings: bring it into view once it's there. */
function useShowOnPhone(ready: boolean) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready || !window.matchMedia('(max-width: 1023px)').matches) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
  }, [ready]);
  return target;
}

function SampleButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mx-auto flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-signal-ink transition-colors hover:bg-signal-soft disabled:opacity-50 lg:h-9 lg:text-[13.5px]"
    >
      <Icon name="sparkles" size={15} />
      {children}
    </button>
  );
}

const percent = (box: { left: number; top: number; width: number; height: number }) =>
  ({
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
  }) satisfies CSSProperties;

/** A page drawn to scale: white paper, with the picture exactly where it will sit. */
function PagePreview({
  layout,
  thumb,
  problem,
  className,
}: {
  layout?: PageLayout;
  thumb?: string;
  problem?: string;
  className?: string;
}) {
  const boxes = layout && previewBoxes(layout, FRAME);
  return (
    <span className={cn('relative block aspect-[4/5]', className)}>
      {problem ? (
        <span className="absolute inset-[6%] grid place-items-center rounded-[8px] bg-critical-soft px-2 text-center text-[12px] leading-snug text-critical">
          <span>
            <Icon name="alert" size={16} className="mx-auto mb-1" />
            {problem}
          </span>
        </span>
      ) : boxes ? (
        <span
          className="absolute overflow-hidden rounded-[2px] bg-white shadow-[0_0_0_1px_rgb(0_0_0/.06),0_10px_22px_-12px_rgb(0_0_0/.75)]"
          style={percent(boxes.sheet)}
        >
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt=""
              draggable={false}
              className="absolute block max-w-none animate-fade"
              style={percent(boxes.picture)}
            />
          )}
        </span>
      ) : (
        <span className="skeleton absolute inset-[10%]" />
      )}
    </span>
  );
}

/* ---------------- Images → PDF: reading and redrawing pictures ---------------- */

async function decode(file: Blob) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    // Browsers from before "from-image" reject the option itself; they turn photos anyway.
    if (error instanceof TypeError) return createImageBitmap(file);
    throw error;
  }
}

const unreadable = (file: File) =>
  kindOf(file) === 'heic'
    ? `“${file.name}” is an iPhone HEIC photo, and only Safari opens those. Open this page in Safari, or share the photo as a JPG.`
    : `“${file.name}” couldn’t be opened here. Try JPG, PNG, WebP or GIF.`;

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('This picture is too big to save here.'))),
      type,
      quality,
    ),
  );
}

/** The picture as it's seen (turned upright), shrunk for its tile, and its real size. */
async function readPicture(file: File): Promise<{ thumb: string; size: Size }> {
  const bitmap = await decode(file);
  const size = { width: bitmap.width, height: bitmap.height };
  const scale = Math.min(1, THUMB_SIDE / Math.max(size.width, size.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size.width * scale));
  canvas.height = Math.max(1, Math.round(size.height * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    // See-through parts show white, as they will on the page.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { thumb: canvas.toDataURL('image/jpeg', 0.8), size };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Looks for see-through pixels a band at a time, so a big picture never needs one huge copy. */
function seeThrough(context: CanvasRenderingContext2D, size: Size) {
  const rows = Math.max(1, Math.floor(1_000_000 / size.width));
  for (let top = 0; top < size.height; top += rows) {
    const band = context.getImageData(0, top, size.width, Math.min(rows, size.height - top));
    if (hasTransparency(band.data)) return true;
  }
  return false;
}

/** A picture redrawn as a JPEG (or a PNG, if it has see-through parts) a PDF can hold. */
async function redraw(
  file: File,
  smaller: boolean,
  opaque: boolean,
): Promise<PdfImage & { capped: boolean }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error(unreadable(file));
  }
  const size = redrawSize(bitmap, smaller);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: !opaque });
    if (!context) throw new Error('This browser couldn’t draw the picture.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const type = redrawType(!opaque && seeThrough(context, size));
    const blob = await toBlob(canvas, type, smaller ? SMALLER.quality : REDRAW_QUALITY);
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      format: type === 'image/png' ? 'png' : 'jpeg',
      orientation: 1,
      capped: size.capped,
    };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * One picture, ready for the PDF: the original bytes when a PDF can take them (the lossless
 * path), otherwise a redrawn copy. With "Make it smaller", whichever of the two is lighter.
 */
async function sourceFor(
  file: File,
  smaller: boolean,
  notes: { capped: number },
): Promise<PdfSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffImage(bytes);
  const orientation = format === 'jpeg' ? jpegOrientation(bytes) : 1;
  const plan = embedPlan(format, orientation, smaller);
  const opaque = format === 'jpeg';
  let redrawn: Awaited<ReturnType<typeof redraw>> | null = null;
  if (plan.redraw) {
    try {
      redrawn = await redraw(file, smaller, opaque);
    } catch (error) {
      // Only "Make it smaller" wanted a redraw: the original still goes in as it is.
      if (!plan.original) throw error;
    }
  }
  if (plan.original && format && (!redrawn || bytes.length <= redrawn.bytes.length))
    return {
      bytes,
      format,
      orientation,
      fallback: async () => redrawn ?? redraw(file, smaller, opaque),
    };
  if (!redrawn) throw new Error(unreadable(file));
  if (redrawn.capped) notes.capped += 1;
  return redrawn;
}

/** Three photos drawn on this device, plainly samples, so the tool can be tried right away. */
async function samplePhotos(): Promise<File[]> {
  // A seeded wobble, so the samples come out the same every time.
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const shoot = async (
    name: string,
    width: number,
    height: number,
    draw: (context: CanvasRenderingContext2D) => void,
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    draw(context);
    // Grain, so it weighs what a real photo weighs rather than a flat drawing.
    for (let index = 0; index < 40000; index += 1) {
      context.fillStyle = `rgba(${random() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + random() * 0.05})`;
      context.fillRect(random() * width, random() * height, 4 + random() * 14, 3);
    }
    const blob = await toBlob(canvas, 'image/jpeg', 0.92);
    canvas.width = 0;
    canvas.height = 0;
    return new File([blob], name, { type: 'image/jpeg' });
  };

  const sunset = await shoot('Sample sunset.jpg', 3200, 2400, (context) => {
    const sky = context.createLinearGradient(0, 0, 0, 1700);
    sky.addColorStop(0, '#f08f63');
    sky.addColorStop(0.55, '#f7c98f');
    sky.addColorStop(1, '#efe2c8');
    context.fillStyle = sky;
    context.fillRect(0, 0, 3200, 2400);
    context.fillStyle = '#fff3d6';
    context.beginPath();
    context.arc(2150, 900, 220, 0, Math.PI * 2);
    context.fill();
    const hills: [string, number, number][] = [
      ['#c08a66', 0.55, 150],
      ['#94664c', 0.64, 120],
      ['#5f4636', 0.76, 95],
      ['#33291f', 0.88, 70],
    ];
    for (const [color, base, amplitude] of hills) {
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(0, 2400);
      for (let x = 0; x <= 3200; x += 80)
        context.lineTo(x, 2400 * base + Math.sin(x / 330 + base * 9) * amplitude + random() * 30);
      context.lineTo(3200, 2400);
      context.fill();
    }
  });

  const doorway = await shoot('Sample doorway.jpg', 2400, 3200, (context) => {
    const wall = context.createLinearGradient(0, 0, 2400, 0);
    wall.addColorStop(0, '#e2a47e');
    wall.addColorStop(1, '#c8744d');
    context.fillStyle = wall;
    context.fillRect(0, 0, 2400, 3200);
    context.fillStyle = '#b8aea0';
    context.fillRect(0, 2660, 2400, 540);
    context.fillStyle = '#d3cabd';
    context.fillRect(560, 2560, 1280, 110);
    // The door: a pale arch around a teal door with two panels and a brass knob.
    const arch = (x: number, top: number, width: number, bottom: number) => {
      context.beginPath();
      context.moveTo(x, bottom);
      context.lineTo(x, top + width / 2);
      context.arc(x + width / 2, top + width / 2, width / 2, Math.PI, 0);
      context.lineTo(x + width, bottom);
      context.closePath();
      context.fill();
    };
    context.fillStyle = '#f2e7d8';
    arch(640, 620, 1120, 2560);
    context.fillStyle = '#2f6f73';
    arch(720, 700, 960, 2560);
    context.fillStyle = '#28605f';
    context.fillRect(820, 1320, 320, 560);
    context.fillRect(1260, 1320, 320, 560);
    context.fillRect(820, 1980, 320, 480);
    context.fillRect(1260, 1980, 320, 480);
    context.fillStyle = '#d8b45c';
    context.beginPath();
    context.arc(1560, 1900, 30, 0, Math.PI * 2);
    context.fill();
    // A potted plant by the step.
    context.fillStyle = '#b4552e';
    context.beginPath();
    context.moveTo(1880, 2320);
    context.lineTo(2200, 2320);
    context.lineTo(2150, 2660);
    context.lineTo(1930, 2660);
    context.closePath();
    context.fill();
    for (let leaf = 0; leaf < 14; leaf += 1) {
      context.fillStyle = leaf % 2 ? '#4f8a4b' : '#3d7040';
      context.beginPath();
      context.ellipse(
        2040 + (random() - 0.5) * 260,
        2140 - random() * 320,
        44,
        150,
        (random() - 0.5) * 1.6,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    const shade = context.createLinearGradient(0, 0, 2400, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.16)');
    context.fillStyle = shade;
    context.fillRect(0, 0, 2400, 3200);
  });

  const notes = await shoot('Sample notes.jpg', 2400, 1800, (context) => {
    context.fillStyle = '#8b5e3c';
    context.fillRect(0, 0, 2400, 1800);
    for (let line = 0; line < 70; line += 1) {
      const y = random() * 1800;
      context.strokeStyle = `rgba(60,35,20,${0.2 + random() * 0.25})`;
      context.lineWidth = 3 + random() * 8;
      context.beginPath();
      context.moveTo(0, y);
      for (let x = 0; x <= 2400; x += 120) context.lineTo(x, y + Math.sin(x / 260 + line) * 14);
      context.stroke();
    }
    // A sheet of lined paper, slightly turned, with a few lines of handwriting.
    context.save();
    context.translate(1150, 900);
    context.rotate(-0.05);
    context.fillStyle = 'rgba(0,0,0,0.28)';
    context.fillRect(-730, -520, 1500, 1100);
    context.fillStyle = '#fbfaf5';
    context.fillRect(-750, -550, 1500, 1100);
    context.strokeStyle = '#b9d3ee';
    context.lineWidth = 3;
    for (let y = -390; y < 530; y += 72) {
      context.beginPath();
      context.moveTo(-750, y);
      context.lineTo(750, y);
      context.stroke();
    }
    context.strokeStyle = '#e8a0a0';
    context.beginPath();
    context.moveTo(-600, -550);
    context.lineTo(-600, 550);
    context.stroke();
    context.fillStyle = '#27327a';
    context.font = 'italic 600 86px Georgia, serif';
    context.fillText('Sample notes', -560, -420);
    context.strokeStyle = '#2b3a8f';
    context.lineWidth = 6;
    context.lineCap = 'round';
    for (let row = 0; row < 9; row += 1) {
      const y = -330 + row * 72;
      const end = 200 + random() * 480;
      context.beginPath();
      context.moveTo(-560, y);
      for (let x = -560; x < end; x += 34)
        context.quadraticCurveTo(x + 17, y - 26 * random(), x + 34, y - 4 + 8 * random());
      context.stroke();
    }
    context.restore();
  });

  return [sunset, doorway, notes];
}

/* ---------------- Images → PDF ---------------- */

type Picture = {
  id: number;
  file: File;
  status: 'reading' | 'ready' | 'unreadable';
  /** A small JPEG of the picture as it's seen, for its page preview. */
  thumb?: string;
  /** Its size as it's seen, in pixels. */
  size?: Size;
};

type MadePdf = {
  url: string;
  name: string;
  bytes: number;
  /** What the pictures weighed. */
  before: number;
  pages: number;
  smaller: boolean;
  covers: { id: number; layout: PageLayout }[];
  /** What it was made from, to tell when it's out of date. */
  from: string;
  notes: string[];
};

function ImagesToPdf({
  ref,
  hidden,
  onPdfs,
  onStarted,
}: {
  ref: Ref<Intake>;
  hidden: boolean;
  onPdfs: (files: File[]) => void;
  onStarted: (started: boolean) => void;
}) {
  const id = useId();
  const [items, setItems] = useState<Picture[]>([]);
  const started = items.length > 0;
  useEffect(() => onStarted(started), [started, onStarted]);
  const [setup, setSetup] = useState<PageSetup>(DEFAULT_SETUP);
  const [smaller, setSmaller] = useState(false);
  const [job, setJob] = useState<{ done: number; total: number; label: string } | null>(null);
  const [made, setMade] = useState<MadePdf | null>(null);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const nextId = useRef(0);
  /** Pictures still in the list: a removed one isn't read. */
  const live = useRef(new Set<number>());
  const reading = useRef<Promise<void>>(Promise.resolve());
  const building = useRef<AbortController | null>(null);
  const madeUrl = useRef<string | null>(null);
  const moreInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ids = live.current;
    const build = building;
    const url = madeUrl;
    return () => {
      ids.clear();
      build.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  const busy = job !== null;
  const usable = items.filter((item) => item.status !== 'unreadable');
  const from = JSON.stringify([usable.map((item) => item.id), setup, smaller]);
  const stale = made !== null && made.from !== from;
  const weight = usable.reduce((sum, item) => sum + item.file.size, 0);

  function patch(pictureId: number, change: Partial<Picture>) {
    setItems((current) =>
      current.map((item) => (item.id === pictureId ? { ...item, ...change } : item)),
    );
  }

  function clearMade() {
    if (madeUrl.current) URL.revokeObjectURL(madeUrl.current);
    madeUrl.current = null;
    setMade(null);
  }

  function read(entries: Picture[]) {
    // One at a time: a phone decoding sixty photos at once would run out of memory.
    reading.current = reading.current.then(async () => {
      for (const entry of entries) {
        if (!live.current.has(entry.id)) continue;
        try {
          patch(entry.id, { status: 'ready', ...(await readPicture(entry.file)) });
        } catch {
          patch(entry.id, { status: 'unreadable' });
          setNotice(unreadable(entry.file));
        }
      }
    });
  }

  function add(files: File[]) {
    if (busy || !files.length) return;
    const pictures: File[] = [];
    const pdfFiles: File[] = [];
    const others: string[] = [];
    const heavy: string[] = [];
    let left = 0;
    for (const file of files) {
      const kind = kindOf(file);
      if (kind === 'pdf') pdfFiles.push(file);
      else if (kind === 'other') others.push(file.name);
      else if (file.size > MAX_IMAGE_BYTES) heavy.push(file.name);
      else if (items.length + pictures.length >= MAX_IMAGES) left += 1;
      else pictures.push(file);
    }
    // Only PDFs: they belong on the other side.
    if (pdfFiles.length && !pictures.length && !others.length && !heavy.length) {
      onPdfs(pdfFiles);
      return;
    }
    const notes: string[] = [];
    if (pictures.length) {
      const entries = pictures.map((file) => ({
        id: nextId.current++,
        file,
        status: 'reading' as const,
      }));
      entries.forEach((entry) => live.current.add(entry.id));
      setItems((current) => [...current, ...entries]);
      read(entries);
      notes.push(`Added ${plural(pictures.length, 'picture')}.`);
    }
    if (pdfFiles.length)
      notes.push(
        `${names(pdfFiles.map((file) => file.name))} ${pdfFiles.length === 1 ? 'is a PDF' : 'are PDFs'}. To turn PDF pages into images, choose PDF → images above.`,
      );
    if (others.length)
      notes.push(
        `${names(others)} ${others.length === 1 ? 'isn’t a picture' : 'aren’t pictures'} Convert can read. Try JPG, PNG, WebP or GIF.`,
      );
    if (heavy.length)
      notes.push(
        `${names(heavy)} ${heavy.length === 1 ? 'is' : 'are'} over 40 MB, the most Convert takes for one picture.`,
      );
    if (left)
      notes.push(
        `Up to ${MAX_IMAGES} pictures go in one PDF: ${plural(left, 'picture')} left out.`,
      );
    setNotice(notes.join(' '));
  }

  useImperativeHandle(ref, () => ({ take: add }));

  async function trySamples() {
    setDrawing(true);
    setNotice('Drawing three sample photos…');
    try {
      add(await samplePhotos());
    } catch {
      setNotice('We couldn’t draw the samples here. Choose your own pictures instead.');
    } finally {
      setDrawing(false);
    }
  }

  function move(from: number, to: number, announce = true) {
    if (busy || from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    if (announce) setNotice(`Moved “${moved.file.name}” to number ${to + 1} of ${next.length}.`);
  }

  function remove(picture: Picture) {
    if (busy) return;
    live.current.delete(picture.id);
    setItems((current) => current.filter((item) => item.id !== picture.id));
    setNotice(`Removed “${picture.file.name}”.`);
  }

  function startOver() {
    building.current?.abort();
    live.current.clear();
    clearMade();
    setItems([]);
    setNotice('');
    setStatus('');
  }

  async function makePdf() {
    if (busy || !usable.length) return;
    const list = usable;
    const total = list.length;
    const controller = new AbortController();
    building.current = controller;
    clearMade();
    setStatus('');
    setJob({ done: 0, total, label: `Adding 1 of ${total}` });
    const notes = { capped: 0 };
    const left: Picture[] = [];
    try {
      const result = await buildPdf(
        total,
        async (index) => {
          const picture = list[index];
          setJob({
            done: index,
            total,
            label: `Adding ${index + 1} of ${total}: ${picture.file.name}`,
          });
          try {
            return await sourceFor(picture.file, smaller, notes);
          } catch (error) {
            // Running out of memory isn't about this picture: stop and say so.
            if (error instanceof RangeError || controller.signal.aborted) throw error;
            left.push(picture);
            patch(picture.id, { status: 'unreadable' });
            return null;
          }
        },
        setup,
        {
          signal: controller.signal,
          onProgress: (done) =>
            done === total && setJob({ done, total, label: 'Putting the PDF together…' }),
        },
      );
      if (controller.signal.aborted) return;
      // pdf-lib's bytes sit in a plain ArrayBuffer: hand them over without copying a big PDF.
      const blob = new Blob([result.bytes as Uint8Array<ArrayBuffer>], {
        type: 'application/pdf',
      });
      const url = URL.createObjectURL(blob);
      madeUrl.current = url;
      const included = result.pages.map(({ index }) => list[index]);
      const notices: string[] = [];
      if (notes.capped)
        notices.push(
          `${plural(notes.capped, 'picture')} ${notes.capped === 1 ? 'was' : 'were'} bigger than this browser can draw, so ${notes.capped === 1 ? 'it was' : 'they were'} scaled down to 16 megapixels.`,
        );
      if (left.length)
        notices.push(
          `Left out ${names(left.map((item) => item.file.name))}: ${left.length === 1 ? 'it' : 'they'} couldn’t be opened here.`,
        );
      setMade({
        url,
        name: pdfName(included.map((item) => item.file.name)),
        bytes: blob.size,
        before: included.reduce((sum, item) => sum + item.file.size, 0),
        pages: included.length,
        smaller,
        covers: result.pages
          .slice(0, 3)
          .map(({ index, layout }) => ({ id: list[index].id, layout })),
        from: JSON.stringify([included.map((item) => item.id), setup, smaller]),
        notes: notices,
      });
      setStatus(
        `Your PDF is ready: ${plural(included.length, 'page')}, ${formatBytes(blob.size)}.`,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        if (building.current === controller) setStatus('Stopped. No PDF was made.');
      } else if (error instanceof RangeError) {
        setStatus(
          'This browser ran out of memory making the PDF. Turn on Make it smaller, or make two smaller PDFs.',
        );
      } else {
        setStatus(
          error instanceof Error && error.message
            ? error.message
            : 'We couldn’t make that PDF. Try fewer pictures.',
        );
      }
    } finally {
      if (building.current === controller) building.current = null;
      setJob(null);
    }
  }

  const paper = setup.size !== 'fit';
  const thumbOf = (pictureId: number) => items.find((item) => item.id === pictureId)?.thumb;
  /** Page numbers skip pictures that can't be opened: they're left out of the PDF. */
  const pageOf = new Map(usable.map((item, index) => [item.id, index + 1]));
  const change = made && sizeChange(made.before, made.bytes);
  const madeCard = useShowOnPhone(made !== null && !stale);

  return (
    <section
      hidden={hidden}
      aria-label="Images to PDF"
      className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start"
    >
      <Surface className="grid grid-cols-1 content-start gap-4">
        {items.length === 0 ? (
          <div className="grid gap-3">
            <FileDrop
              onFiles={add}
              accept="image/*"
              icon="file-image"
              accent="var(--accent)"
              title="Choose photos or scans"
              hint={`Each one becomes a page, in the order you set. Up to ${MAX_IMAGES}.`}
              disabled={busy || drawing}
            />
            <SampleButton onClick={trySamples} disabled={drawing}>
              {drawing ? 'Drawing sample photos…' : 'Try with sample photos'}
            </SampleButton>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <Icon name="grip" size={14} /> Drag, or use the arrows, to set the order
              </p>
              <p className="mono-num text-[12px] text-faint">
                {items.length}/{MAX_IMAGES} · {formatBytes(weight)}
              </p>
            </div>
            <ol
              aria-label="Pages, in order"
              onDragOver={(event) => {
                if (!hasFiles(event) || busy) return;
                event.preventDefault();
                setOver(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setOver(false);
              }}
              onDrop={(event) => {
                if (!hasFiles(event)) return;
                event.preventDefault();
                setOver(false);
                add(Array.from(event.dataTransfer.files));
              }}
              className={cn(
                '-mx-1 grid max-h-[680px] grid-cols-2 gap-1 overflow-y-auto rounded-[16px] p-1 transition-shadow sm:grid-cols-3 xl:grid-cols-4',
                over && 'shadow-[inset_0_0_0_2px_var(--color-signal)]',
              )}
            >
              {items.map((item, index) => {
                const number = pageOf.get(item.id);
                const problem =
                  item.status === 'unreadable'
                    ? kindOf(item.file) === 'heic'
                      ? 'HEIC opens only in Safari'
                      : 'Can’t open this one here'
                    : undefined;
                return (
                  <li
                    key={item.id}
                    draggable={!busy}
                    onDragStart={(event) => {
                      setDragging(index);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', item.file.name);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => {
                      if (dragging === null) return;
                      event.preventDefault();
                      if (dragging !== index) {
                        move(dragging, index, false);
                        setDragging(index);
                      }
                    }}
                    onDrop={(event) => {
                      if (dragging !== null) event.preventDefault();
                    }}
                    className={cn(
                      'group relative min-w-0 animate-rise rounded-[16px] p-2 transition-colors',
                      !busy && 'cursor-grab active:cursor-grabbing',
                      dragging === index
                        ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                        : 'hover:bg-subtle',
                    )}
                  >
                    <div className="relative">
                      <PagePreview
                        layout={item.size && layoutPage(item.size, setup)}
                        thumb={item.thumb}
                        problem={problem}
                      />
                      {number !== undefined && (
                        <span className="mono-num absolute top-1 left-1 grid h-6 min-w-6 place-items-center rounded-full bg-ink px-1.5 text-[11px] font-medium text-on-ink shadow-lift">
                          {number}
                        </span>
                      )}
                    </div>
                    <p
                      className="mt-2 truncate px-1 text-[13px] font-medium text-ink"
                      title={item.file.name}
                    >
                      {item.file.name}
                    </p>
                    <p className="mono-num truncate px-1 text-[11.5px] text-muted">
                      {item.size
                        ? `${item.size.width}×${item.size.height} · ${formatBytes(item.file.size)}`
                        : item.status === 'reading'
                          ? 'Reading…'
                          : formatBytes(item.file.size)}
                    </p>
                    <div className="mt-1 flex">
                      <TileButton
                        icon="arrow-left"
                        label={`Move “${item.file.name}” earlier`}
                        off={busy || index === 0}
                        onClick={() => move(index, index - 1)}
                      />
                      <TileButton
                        icon="arrow-right"
                        label={`Move “${item.file.name}” later`}
                        off={busy || index === items.length - 1}
                        onClick={() => move(index, index + 1)}
                      />
                      <TileButton
                        icon="x"
                        label={`Remove “${item.file.name}”`}
                        off={busy}
                        danger
                        onClick={() => remove(item)}
                        className="ml-auto"
                      />
                    </div>
                  </li>
                );
              })}
              {items.length < MAX_IMAGES && (
                <li className="p-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => moreInput.current?.click()}
                    className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-line-strong bg-subtle text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-well hover:text-ink disabled:opacity-50"
                  >
                    <span
                      className="grid size-9 place-items-center rounded-full text-[#12110d]"
                      style={{ background: 'var(--accent)' }}
                    >
                      <Icon name="plus" size={18} />
                    </span>
                    Add more
                  </button>
                  <input
                    ref={moreInput}
                    type="file"
                    accept="image/*"
                    multiple
                    tabIndex={-1}
                    aria-hidden="true"
                    className="sr-only"
                    onChange={(event) => {
                      add(Array.from(event.target.files ?? []));
                      event.target.value = '';
                    }}
                  />
                </li>
              )}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={startOver}
                className="h-11 rounded-[10px] px-3 text-[14px] font-medium text-muted hover:bg-ink/5 hover:text-ink lg:h-9 lg:text-[13.5px]"
              >
                Start over
              </button>
              {items.some((item) => item.status === 'unreadable') && (
                <span className="text-[12.5px] text-caution">
                  Pictures that can’t be opened are left out.
                </span>
              )}
            </div>
          </>
        )}
        {/* Always in the page, so screen readers announce what lands in it. */}
        <p
          aria-live="polite"
          className={cn(
            'text-[13px] leading-relaxed [overflow-wrap:anywhere] text-muted',
            !notice && 'sr-only',
          )}
        >
          {notice}
        </p>
      </Surface>

      {/* Settings wait for pictures: there's nothing to decide before then. */}
      <aside
        aria-label="Page setup and your PDF"
        className={cn(
          'min-w-0 grid-cols-1 gap-4 lg:sticky lg:top-24 lg:grid',
          items.length ? 'grid' : 'hidden',
        )}
      >
        <Surface className={cn('grid-cols-1 gap-4', items.length ? 'grid' : 'hidden')}>
          <h2 className="label">Pages</h2>
          <Choice<PageSetup['size']>
            label="Page size"
            value={setup.size}
            disabled={busy}
            onChange={(size) => setSetup({ ...setup, size })}
            options={[
              { value: 'fit', label: 'Fit image' },
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'US Letter' },
            ]}
            hint={
              paper
                ? `Every page is ${setup.size === 'a4' ? 'A4' : 'US Letter'}, with the picture centered and kept in shape.`
                : 'Each page fits its image: the picture’s own shape, edge to edge.'
            }
          />
          {paper && (
            <MoreOptions
              label="Orientation and margins"
              summary={`${setup.orientation === 'auto' ? 'Auto' : setup.orientation === 'portrait' ? 'Portrait' : 'Landscape'} · ${setup.margin === 'none' ? 'no' : setup.margin} margin`}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <Choice<PageSetup['orientation']>
                  label="Orientation"
                  value={setup.orientation}
                  disabled={busy}
                  onChange={(orientation) => setSetup({ ...setup, orientation })}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'portrait', label: 'Portrait' },
                    { value: 'landscape', label: 'Landscape' },
                  ]}
                  hint={
                    setup.orientation === 'auto'
                      ? 'Each page turns to suit its picture.'
                      : `Every page ${setup.orientation === 'portrait' ? 'upright' : 'on its side'}; pictures shrink to fit.`
                  }
                />
                <Choice<PageSetup['margin']>
                  label="Margin"
                  value={setup.margin}
                  disabled={busy}
                  onChange={(margin) => setSetup({ ...setup, margin })}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'small', label: 'Small' },
                    { value: 'normal', label: 'Normal' },
                  ]}
                />
              </div>
            </MoreOptions>
          )}
          <label
            htmlFor={`${id}-smaller`}
            className="flex cursor-pointer items-start gap-3 rounded-[14px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            <input
              id={`${id}-smaller`}
              type="checkbox"
              checked={smaller}
              disabled={busy}
              onChange={(event) => setSmaller(event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-ink">Make it smaller</span>
              <span className="block text-[12.5px] leading-snug text-muted">
                Easier to email, still sharp on screen.
              </span>
            </span>
          </label>
          <button
            type="button"
            onClick={makePdf}
            disabled={busy || usable.length === 0}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-[16px] bg-[var(--accent)] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent)] transition-[transform,opacity] active:scale-[.985] disabled:opacity-40 disabled:shadow-none sm:h-13 sm:text-[16px]"
          >
            <Icon name="file-stack" size={17} />
            {stale
              ? 'Make the PDF again'
              : usable.length
                ? `Make a ${usable.length}-page PDF`
                : 'Make PDF'}
          </button>
          {job && (
            <Progress
              name="Making the PDF"
              done={job.done}
              total={job.total}
              label={job.label}
              onCancel={() => building.current?.abort()}
            />
          )}
          <p
            role="status"
            className="min-h-5 text-[13px] leading-relaxed [overflow-wrap:anywhere] text-muted"
          >
            {status ||
              (items.length === 0
                ? 'Add pictures to begin.'
                : usable.length === 0
                  ? 'None of these pictures can be opened here.'
                  : '')}
          </p>
        </Surface>

        <div
          ref={madeCard}
          className={cn(
            'scroll-mb-4 rounded-[24px] p-5 transition-colors duration-300 sm:p-6',
            made
              ? ACCENT_TINT
              : 'hidden bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] lg:block',
          )}
        >
          {made ? (
            <div className="animate-rise">
              <div className={cn('relative mx-auto h-[190px] w-[152px]', stale && 'opacity-50')}>
                {made.covers
                  .map((cover, index) => ({ cover, index }))
                  .reverse()
                  .map(({ cover, index }) => (
                    // Fanned out, first page on top.
                    <span
                      key={index}
                      className="absolute inset-0 transition-transform duration-500"
                      style={{
                        transform: `translateX(${[0, 16, -16][index]}px) rotate(${[0, 5, -5][index]}deg)`,
                      }}
                    >
                      <PagePreview layout={cover.layout} thumb={thumbOf(cover.id)} />
                    </span>
                  ))}
                <span className="absolute -right-3 -bottom-2 rounded-full bg-ink px-2.5 py-1 text-[12px] font-medium text-on-ink shadow-lift">
                  {plural(made.pages, 'page')}
                </span>
              </div>
              <p className="mt-6 truncate text-center text-[15px] font-semibold text-ink">
                {made.name}
              </p>
              <p className="text-center text-[13px] text-ink-2">
                {plural(made.pages, 'page')} · {formatBytes(made.bytes)}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-[12px] bg-ink/5 px-2 py-2.5">
                  <dt className="label">Pictures</dt>
                  <dd className="mono-num mt-0.5 text-[15px] text-ink">
                    {formatBytes(made.before)}
                  </dd>
                </div>
                <div className="rounded-[12px] bg-ink/5 px-2 py-2.5">
                  <dt className="label">PDF</dt>
                  <dd className="mono-num mt-0.5 text-[15px] text-ink">
                    {formatBytes(made.bytes)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-center text-[12.5px] text-muted">
                {change === 'about the same'
                  ? 'About the same size as the pictures.'
                  : `${change?.replace(/^\w/, (letter) => letter.toUpperCase())} than the pictures.`}
                {!made.smaller && made.bytes > 5 * 1024 * 1024 && (
                  <> Need it lighter? Turn on Make it smaller.</>
                )}
              </p>
              <a
                href={made.url}
                download={made.name}
                className="mt-4 w-full inline-flex h-14 items-center justify-center gap-2 rounded-[16px] bg-[var(--accent)] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent)] transition-[transform,opacity] active:scale-[.985] disabled:opacity-40 disabled:shadow-none sm:h-13 sm:text-[16px]"
              >
                <Icon name="download" size={17} /> Download PDF
              </a>
              {stale && (
                <Note icon="refresh" tone="caution" className="mt-3">
                  You’ve changed things since this PDF was made. Make it again to include them.
                </Note>
              )}
              {made.notes.map((note) => (
                <p key={note} className="mt-3 text-[12.5px] text-muted">
                  {note}
                </p>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center">
              <div className="relative mx-auto h-[120px] w-[96px]" aria-hidden="true">
                <span className="absolute inset-0 rotate-[-7deg] rounded-[7px] bg-ink/[.05] shadow-[inset_0_0_0_1px_var(--color-line)]" />
                <span className="absolute inset-0 rotate-[5deg] rounded-[7px] bg-ink/[.07] shadow-[inset_0_0_0_1px_var(--color-line)]" />
                <span className="absolute inset-0 grid place-items-center rounded-[7px] border border-dashed border-line-strong bg-surface">
                  <Icon name="file-stack" size={26} className="text-faint" />
                </span>
              </div>
              <p className="mt-5 text-[14px] font-medium text-ink">Your PDF appears here</p>
              <p className="mt-1 text-[13px] text-muted">
                One page per picture, in the order shown.
              </p>
            </div>
          )}
        </div>
        {made && (
          <p className="px-1 text-[12.5px] leading-relaxed text-muted">
            Camera details and where a photo was taken aren’t copied into the PDF.
          </p>
        )}
      </aside>
    </section>
  );
}

/** Move and remove buttons on a picture tile. Stays focusable at the ends of the list. */
function TileButton({
  icon,
  label,
  off,
  danger,
  onClick,
  className,
}: {
  icon: IconName;
  label: string;
  off: boolean;
  danger?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={off || undefined}
      onClick={() => !off && onClick()}
      className={cn(
        'grid size-11 place-items-center rounded-[10px] text-muted transition-colors aria-disabled:opacity-30 lg:size-9',
        danger ? 'hover:bg-critical-soft hover:text-critical' : 'hover:bg-ink/[.07] hover:text-ink',
        className,
      )}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/* ---------------- PDF → images ---------------- */

type OpenedPdf = { id: number; file: File; pages: number; first: Size };
type PageImage = { index: number; name: string; blob: Blob; width: number; height: number };
type Rendered = {
  images: PageImage[];
  total: number;
  format: 'jpeg' | 'png';
  dpi: number;
  capped: number;
  failed: number[];
  zipName: string;
  from: string;
};

const openProblem = (error: unknown, name: string) => {
  const problem =
    error instanceof Error && error.name === 'PdfOpenError'
      ? (error as PdfOpenError).problem
      : null;
  if (problem === 'password')
    return `“${name}” is locked with a password, so it can’t be opened here. Remove the password in the app that made it, then try again.`;
  if (problem === 'damaged')
    return `“${name}” couldn’t be read. It may be damaged, or not really a PDF. Try saving it again.`;
  return 'We couldn’t open the PDF in this browser. Try again, or try another browser.';
};

function PdfToImages({
  ref,
  hidden,
  onImages,
  onStarted,
}: {
  ref: Ref<Intake>;
  hidden: boolean;
  onImages: (files: File[]) => void;
  onStarted: (started: boolean) => void;
}) {
  const id = useId();
  const [opened, setOpened] = useState<OpenedPdf | null>(null);
  const started = opened !== null;
  useEffect(() => onStarted(started), [started, onStarted]);
  const [opening, setOpening] = useState<string | null>(null);
  /** Page thumbnails: a data URL, `null` when a page can't be drawn, undefined until it is. */
  const [thumbs, setThumbs] = useState<(string | null | undefined)[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [range, setRange] = useState('');
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [resolution, setResolution] = useState<Resolution>('sharp');
  const [job, setJob] = useState<{ done: number; total: number } | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [zipping, setZipping] = useState(false);
  const [notice, setNotice] = useState<{ text: ReactNode; tone: 'quiet' | 'caution' } | null>(null);
  const [status, setStatus] = useState('');
  const doc = useRef<RenderablePdf | null>(null);
  const generation = useRef(0);
  const running = useRef<AbortController | null>(null);
  const otherInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const pdf = doc;
    const runs = generation;
    const task = running;
    return () => {
      runs.current += 1; // stops thumbnails and renders still on their way
      task.current?.abort();
      pdf.current?.close();
    };
  }, []);

  const busy = job !== null;
  const chosen = new Set(picked);
  const from = JSON.stringify([opened?.id, picked, format, resolution]);
  const stale = rendered !== null && rendered.from !== from;
  const dpi = RESOLUTIONS[resolution].dpi;
  const label = format === 'png' ? 'PNG' : 'JPG';

  async function open(file: File) {
    const run = ++generation.current;
    running.current?.abort();
    doc.current?.close();
    doc.current = null;
    setOpened(null);
    setThumbs([]);
    setPicked([]);
    setRange('');
    setRendered(null);
    setJob(null);
    setStatus('');
    setNotice(null);
    if (file.size > MAX_PDF_BYTES) {
      setNotice({
        text: `“${file.name}” is ${formatBytes(file.size)}. Convert opens PDFs up to 50 MB.`,
        tone: 'caution',
      });
      return;
    }
    setOpening(file.name);
    try {
      const { openRenderablePdf } = await import('@/lib/tools/pdf-render');
      const pdf = await openRenderablePdf(file);
      if (run !== generation.current) return pdf.close();
      if (pdf.pages > MAX_PDF_PAGES) {
        pdf.close();
        setNotice({
          text: (
            <>
              “{file.name}” has {pdf.pages} pages. Convert takes up to {MAX_PDF_PAGES} at a time:
              pull out the pages you need with the{' '}
              <Link href="/tools/pdf" className="font-medium underline underline-offset-2">
                PDF tool
              </Link>{' '}
              first.
            </>
          ),
          tone: 'caution',
        });
        return;
      }
      const size = await pdf.size(0);
      if (run !== generation.current) return pdf.close();
      doc.current = pdf;
      const all = Array.from({ length: pdf.pages }, (_, index) => index);
      setOpened({ id: run, file, pages: pdf.pages, first: size });
      setPicked(all);
      setRange(formatRange(all));
      setThumbs(all.map(() => undefined));
      setOpening(null);
      // In page order, so the first pages appear first.
      for (const index of all) {
        let src: string | null;
        try {
          src = await pdf.thumb(index, PAGE_THUMB_WIDTH);
        } catch {
          src = null;
        }
        if (run !== generation.current) return;
        setThumbs((current) => current.map((item, position) => (position === index ? src : item)));
      }
    } catch (error) {
      if (run !== generation.current) return;
      setNotice({ text: openProblem(error, file.name), tone: 'caution' });
    } finally {
      if (run === generation.current) setOpening(null);
    }
  }

  function take(files: File[]) {
    if (busy || !files.length) return;
    const pdfFiles = files.filter((file) => kindOf(file) === 'pdf');
    if (!pdfFiles.length) {
      const pictures = files.filter((file) => ['image', 'heic'].includes(kindOf(file)));
      if (pictures.length) return onImages(pictures);
      setNotice({
        text: `${names(files.map((file) => file.name))} ${files.length === 1 ? 'isn’t a PDF' : 'aren’t PDFs'}. Choose a PDF to turn its pages into images.`,
        tone: 'caution',
      });
      return;
    }
    void open(pdfFiles[0]);
    if (files.length > 1)
      setNotice({
        text: `One PDF at a time: opening “${pdfFiles[0].name}”.`,
        tone: 'quiet',
      });
  }

  useImperativeHandle(ref, () => ({ take }));

  async function trySample() {
    setNotice(null);
    setOpening('a sample PDF');
    try {
      const { samplePdfs } = await import('@/lib/tools/pdf-samples');
      const [file] = await samplePdfs('extract');
      await open(file);
    } catch {
      setOpening(null);
      setNotice({
        text: 'We couldn’t make the sample here. Choose your own PDF instead.',
        tone: 'caution',
      });
    }
  }

  function toggle(index: number) {
    const next = chosen.has(index)
      ? picked.filter((item) => item !== index)
      : [...picked, index].sort((a, b) => a - b);
    setPicked(next);
    setRange(formatRange(next));
  }

  function typeRange(text: string) {
    setRange(text);
    setPicked(opened ? (parseRange(text, opened.pages) ?? []) : []);
  }

  async function makeImages() {
    const pdf = doc.current;
    if (!pdf || !opened || !picked.length || busy) return;
    const run = generation.current;
    const controller = new AbortController();
    running.current = controller;
    const pages = [...picked];
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    const base = baseName(opened.file.name);
    const images: PageImage[] = [];
    const failed: number[] = [];
    let capped = 0;
    const snapshot = () => ({
      images: [...images],
      total: pages.length,
      format,
      dpi,
      capped,
      failed: [...failed],
      zipName: pagesZipName(base, format),
      from,
    });
    setRendered(snapshot());
    setStatus('');
    setJob({ done: 0, total: pages.length });
    for (const [position, index] of pages.entries()) {
      if (controller.signal.aborted) break;
      try {
        const size = pagePixels(await pdf.size(index), dpi);
        if (size.capped) capped += 1;
        const blob = await pdf.render(index, {
          width: size.width,
          height: size.height,
          type,
          quality: format === 'png' ? undefined : PAGE_JPEG_QUALITY,
          signal: controller.signal,
        });
        images.push({
          index,
          name: pageImageName(base, index, opened.pages, format),
          blob,
          width: size.width,
          height: size.height,
        });
      } catch {
        if (controller.signal.aborted) break;
        failed.push(index);
      }
      if (run !== generation.current) return;
      setRendered(snapshot());
      setJob({ done: position + 1, total: pages.length });
    }
    if (run !== generation.current) return;
    if (running.current === controller) running.current = null;
    setJob(null);
    const weight = images.reduce((sum, image) => sum + image.blob.size, 0);
    setStatus(
      controller.signal.aborted
        ? `Stopped after ${images.length} of ${pages.length}. The finished ones are ready to download.`
        : `Done: ${plural(images.length, 'image')}, ${formatBytes(weight)}.`,
    );
  }

  async function downloadAll() {
    if (!rendered?.images.length || zipping) return;
    const [only] = rendered.images;
    if (rendered.images.length === 1) return download(only.blob, only.name);
    setZipping(true);
    try {
      const archive = await zip(
        rendered.images.map((image) => ({ name: image.name, data: image.blob })),
      );
      download(archive, rendered.zipName);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'We couldn’t make the zip. Download the pages one at a time instead.',
      );
    } finally {
      setZipping(false);
    }
  }

  const rangeInvalid = opened !== null && range.trim() !== '' && picked.length === 0;
  const weight = rendered?.images.reduce((sum, image) => sum + image.blob.size, 0) ?? 0;
  const imagesCard = useShowOnPhone(rendered !== null && !busy && rendered.images.length > 0);

  return (
    <section
      hidden={hidden}
      aria-label="PDF to images"
      className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start"
    >
      <Surface className="grid grid-cols-1 content-start gap-4">
        {!opened ? (
          <div className="grid gap-3">
            <FileDrop
              onFiles={take}
              accept=".pdf,application/pdf"
              multiple={false}
              icon="pdf"
              accent="var(--accent)"
              title={opening ? `Opening ${opening}…` : 'Choose a PDF'}
              hint="Each page becomes a picture you can save or share."
              disabled={opening !== null}
            />
            <SampleButton onClick={trySample} disabled={opening !== null}>
              Try a sample PDF
            </SampleButton>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-[14px] bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <span
                className="grid size-10 shrink-0 place-items-center rounded-[11px] text-[#12110d]"
                style={{ background: 'var(--accent)' }}
              >
                <Icon name="pdf" size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">
                  {opened.file.name}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {plural(opened.pages, 'page')} · {formatBytes(opened.file.size)}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => otherInput.current?.click()}
                className="h-11 shrink-0 rounded-[10px] px-3 text-[14px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink disabled:opacity-45 lg:h-9 lg:text-[13.5px]"
              >
                Change<span className="sr-only"> PDF</span>
              </button>
              <input
                ref={otherInput}
                type="file"
                accept=".pdf,application/pdf"
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
                onChange={(event) => {
                  take(Array.from(event.target.files ?? []).slice(0, 1));
                  event.target.value = '';
                }}
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1">
                <label
                  htmlFor={`${id}-range`}
                  className="mb-1.5 block text-[13.5px] font-medium text-ink-2"
                >
                  Pages to convert{' '}
                  <span className="font-normal text-muted">(1–{opened.pages})</span>
                </label>
                <Input
                  id={`${id}-range`}
                  value={range}
                  disabled={busy}
                  onChange={(event) => typeRange(event.target.value)}
                  placeholder="Tap pages below, or type 1-3, 5"
                  aria-invalid={rangeInvalid}
                  aria-describedby={rangeInvalid ? `${id}-range-problem` : undefined}
                  className={cn(rangeInvalid && '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]')}
                />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const everything = picked.length === opened.pages;
                  const next = everything
                    ? []
                    : Array.from({ length: opened.pages }, (_, index) => index);
                  setPicked(next);
                  setRange(formatRange(next));
                }}
                className="h-12 rounded-[11px] px-3.5 text-[14px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink disabled:opacity-45 lg:h-10 lg:text-[13.5px]"
              >
                {picked.length === opened.pages ? 'Select none' : 'Select all'}
              </button>
            </div>
            {rangeInvalid && (
              <p id={`${id}-range-problem`} className="-mt-2 text-[12.5px] text-caution">
                Pages go from 1 to {opened.pages}. Try something like 1-3, 5.
              </p>
            )}

            <ol
              aria-label="Pages"
              className="-mx-1 grid max-h-[620px] grid-cols-3 gap-1 overflow-y-auto p-1 sm:grid-cols-4 xl:grid-cols-5"
            >
              {thumbs.map((src, index) => {
                const on = chosen.has(index);
                return (
                  <li key={index}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`Page ${index + 1}`}
                      disabled={busy}
                      onClick={() => toggle(index)}
                      className={cn(
                        'relative block w-full rounded-[12px] p-1.5 transition-colors',
                        on ? 'bg-signal-soft' : 'hover:bg-subtle',
                      )}
                    >
                      {/* Dimmed on this wrapper: the image's fade-in animation holds its opacity. */}
                      <span
                        className={cn(
                          'relative block aspect-[3/4] transition-opacity',
                          picked.length > 0 && !on && 'opacity-40',
                        )}
                      >
                        {src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={src}
                            alt=""
                            className="absolute inset-0 h-full w-full animate-fade object-contain drop-shadow-[0_6px_10px_rgb(0_0_0/.45)]"
                          />
                        ) : src === null ? (
                          <span className="absolute inset-[6%] grid place-items-center rounded-[4px] bg-white text-[11px] text-[#6c685e]">
                            Can’t preview
                          </span>
                        ) : (
                          <span className="skeleton absolute inset-[8%]" />
                        )}
                      </span>
                      <span
                        className={cn(
                          'absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full transition-all',
                          on
                            ? 'scale-100 bg-signal text-white'
                            : 'scale-90 bg-white/90 text-transparent shadow-[inset_0_0_0_1.5px_rgb(22_21_15/.25)]',
                        )}
                        aria-hidden="true"
                      >
                        <Icon name="check" size={12} strokeWidth={3} />
                      </span>
                      <span
                        className={cn(
                          'mono-num mt-1 block text-center text-[11.5px]',
                          on ? 'font-medium text-signal-ink' : 'text-muted',
                        )}
                      >
                        {index + 1}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {/* Always in the page, so screen readers announce what lands in it. */}
        <div aria-live="polite" className={cn(!notice && 'sr-only')}>
          {notice && (
            <Note icon={notice.tone === 'caution' ? 'alert' : 'file-text'} tone={notice.tone}>
              <span className="[overflow-wrap:anywhere]">{notice.text}</span>
            </Note>
          )}
        </div>
      </Surface>

      {/* Settings wait for a PDF: there's nothing to decide before then. */}
      <aside
        aria-label="Image settings and your images"
        className={cn(
          'min-w-0 grid-cols-1 gap-4 lg:sticky lg:top-24 lg:grid',
          opened ? 'grid' : 'hidden',
        )}
      >
        <Surface className={cn('grid-cols-1 gap-4', opened ? 'grid' : 'hidden')}>
          <h2 className="label">Images</h2>
          <Choice<'jpeg' | 'png'>
            label="Format"
            value={format}
            disabled={busy}
            onChange={setFormat}
            options={[
              { value: 'jpeg', label: 'JPG', detail: 'Smaller files' },
              { value: 'png', label: 'PNG', detail: 'Exact, larger' },
            ]}
          />
          <Choice<Resolution>
            label="Quality"
            value={resolution}
            disabled={busy}
            onChange={setResolution}
            options={(Object.keys(RESOLUTIONS) as Resolution[]).map((value) => ({
              value,
              label: RESOLUTIONS[value].label,
            }))}
            hint={RESOLUTIONS[resolution].use}
          />
          {format === 'png' && resolution === 'print' && (
            <p className="-mt-1 text-[12.5px] text-muted">
              Print-size PNGs are big files. JPG is a fraction of the size.
            </p>
          )}
          <button
            type="button"
            onClick={makeImages}
            disabled={busy || !opened || picked.length === 0}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-[16px] bg-[var(--accent)] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent)] transition-[transform,opacity] active:scale-[.985] disabled:opacity-40 disabled:shadow-none sm:h-13 sm:text-[16px]"
          >
            <Icon name="file-image" size={17} />
            {picked.length ? `Make ${plural(picked.length, label)}` : `Make ${label}s`}
          </button>
          {job && (
            <Progress
              name="Making the images"
              done={job.done}
              total={job.total}
              label={`Page ${Math.min(job.done + 1, job.total)} of ${job.total}`}
              onCancel={() => running.current?.abort()}
            />
          )}
          <p
            role="status"
            className="min-h-5 text-[13px] leading-relaxed [overflow-wrap:anywhere] text-muted"
          >
            {status ||
              (opening
                ? `Opening ${opening}…`
                : !opened
                  ? 'Choose a PDF to begin.'
                  : picked.length === 0
                    ? 'Pick the pages to convert.'
                    : '')}
          </p>
        </Surface>

        <div
          ref={imagesCard}
          className={cn(
            'scroll-mb-4 rounded-[24px] p-5 transition-colors duration-300 sm:p-6',
            rendered?.images.length
              ? ACCENT_TINT
              : rendered && busy
                ? 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]'
                : 'hidden bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] lg:block',
          )}
        >
          {rendered && (rendered.images.length > 0 || busy) ? (
            <div className="animate-rise">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="label">Your images</p>
                  <p
                    className="mt-1 font-display text-[34px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                    style={{ fontVariationSettings: "'wdth' 110" }}
                  >
                    {rendered.images.length}
                    <span className="text-[16px] font-semibold tracking-normal text-muted">
                      {' '}
                      of {rendered.total}
                    </span>
                  </p>
                </div>
                <p className="mono-num text-right text-[12px] leading-relaxed text-muted">
                  {rendered.format === 'png' ? 'PNG' : 'JPG'}
                  <br />
                  {formatBytes(weight)}
                </p>
              </div>
              <ol
                aria-label="Images made"
                className={cn(
                  'row-divide mt-4 max-h-[340px] overflow-y-auto rounded-[14px] bg-surface/60 px-2 shadow-[inset_0_0_0_1px_var(--color-line)]',
                  stale && 'opacity-60',
                )}
              >
                {rendered.images.map((image) => (
                  <li key={image.index} className="flex items-center gap-3 py-2 pl-1">
                    <span className="relative block aspect-[3/4] w-9 shrink-0">
                      {thumbs[image.index] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbs[image.index] ?? undefined}
                          alt=""
                          className="absolute inset-0 h-full w-full object-contain"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* The page number stays in view: it's what tells the files apart. */}
                      <span
                        className="flex min-w-0 text-[13.5px] font-medium text-ink"
                        title={image.name}
                      >
                        <span className="truncate">
                          {image.name.slice(0, image.name.lastIndexOf('-page-'))}
                        </span>
                        <span className="shrink-0">
                          {image.name.slice(image.name.lastIndexOf('-page-'))}
                        </span>
                      </span>
                      <span className="mono-num block truncate text-[11.5px] text-muted">
                        {image.width}×{image.height} · {formatBytes(image.blob.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Download ${image.name}`}
                      title={`Download ${image.name}`}
                      onClick={() => download(image.blob, image.name)}
                      className="grid size-11 shrink-0 place-items-center rounded-[10px] text-ink-2 hover:bg-ink/5 hover:text-ink lg:size-9"
                    >
                      <Icon name="download" size={17} />
                    </button>
                  </li>
                ))}
              </ol>
              {rendered.images.length > 0 && (
                <button
                  type="button"
                  onClick={downloadAll}
                  disabled={zipping || busy}
                  className="mt-4 w-full inline-flex h-14 items-center justify-center gap-2 rounded-[16px] bg-[var(--accent)] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent)] transition-[transform,opacity] active:scale-[.985] disabled:opacity-40 disabled:shadow-none sm:h-13 sm:text-[16px]"
                >
                  <Icon name="download" size={17} />
                  {zipping
                    ? 'Zipping…'
                    : rendered.images.length === 1
                      ? `Download ${rendered.format === 'png' ? 'PNG' : 'JPG'}`
                      : `Download all ${rendered.images.length} (.zip)`}
                </button>
              )}
              {stale && !busy && (
                <Note icon="refresh" tone="caution" className="mt-3">
                  These were made with other settings or pages. Make them again to match.
                </Note>
              )}
              {rendered.failed.length > 0 && (
                <p className="mt-3 text-[12.5px] text-caution">
                  {rendered.failed.length === 1 ? 'Page' : 'Pages'} {formatRange(rendered.failed)}{' '}
                  couldn’t be drawn, so {rendered.failed.length === 1 ? 'it’s' : 'they’re'} not
                  included.
                </p>
              )}
              {rendered.capped > 0 && (
                <p className="mt-3 text-[12.5px] text-muted">
                  {plural(rendered.capped, 'page')} {rendered.capped === 1 ? 'was' : 'were'} too big
                  for that quality, so {rendered.capped === 1 ? 'it was' : 'they were'} made as
                  large as a browser can draw.
                </p>
              )}
            </div>
          ) : (
            <div className="py-4 text-center">
              <div className="relative mx-auto h-[110px] w-[150px]" aria-hidden="true">
                {[-8, 0, 8].map((turn, index) => (
                  <span
                    key={turn}
                    className={cn(
                      'absolute top-3 grid h-[78px] w-[62px] place-items-center rounded-[8px]',
                      index === 2
                        ? 'border border-dashed border-line-strong bg-surface'
                        : 'bg-ink/[.06] shadow-[inset_0_0_0_1px_var(--color-line)]',
                    )}
                    style={{ left: `${index * 44}px`, transform: `rotate(${turn}deg)` }}
                  >
                    <Icon name="image" size={22} className="text-faint" />
                  </span>
                ))}
              </div>
              <p className="mt-4 text-[14px] font-medium text-ink">Your images appear here</p>
              <p className="mt-1 text-[13px] text-muted">
                Each page becomes its own {label}, named in page order.
              </p>
            </div>
          )}
        </div>
        {rendered && rendered.images.length > 0 && (
          <p className="px-1 text-[12.5px] leading-relaxed text-muted">
            Links, forms and text you can select don’t carry over into images.
          </p>
        )}
      </aside>
    </section>
  );
}
