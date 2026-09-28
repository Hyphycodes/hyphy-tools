'use client';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { download } from '@/lib/files/download';
import { zip } from '@/lib/files/zip';
import { formatBytes, plural } from '@/lib/platform/format';
import {
  baseName,
  buildPdf,
  DEFAULT_SETUP,
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
  RESOLUTIONS,
  sizeChange,
  type PageLayout,
  type PageSetup,
  type Resolution,
  type Size,
} from '@/lib/tools/convert';
import { formatRange, parseRange } from '@/lib/tools/pdf';
import type { PdfOpenError, RenderablePdf } from '@/lib/tools/pdf-render';
import {
  convertPicture,
  formatOf,
  IMAGE_TYPES,
  readPicture,
  samplePhotos,
  sourceFor,
  unreadable,
  type ImageTarget,
} from './convert-pictures';
import { Advanced, BeforeAfter, DropObject, Payoff, PillButton, SampleButton } from './kit';
import { CornerButton, DeskBar, DeskButton, GrabNumber } from './pdf-parts';
import { useSortable } from './pdf-sortable';

/*
 * Convert: drop files in, and they become another format. The one object is the transformation
 * itself: what you dropped on the left, what it becomes on the right, and the formats to tap in
 * between, with the likely one already picked (photos → PDF, a PDF → JPG, iPhone HEIC → JPG).
 *
 * - Photos and scans → one PDF, in the order you set (pdf-lib), or → JPG, PNG or WebP (a canvas).
 * - A PDF → its pages as JPG or PNG images (PDF.js).
 *
 * Page size, margins, quality and resolution wait in Advanced. All of it happens on this device.
 */

type Side = 'images' | 'pdf';
/** How a side is handed files: dropped on the page, or passed over from the other side. */
type Intake = { take: (files: File[]) => void; reset: () => void };

/** Page previews are drawn in a 4:5 frame, whatever the page's shape. */
const FRAME = 4 / 5;
const PAGE_THUMB_WIDTH = 160;
const EDGE = 'shadow-[0_0_0_1px_rgb(14_20_51/.08),0_10px_22px_-12px_rgb(14_20_51/.45)]';

/** “a.jpg” and “b.png”; “a.jpg”, “b.png” and 3 more. */
function names(list: string[]) {
  const quoted = list.map((name) => `“${name}”`);
  if (quoted.length <= 2) return quoted.join(' and ');
  return `${quoted[0]}, ${quoted[1]} and ${quoted.length - 2} more`;
}

export function ConvertTool() {
  const [side, setSide] = useState<Side | null>(null);
  const [started, setStarted] = useState<Record<Side, boolean>>({ images: false, pdf: false });
  const [message, setMessage] = useState('');
  const [sampling, setSampling] = useState(false);
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

  /** Files in: pictures go to the pictures side, a PDF to the PDF side. */
  const route = (files: File[]) => {
    if (!files.length) return;
    const pictures = files.filter((file) => ['image', 'heic'].includes(kindOf(file)));
    const pdfFiles = files.filter((file) => kindOf(file) === 'pdf');
    setMessage('');
    if (pictures.length) {
      setSide('images');
      images.current?.take(files);
    } else if (pdfFiles.length) {
      setSide('pdf');
      pdfs.current?.take(files);
    } else {
      setMessage(
        `${names(files.map((file) => file.name))} can’t be converted here. Try photos (JPG, PNG, WebP, HEIC) or a PDF.`,
      );
    }
  };

  const startOver = () => {
    images.current?.reset();
    pdfs.current?.reset();
    setSide(null);
    setMessage('');
  };

  // While working, files dropped anywhere on the page go where they belong.
  const latest = useRef(route);
  useLayoutEffect(() => {
    latest.current = route;
  });
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!side) return;
    let depth = 0;
    const has = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
    const enter = (event: DragEvent) => {
      if (!has(event)) return;
      depth += 1;
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (!has(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const dragOver = (event: DragEvent) => {
      if (has(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      depth = 0;
      setOver(false);
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      latest.current(Array.from(event.dataTransfer.files));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', dragOver);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', dragOver);
      window.removeEventListener('drop', drop);
    };
  }, [side]);

  const other: Side | null =
    side === 'images' && started.pdf ? 'pdf' : side === 'pdf' && started.images ? 'images' : null;
  const switchBack = other && (
    <button
      type="button"
      onClick={() => setSide(other)}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink/[.05] px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/[.09] hover:text-ink lg:min-h-10"
    >
      <Icon name="chevron-left" size={15} />
      {other === 'pdf' ? 'Your PDF' : 'Your photos'}
    </button>
  );

  return (
    <div className="min-w-0">
      {side === null && (
        <div className="mx-auto max-w-[620px] py-2 sm:py-6">
          <DropObject
            shape="files"
            accept=".pdf,application/pdf,image/*,.heic,.heif"
            multiple
            onFiles={route}
            art={<FormatArt />}
            title="Drop files to convert"
            hint="Photos or a PDF."
            cta="Choose files"
          >
            <SampleButton
              disabled={sampling}
              onClick={async () => {
                setSampling(true);
                try {
                  route(await samplePhotos());
                } catch {
                  setMessage(
                    'We couldn’t draw the samples here. Choose your own pictures instead.',
                  );
                } finally {
                  setSampling(false);
                }
              }}
            >
              {sampling ? 'Drawing sample photos…' : 'Try sample photos'}
            </SampleButton>
            <SampleButton
              disabled={sampling}
              onClick={async () => {
                setSampling(true);
                try {
                  const { samplePdfs } = await import('@/lib/tools/pdf-samples');
                  route(await samplePdfs('extract'));
                } catch {
                  setMessage('We couldn’t make the sample here. Choose your own PDF instead.');
                } finally {
                  setSampling(false);
                }
              }}
            >
              Try a sample PDF
            </SampleButton>
          </DropObject>
          {message && (
            <p role="status" className="mt-4 text-center text-[14px] text-caution">
              {message}
            </p>
          )}
        </div>
      )}

      {side && over && (
        <div
          aria-hidden="true"
          className="fx-pop pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-[28px] border-2 border-dashed border-[var(--accent-ink)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
        >
          <span className="rounded-full bg-surface px-5 py-2.5 text-[16px] font-semibold text-ink shadow-lift">
            Let go to add
          </span>
        </div>
      )}

      <ImagesSide
        ref={images}
        hidden={side !== 'images'}
        onStarted={startedImages}
        onPdfs={(files) => {
          setSide('pdf');
          pdfs.current?.take(files);
        }}
        onStartOver={startOver}
        top={switchBack}
      />
      <PdfSide
        ref={pdfs}
        hidden={side !== 'pdf'}
        onStarted={startedPdf}
        onImages={(files) => {
          setSide('images');
          images.current?.take(files);
        }}
        onStartOver={startOver}
        top={switchBack}
      />
    </div>
  );
}

/* ---------------- The object: one format becoming another ---------------- */

/** On the way in: a photo becoming a page, drawn. */
function FormatArt() {
  return (
    <div aria-hidden="true" className="mx-auto flex items-center justify-center gap-3 sm:gap-4">
      <span
        className={cn(
          'relative grid h-[92px] w-[76px] -rotate-6 place-items-end overflow-hidden rounded-[10px] bg-[#f6b77a] p-2 sm:h-[104px] sm:w-[86px]',
          EDGE,
        )}
      >
        <svg viewBox="0 0 80 60" className="absolute inset-x-0 bottom-0 w-full">
          <path d="M0 60V38l18-16 16 14 14-12 32 24v12z" fill="#94664c" />
          <circle cx="58" cy="14" r="7" fill="#fff3d6" />
        </svg>
        <span className="relative rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-[#0e1433]">
          JPG
        </span>
      </span>
      <FlowArrow />
      <span
        className={cn(
          'fx-flip relative grid h-[104px] w-[80px] rotate-3 content-start gap-1.5 rounded-[6px] bg-white p-2.5 sm:h-[118px] sm:w-[92px]',
          EDGE,
        )}
      >
        <span className="h-[44%] rounded-[3px] bg-[#f6b77a]" />
        <span className="h-1.5 w-4/5 rounded-full bg-[#dfe4f7]" />
        <span className="h-1.5 w-3/5 rounded-full bg-[#dfe4f7]" />
        <span
          className="absolute right-2 bottom-2 rounded-full px-2 py-0.5 text-[11px] font-bold text-[var(--on-accent,#12110d)]"
          style={{ background: 'var(--accent)' }}
        >
          PDF
        </span>
      </span>
    </div>
  );
}

/** The arrow between old and new: a short electric stroke. */
function FlowArrow({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 56 24"
      aria-hidden="true"
      className={cn('h-6 w-12 shrink-0 sm:w-14', className)}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop offset="0" stopColor="var(--glow, #35e0ff)" />
          <stop offset="1" stopColor="var(--accent-ink, #2f4ae0)" />
        </linearGradient>
      </defs>
      <path
        d="M3 12h44m-8-7 8 7-8 7"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A format, as a little tag: quiet for what it was, lit for what it becomes. */
function FormatTag({
  children,
  lit,
  className,
}: {
  children: ReactNode;
  lit?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold tracking-[.02em]',
        lit
          ? 'text-[var(--on-accent,#12110d)]'
          : 'bg-surface text-ink-2 shadow-[0_0_0_1px_var(--color-line)]',
        className,
      )}
      style={lit ? { background: 'var(--accent)' } : undefined}
    >
      {children}
    </span>
  );
}

/** A small fan of what's there: photos or pages. */
function Fan({
  thumbs,
  paper = false,
}: {
  thumbs: (string | undefined | null)[];
  paper?: boolean;
}) {
  const shown = (thumbs.length ? thumbs : [undefined]).slice(0, 3);
  return (
    <span className="relative block h-[96px] w-[92px] sm:h-[124px] sm:w-[120px]">
      {shown
        .map((src, index) => ({ src, index }))
        .reverse()
        .map(({ src, index }) => (
          <span
            key={index}
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `translateX(${[0, 10, -10][index]}px) rotate(${[0, 6, -6][index]}deg)`,
            }}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                draggable={false}
                className={cn(
                  'block max-h-full max-w-full object-contain',
                  paper ? 'rounded-[3px] bg-white' : 'rounded-[8px]',
                  EDGE,
                )}
              />
            ) : (
              <span className={cn('block h-[88%] w-[70%] rounded-[6px] bg-white', EDGE)}>
                <span className="skeleton m-[12%] block h-[76%]" />
              </span>
            )}
          </span>
        ))}
    </span>
  );
}

type TargetOption<T extends string> = { value: T; label: string; hint: string };

/**
 * The transformation, big: what's here on the left, what it becomes on the right, and the formats
 * to tap underneath. The right side flips over to its new face when the format changes.
 */
function Transform<T extends string>({
  from,
  to,
  targets,
  value,
  onChange,
  disabled,
}: {
  from: {
    thumbs: (string | undefined | null)[];
    tag: ReactNode;
    caption: ReactNode;
    paper?: boolean;
  };
  to: {
    thumbs: (string | undefined | null)[];
    tag: ReactNode;
    caption: ReactNode;
    paper?: boolean;
    /** Drawn instead of the fan: a page with the photo on it. */
    object?: ReactNode;
  };
  targets: TargetOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const index = targets.findIndex((target) => target.value === value);
  const pick = (next: number, event?: KeyboardEvent<HTMLElement>) => {
    const target = targets[(next + targets.length) % targets.length];
    onChange(target.value);
    const sibling =
      event?.currentTarget.parentElement?.children[(next + targets.length) % targets.length];
    if (sibling instanceof HTMLElement) sibling.focus();
  };
  return (
    <section
      aria-label="Convert"
      className="relative isolate overflow-hidden rounded-[28px] bg-surface px-4 pt-5 pb-4 shadow-lift sm:px-8 sm:pt-7 sm:pb-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(40% 70% at 78% 30%, color-mix(in srgb, var(--glow, #35e0ff) 14%, transparent), transparent 70%), radial-gradient(40% 70% at 22% 30%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%)',
        }}
      />
      <div className="mx-auto grid max-w-[640px] grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6">
        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
          <Fan thumbs={from.thumbs} paper={from.paper} />
          <div className="relative min-w-0">
            <FormatTag>{from.tag}</FormatTag>
            <p className="mt-1.5 truncate text-[13px] text-muted sm:text-[14px]">{from.caption}</p>
          </div>
        </div>
        <FlowArrow className="-mt-10" />
        <div
          key={String(value)}
          className="fx-flip flex min-w-0 flex-col items-center gap-3 text-center"
        >
          {to.object ?? <Fan thumbs={to.thumbs} paper={to.paper} />}
          <div className="relative min-w-0">
            <FormatTag lit>{to.tag}</FormatTag>
            <p className="mt-1.5 truncate text-[13px] text-muted sm:text-[14px]">{to.caption}</p>
          </div>
        </div>
      </div>
      {targets.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Convert to"
          className={cn(
            'mx-auto mt-5 grid max-w-[640px] gap-2',
            targets.length === 2
              ? 'grid-cols-2'
              : targets.length === 3
                ? 'grid-cols-3'
                : 'grid-cols-4',
          )}
        >
          {targets.map((target, position) => {
            const on = target.value === value;
            return (
              <button
                key={target.value}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange(target.value)}
                onKeyDown={(event) => {
                  if (['ArrowRight', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault();
                    pick(index + 1, event);
                  } else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) {
                    event.preventDefault();
                    pick(index - 1, event);
                  }
                }}
                className={cn(
                  'flex min-h-[64px] min-w-0 flex-col items-center justify-center rounded-[16px] px-1 py-2 transition-[background-color,box-shadow,transform] active:scale-[.96] disabled:opacity-50',
                  on
                    ? 'bg-[color-mix(in_srgb,var(--accent)_12%,var(--color-surface))] shadow-[inset_0_0_0_2px_var(--accent-ink),0_10px_24px_-14px_var(--accent)]'
                    : 'bg-ink/[.04] shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.07]',
                )}
                style={{ '--i': position } as CSSProperties}
              >
                <span
                  className={cn(
                    'font-display text-[19px] leading-none font-bold tracking-[-0.01em] sm:text-[22px]',
                    on ? 'text-[var(--accent-ink)]' : 'text-ink',
                  )}
                >
                  {target.label}
                </span>
                <span className="mt-1 truncate text-[11.5px] text-muted sm:text-[12.5px]">
                  {target.hint}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------------- Shared parts ---------------- */

type Option<T extends string> = { value: T; label: ReactNode; detail?: ReactNode };

/** A labelled row of choices (a radio group of buttons), for Advanced. */
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
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-[14px] bg-ink/[.05] p-1"
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
              onKeyDown={(event) => {
                const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
                const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                if (!forward && !back) return;
                event.preventDefault();
                const next = (index + (forward ? 1 : -1) + options.length) % options.length;
                onChange(options[next].value);
                const sibling = event.currentTarget.parentElement?.children[next];
                if (sibling instanceof HTMLElement) sibling.focus();
              }}
              className={cn(
                'min-h-11 rounded-[10px] px-1.5 py-1 text-[14px] leading-tight font-medium transition-colors disabled:opacity-50 lg:min-h-10 lg:text-[13.5px]',
                on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
              )}
            >
              {option.label}
              {option.detail && (
                <span className="mt-0.5 block text-[11px] font-normal text-muted">
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

/** Work in progress, in the bar: what's happening, how far along, and a way to stop. */
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
    <div className="flex min-w-0 flex-1 items-center gap-3 px-2">
      <div className="grid min-w-0 flex-1 gap-2">
        <span className="truncate text-[13.5px] text-ink-2">{label}</span>
        <div
          role="progressbar"
          aria-label={name}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={`${done} of ${total}`}
          className="h-2 overflow-hidden rounded-full bg-ink/[.07]"
        >
          <span
            className="block h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${total ? (done / total) * 100 : 0}%`,
              background: 'linear-gradient(90deg, var(--accent), var(--glow, var(--accent)))',
            }}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="h-12 shrink-0 rounded-[14px] bg-ink/[.05] px-4 text-[14.5px] font-semibold text-ink-2 hover:bg-ink/10 hover:text-ink"
      >
        Cancel
      </button>
    </div>
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
          className={cn('absolute overflow-hidden rounded-[2px] bg-white', EDGE)}
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

/** A picture on its own, in a square: for the formats that stay pictures. */
function PhotoTile({ thumb, problem }: { thumb?: string; problem?: string }) {
  return (
    <span className="relative block aspect-[4/5]">
      {problem ? (
        <span className="absolute inset-[6%] grid place-items-center rounded-[10px] bg-critical-soft px-2 text-center text-[12px] leading-snug text-critical">
          <span>
            <Icon name="alert" size={16} className="mx-auto mb-1" />
            {problem}
          </span>
        </span>
      ) : thumb ? (
        <span className="absolute inset-[6%] flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt=""
            draggable={false}
            className={cn(
              'block max-h-full max-w-full animate-fade rounded-[8px] object-contain',
              EDGE,
            )}
          />
        </span>
      ) : (
        <span className="skeleton absolute inset-[10%]" />
      )}
    </span>
  );
}

/** The side's own header: what's in, and the ways out (the other side, start over). */
function SideHeader({
  title,
  detail,
  top,
  onStartOver,
}: {
  title: ReactNode;
  detail: ReactNode;
  top?: ReactNode;
  onStartOver: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-semibold text-ink">{title}</p>
        <p className="truncate text-[13px] text-muted">{detail}</p>
      </div>
      {top}
      <button
        type="button"
        onClick={onStartOver}
        aria-label="Start over"
        title="Start over"
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[.06] hover:text-ink lg:size-10"
      >
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

/** Finished (or finishing) files, flipping over to their new format as each one is done. */
function FlipTiles({
  tiles,
  label,
}: {
  tiles: {
    key: string | number;
    thumb?: string | null;
    name: string;
    detail: ReactNode;
    done: boolean;
    paper?: boolean;
    onDownload?: () => void;
  }[];
  label: string;
}) {
  return (
    <ol
      aria-label="Your files"
      className="mx-auto flex max-h-[600px] w-full max-w-[920px] flex-wrap justify-center gap-x-3 gap-y-4 overflow-y-auto p-1 text-left"
    >
      {tiles.map((tile, index) => (
        <li key={tile.key} className="w-[calc(50%-6px)] min-w-0 sm:w-[164px]">
          <div
            key={tile.done ? 'done' : 'waiting'}
            className={cn('relative', tile.done && 'fx-flip')}
            style={{ '--i': Math.min(index, 12) } as CSSProperties}
          >
            <span className="relative block aspect-[4/5]">
              {tile.thumb ? (
                <span className="absolute inset-[6%] flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tile.thumb}
                    alt=""
                    className={cn(
                      'block max-h-full max-w-full object-contain transition-opacity',
                      tile.paper ? 'rounded-[3px] bg-white' : 'rounded-[8px]',
                      EDGE,
                      !tile.done && 'opacity-40',
                    )}
                  />
                </span>
              ) : (
                <span className="skeleton absolute inset-[10%]" />
              )}
              <span className="absolute bottom-[8%] left-[10%]">
                {tile.done ? (
                  <FormatTag lit>
                    <Icon name="check" size={12} strokeWidth={3} className="mr-1" />
                    {label}
                  </FormatTag>
                ) : (
                  <FormatTag>
                    <Icon name="loader" size={12} className="mr-1 animate-spin" />
                    {label}
                  </FormatTag>
                )}
              </span>
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2" title={tile.name}>
              {tile.name}
              <span className="block truncate text-[11.5px] text-muted">{tile.detail}</span>
            </p>
            {tile.onDownload && (
              <button
                type="button"
                onClick={tile.onDownload}
                aria-label={`Download ${tile.name}`}
                title={`Download ${tile.name}`}
                className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-ink/[.07] hover:text-ink lg:size-9"
              >
                <Icon name="download" size={16} />
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Photos → PDF, JPG, PNG or WebP ---------------- */

type Picture = {
  id: number;
  file: File;
  status: 'reading' | 'ready' | 'unreadable';
  /** A small JPEG of the picture as it's seen, for its preview. */
  thumb?: string;
  /** Its size as it's seen, in pixels. */
  size?: Size;
};

type Target = 'pdf' | ImageTarget;
type Quality = 'best' | 'balanced' | 'small';
const QUALITY: Record<Quality, number> = { best: 0.95, balanced: 0.85, small: 0.72 };

const TARGETS: TargetOption<Target>[] = [
  { value: 'pdf', label: 'PDF', hint: 'One document' },
  { value: 'jpeg', label: 'JPG', hint: 'Works anywhere' },
  { value: 'png', label: 'PNG', hint: 'Exact' },
  { value: 'webp', label: 'WebP', hint: 'Smallest' },
];

type MadePdf = {
  kind: 'pdf';
  url: string;
  name: string;
  bytes: number;
  /** What the pictures weighed. */
  before: number;
  pages: number;
  smaller: boolean;
  covers: { id: number; layout: PageLayout }[];
  notes: string[];
};
type MadeImages = {
  kind: 'images';
  target: ImageTarget;
  files: { id: number; name: string; blob: Blob; width: number; height: number }[];
  before: number;
  total: number;
  failed: string[];
  capped: number;
};

function ImagesSide({
  ref,
  hidden,
  onPdfs,
  onStarted,
  onStartOver,
  top,
}: {
  ref: Ref<Intake>;
  hidden: boolean;
  onPdfs: (files: File[]) => void;
  onStarted: (started: boolean) => void;
  onStartOver: () => void;
  top?: ReactNode;
}) {
  const id = useId();
  const [items, setItems] = useState<Picture[]>([]);
  const started = items.length > 0;
  useEffect(() => onStarted(started), [started, onStarted]);
  const [chosen, setChosen] = useState<Target | null>(null);
  const [setup, setSetup] = useState<PageSetup>(DEFAULT_SETUP);
  const [smaller, setSmaller] = useState(false);
  const [quality, setQuality] = useState<Quality>('balanced');
  const [job, setJob] = useState<{ done: number; total: number; label: string } | null>(null);
  const [made, setMade] = useState<MadePdf | MadeImages | null>(null);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState('');
  const nextId = useRef(0);
  /** Pictures still in the list: a removed one isn't read. */
  const live = useRef(new Set<number>());
  const reading = useRef<Promise<void>>(Promise.resolve());
  const building = useRef<AbortController | null>(null);
  const madeUrl = useRef<string | null>(null);
  const moreInput = useRef<HTMLInputElement>(null);
  const payoff = useRef<HTMLDivElement>(null);

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
  const weight = usable.reduce((sum, item) => sum + item.file.size, 0);
  const formats = [...new Set(usable.map((item) => formatOf(item.file)))];
  const from = formats.length === 1 ? formats[0] : 'Photos';
  // Offer every format but the one they're all in already; iPhone photos become JPGs by default.
  const targets = TARGETS.filter(
    (target) =>
      !(formats.length === 1 && formats[0] === IMAGE_TYPES[target.value as ImageTarget]?.label),
  );
  const auto: Target = formats.length === 1 && formats[0] === 'HEIC' ? 'jpeg' : 'pdf';
  const target: Target =
    chosen && targets.some((option) => option.value === chosen) ? chosen : auto;
  const targetLabel = TARGETS.find((option) => option.value === target)!.label;

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

  // The result takes the stage: bring it into view.
  useEffect(() => {
    if (!made) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    payoff.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }, [made]);

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
    clearMade();
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
    }
    if (pdfFiles.length)
      notes.push(
        `${names(pdfFiles.map((file) => file.name))} ${pdfFiles.length === 1 ? 'is a PDF' : 'are PDFs'}: drop ${pdfFiles.length === 1 ? 'it' : 'them'} on its own to turn pages into images.`,
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
      notes.push(`Up to ${MAX_IMAGES} pictures at a time: ${plural(left, 'picture')} left out.`);
    setNotice(notes.join(' '));
  }

  function reset() {
    building.current?.abort();
    live.current.clear();
    clearMade();
    setItems([]);
    setChosen(null);
    setNotice('');
    setStatus('');
  }

  useImperativeHandle(ref, () => ({ take: add, reset }));

  const sort = useSortable({
    keys: items.map((item) => item.id),
    disabled: busy || target !== 'pdf',
    onMove: (fromIndex, to) => {
      const next = [...items];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(to, 0, moved);
      setItems(next);
    },
  });

  function remove(picture: Picture) {
    if (busy) return;
    live.current.delete(picture.id);
    setItems((current) => current.filter((item) => item.id !== picture.id));
    if (items.length === 1) onStartOver();
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
          setJob({ done: index, total, label: `Adding ${index + 1} of ${total}` });
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
        kind: 'pdf',
        url,
        name: pdfName(included.map((item) => item.file.name)),
        bytes: blob.size,
        before: included.reduce((sum, item) => sum + item.file.size, 0),
        pages: included.length,
        smaller,
        covers: result.pages
          .slice(0, 3)
          .map(({ index, layout }) => ({ id: list[index].id, layout })),
        notes: notices,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        if (building.current === controller) setStatus('Stopped. No PDF was made.');
      } else if (error instanceof RangeError) {
        setStatus(
          'This browser ran out of memory making the PDF. Turn on Make it smaller in Advanced, or make two smaller PDFs.',
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

  async function makeImages(format: ImageTarget) {
    if (busy || !usable.length) return;
    const list = usable;
    const total = list.length;
    const controller = new AbortController();
    building.current = controller;
    clearMade();
    setStatus('');
    const files: MadeImages['files'] = [];
    const failed: string[] = [];
    let capped = 0;
    const taken = new Set<string>();
    const snapshot = (): MadeImages => ({
      kind: 'images',
      target: format,
      files: [...files],
      before: list.reduce((sum, item) => sum + item.file.size, 0),
      total,
      failed: [...failed],
      capped,
    });
    setJob({ done: 0, total, label: `Converting 1 of ${total}` });
    setMade(snapshot());
    for (const [index, picture] of list.entries()) {
      if (controller.signal.aborted) break;
      setJob({ done: index, total, label: `Converting ${index + 1} of ${total}` });
      try {
        const result = await convertPicture(picture.file, format, QUALITY[quality]);
        if (result.capped) capped += 1;
        let name = `${baseName(picture.file.name, 'photo')}.${IMAGE_TYPES[format].ext}`;
        for (let copy = 2; taken.has(name); copy += 1)
          name = `${baseName(picture.file.name, 'photo')}-${copy}.${IMAGE_TYPES[format].ext}`;
        taken.add(name);
        files.push({ id: picture.id, name, ...result });
      } catch (error) {
        if (error instanceof RangeError) {
          setStatus('This browser ran out of memory. Try fewer pictures at a time.');
          break;
        }
        failed.push(
          error instanceof Error && /can’t save/.test(error.message)
            ? error.message
            : picture.file.name,
        );
      }
      setMade(snapshot());
    }
    if (building.current === controller) building.current = null;
    setJob(null);
    setMade(snapshot());
  }

  const convert = () => (target === 'pdf' ? makePdf() : makeImages(target));
  const thumbOf = (pictureId: number) => items.find((item) => item.id === pictureId)?.thumb;
  /** Page numbers skip pictures that can't be opened: they're left out of the PDF. */
  const pageOf = new Map(usable.map((item, index) => [item.id, index + 1]));
  const pdfTarget = target === 'pdf';
  const thumbs = usable.map((item) => item.thumb);

  const payoffView = made && (
    <div ref={payoff} className="scroll-mt-24">
      {made.kind === 'pdf' ? (
        <Payoff
          headline={`✓ ${plural(made.pages, 'photo')} → PDF`}
          caption={
            <BeforeAfter before={formatBytes(made.before)} after={formatBytes(made.bytes)} />
          }
          action={{ label: 'Download PDF', icon: 'download', href: made.url, download: made.name }}
          secondary={
            <>
              <PillButton icon="undo" onClick={clearMade}>
                Make changes
              </PillButton>
              {!made.smaller && made.bytes > 5 * 1024 * 1024 && (
                <PillButton
                  icon="shrink"
                  onClick={() => {
                    setSmaller(true);
                    clearMade();
                  }}
                >
                  Make it smaller
                </PillButton>
              )}
            </>
          }
          onReset={onStartOver}
        >
          <div className="flex flex-col items-center">
            <div className="relative mx-auto h-[210px] w-[168px] sm:h-[250px] sm:w-[200px]">
              {made.covers
                .map((cover, index) => ({ cover, index }))
                .reverse()
                .map(({ cover, index }) => (
                  // Fanned out, first page on top, each flipping over from photo to page.
                  <span
                    key={index}
                    className="fx-flip absolute inset-0"
                    style={
                      {
                        '--i': made.covers.length - index,
                        transform: `translateX(${[0, 16, -16][index]}px) rotate(${[0, 5, -5][index]}deg)`,
                      } as CSSProperties
                    }
                  >
                    <PagePreview layout={cover.layout} thumb={thumbOf(cover.id)} />
                  </span>
                ))}
              <span className="absolute -right-4 -bottom-1 rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-on-ink shadow-lift">
                {plural(made.pages, 'page')}
              </span>
            </div>
            <p className="mt-6 max-w-full truncate text-[16px] font-semibold text-ink">
              {made.name}
            </p>
            <p className="text-[13.5px] text-muted">
              {sizeChange(made.before, made.bytes) === 'about the same'
                ? 'About the same size as the photos'
                : `${sizeChange(made.before, made.bytes).replace(/^\w/, (letter) => letter.toUpperCase())} than the photos`}
            </p>
            {made.notes.map((note) => (
              <p key={note} className="mt-2 max-w-[48ch] text-[12.5px] text-muted">
                {note}
              </p>
            ))}
          </div>
        </Payoff>
      ) : (
        <ImagesPayoff
          made={made}
          busy={busy}
          thumbOf={thumbOf}
          onStop={() => building.current?.abort()}
          onBack={clearMade}
          onReset={onStartOver}
        />
      )}
    </div>
  );

  return (
    <section hidden={hidden} aria-label="Photos" className="grid min-w-0 gap-5">
      {payoffView}
      <div hidden={made !== null} className="grid min-w-0 gap-5">
        <SideHeader
          title={plural(items.length, 'photo')}
          detail={`${from} · ${formatBytes(weight)}`}
          top={top}
          onStartOver={onStartOver}
        />
        <Transform<Target>
          from={{ thumbs, tag: from, caption: plural(usable.length, 'photo') }}
          to={{
            thumbs,
            object: pdfTarget ? (
              <span className="relative block h-[96px] w-[92px] sm:h-[124px] sm:w-[120px]">
                {usable
                  .slice(0, 3)
                  .map((item, index) => ({ item, index }))
                  .reverse()
                  .map(({ item, index }) => (
                    <span
                      key={item.id}
                      className="absolute inset-0"
                      style={{ transform: `translate(${index * 5}px, ${index * -5}px)` }}
                    >
                      <PagePreview
                        layout={item.size && layoutPage(item.size, setup)}
                        thumb={item.thumb}
                        className="h-full !aspect-auto"
                      />
                    </span>
                  ))}
              </span>
            ) : undefined,
            tag: targetLabel,
            caption: pdfTarget
              ? `${plural(usable.length, 'page')}, one file`
              : plural(usable.length, 'photo'),
          }}
          targets={targets}
          value={target}
          onChange={(next) => {
            setChosen(next);
            clearMade();
          }}
          disabled={busy}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[14px] text-muted">
            {pdfTarget ? (
              <>
                <Icon name="grip" size={15} /> Drag to set the page order
              </>
            ) : (
              'Each photo becomes its own file'
            )}
          </p>
        </div>
        <ol
          aria-label={pdfTarget ? 'Pages, in order' : 'Photos'}
          className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7"
        >
          {items.map((item) => {
            const number = pageOf.get(item.id);
            const problem =
              item.status === 'unreadable'
                ? kindOf(item.file) === 'heic'
                  ? 'HEIC opens only in Safari'
                  : 'Can’t open this one here'
                : undefined;
            const up = sort.lifted === item.id;
            return (
              <li
                key={item.id}
                {...(pdfTarget ? sort.item(item.id) : {})}
                className={cn(
                  'group relative min-w-0',
                  pdfTarget && !busy && 'cursor-grab active:cursor-grabbing',
                )}
              >
                <div
                  className={cn(
                    'relative rounded-[14px] transition-[scale,rotate,background-color,box-shadow] duration-150',
                    up
                      ? 'scale-[1.06] rotate-[-2deg] bg-surface shadow-[0_24px_40px_-20px_rgb(14_20_51/.5)]'
                      : sort.pending === item.id
                        ? 'scale-[.97]'
                        : 'hover:bg-ink/[.035]',
                  )}
                >
                  {pdfTarget ? (
                    <PagePreview
                      layout={item.size && layoutPage(item.size, setup)}
                      thumb={item.thumb}
                      problem={problem}
                    />
                  ) : (
                    <PhotoTile thumb={item.thumb} problem={problem} />
                  )}
                  {pdfTarget && number !== undefined && (
                    <GrabNumber handle={sort.handle(item.id)} label={`Move “${item.file.name}”`}>
                      {number}
                    </GrabNumber>
                  )}
                  <CornerButton
                    icon="x"
                    label={`Remove “${item.file.name}”`}
                    disabled={busy}
                    onClick={() => remove(item)}
                  />
                </div>
                <p
                  className="mt-0.5 truncate px-1 text-center text-[12px] text-muted"
                  title={item.file.name}
                >
                  {item.status === 'reading' ? 'Reading…' : item.file.name}
                </p>
              </li>
            );
          })}
          {items.length < MAX_IMAGES && (
            <li className="min-w-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => moreInput.current?.click()}
                className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-dashed border-line-strong text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/[.04] hover:text-ink disabled:opacity-50"
              >
                <span
                  className="grid size-10 place-items-center rounded-full text-[var(--on-accent,#12110d)]"
                  style={{ background: 'var(--accent)' }}
                >
                  <Icon name="plus" size={18} />
                </span>
                Add more
              </button>
              <input
                ref={moreInput}
                type="file"
                accept="image/*,.heic,.heif"
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

        {/* Always in the page, so screen readers announce what lands in it. */}
        <p
          aria-live="polite"
          className={cn(
            'text-[13.5px] leading-relaxed [overflow-wrap:anywhere] text-caution',
            !notice && 'sr-only',
          )}
        >
          {notice}
        </p>

        {target !== 'png' && (
          <Advanced
            summary={
              pdfTarget
                ? `${setup.size === 'fit' ? 'Fit image' : setup.size === 'a4' ? 'A4' : 'US Letter'}${smaller ? ' · smaller' : ''}`
                : { best: 'Best quality', balanced: 'Balanced', small: 'Smaller files' }[quality]
            }
          >
            {pdfTarget ? (
              <div className="grid gap-4 sm:grid-cols-2">
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
                    setup.size !== 'fit'
                      ? 'The picture is centered and kept in shape.'
                      : 'Each page is the picture’s own shape.'
                  }
                />
                {setup.size !== 'fit' && (
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
                  />
                )}
                {setup.size !== 'fit' && (
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
                )}
                <label
                  htmlFor={`${id}-smaller`}
                  className="flex cursor-pointer items-start gap-3 self-end rounded-[14px] bg-ink/[.04] p-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
                >
                  <input
                    id={`${id}-smaller`}
                    type="checkbox"
                    checked={smaller}
                    disabled={busy}
                    onChange={(event) => setSmaller(event.target.checked)}
                    className="mt-0.5 size-5 shrink-0 accent-[var(--accent-ink)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-ink">Make it smaller</span>
                    <span className="block text-[12.5px] leading-snug text-muted">
                      Easier to email, still sharp on screen.
                    </span>
                  </span>
                </label>
              </div>
            ) : (
              <Choice<Quality>
                label="Quality"
                value={quality}
                disabled={busy}
                onChange={setQuality}
                options={[
                  { value: 'best', label: 'Best' },
                  { value: 'balanced', label: 'Balanced' },
                  { value: 'small', label: 'Smaller files' },
                ]}
              />
            )}
          </Advanced>
        )}

        <DeskBar
          summary={
            job ? undefined : (
              <span role="status" className="block truncate">
                {status ||
                  (usable.length === 0
                    ? items.some((item) => item.status === 'reading')
                      ? 'Reading…'
                      : 'None of these pictures can be opened here.'
                    : `${plural(usable.length, 'photo')} · ${formatBytes(weight)}`)}
              </span>
            )
          }
        >
          {job ? (
            <Progress
              name={pdfTarget ? 'Making the PDF' : 'Converting'}
              done={job.done}
              total={job.total}
              label={job.label}
              onCancel={() => building.current?.abort()}
            />
          ) : (
            <DeskButton
              icon={pdfTarget ? 'file-stack' : 'repeat'}
              onClick={convert}
              disabled={usable.length === 0}
            >
              {pdfTarget
                ? usable.length
                  ? `Make a ${usable.length}-page PDF`
                  : 'Make PDF'
                : `Convert to ${targetLabel}`}
            </DeskButton>
          )}
        </DeskBar>
      </div>
    </section>
  );
}

/** Photos in their new format: flipping over as each one is done, then one big download. */
function ImagesPayoff({
  made,
  busy,
  thumbOf,
  onStop,
  onBack,
  onReset,
}: {
  made: MadeImages;
  busy: boolean;
  thumbOf: (id: number) => string | undefined;
  onStop: () => void;
  onBack: () => void;
  onReset: () => void;
}) {
  const [zipping, setZipping] = useState(false);
  const label = IMAGE_TYPES[made.target].label;
  const weight = made.files.reduce((sum, file) => sum + file.blob.size, 0);
  const waiting = busy ? Math.max(0, made.total - made.files.length - made.failed.length) : 0;
  const [only] = made.files;

  const downloadAll = async () => {
    if (made.files.length === 1) return download(only.blob, only.name);
    setZipping(true);
    try {
      download(
        await zip(made.files.map((file) => ({ name: file.name, data: file.blob }))),
        `${label.toLowerCase()}-photos.zip`,
      );
    } finally {
      setZipping(false);
    }
  };

  return (
    <Payoff
      headline={
        busy
          ? `Converting ${Math.min(made.files.length + made.failed.length + 1, made.total)} of ${made.total}…`
          : `✓ ${plural(made.files.length, 'photo')} → ${label}`
      }
      caption={
        made.files.length > 0 && !busy ? (
          <BeforeAfter before={formatBytes(made.before)} after={formatBytes(weight)} />
        ) : undefined
      }
      action={
        !busy && made.files.length
          ? {
              label: zipping
                ? 'Zipping…'
                : made.files.length === 1
                  ? `Download ${label}`
                  : `Download all ${made.files.length} (.zip)`,
              icon: 'download',
              onClick: downloadAll,
            }
          : undefined
      }
      secondary={
        busy ? (
          <PillButton icon="x" onClick={onStop}>
            Stop
          </PillButton>
        ) : (
          <PillButton icon="undo" onClick={onBack}>
            Make changes
          </PillButton>
        )
      }
      onReset={busy ? undefined : onReset}
    >
      <FlipTiles
        label={label}
        tiles={[
          ...made.files.map((file) => ({
            key: file.id,
            thumb: thumbOf(file.id),
            name: file.name,
            detail: `${file.width}×${file.height} · ${formatBytes(file.blob.size)}`,
            done: true,
            onDownload: () => download(file.blob, file.name),
          })),
          ...(waiting
            ? Array.from({ length: Math.min(waiting, 20) }, (_, index) => ({
                key: `waiting-${index}`,
                thumb: undefined,
                name: '…',
                detail: '',
                done: false,
              }))
            : []),
        ]}
      />
      {made.failed.length > 0 && (
        <p className="mt-4 text-[13px] text-caution">
          Left out: {made.failed.slice(0, 4).join(', ')}
          {made.failed.length > 4 && ` and ${made.failed.length - 4} more`}.
        </p>
      )}
      {made.capped > 0 && (
        <p className="mt-2 text-[12.5px] text-muted">
          {plural(made.capped, 'photo')} {made.capped === 1 ? 'was' : 'were'} bigger than this
          browser can draw, so {made.capped === 1 ? 'it was' : 'they were'} scaled down to 16
          megapixels.
        </p>
      )}
    </Payoff>
  );
}

/* ---------------- A PDF → images ---------------- */

type OpenedPdf = { id: number; file: File; pages: number; first: Size };
type PageImage = { index: number; name: string; blob: Blob; width: number; height: number };
type Rendered = {
  images: PageImage[];
  pages: number[];
  total: number;
  format: 'jpeg' | 'png';
  dpi: number;
  capped: number;
  failed: number[];
  zipName: string;
  stopped: boolean;
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

const PAGE_TARGETS: TargetOption<'jpeg' | 'png'>[] = [
  { value: 'jpeg', label: 'JPG', hint: 'Smaller files' },
  { value: 'png', label: 'PNG', hint: 'Exact, larger' },
];

function PdfSide({
  ref,
  hidden,
  onImages,
  onStarted,
  onStartOver,
  top,
}: {
  ref: Ref<Intake>;
  hidden: boolean;
  onImages: (files: File[]) => void;
  onStarted: (started: boolean) => void;
  onStartOver: () => void;
  top?: ReactNode;
}) {
  const id = useId();
  const [opened, setOpened] = useState<OpenedPdf | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const started = opened !== null || opening !== null;
  useEffect(() => onStarted(started), [started, onStarted]);
  /** Page thumbnails: a data URL, `null` when a page can't be drawn, undefined until it is. */
  const [thumbs, setThumbs] = useState<(string | null | undefined)[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [range, setRange] = useState('');
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [resolution, setResolution] = useState<Resolution>('sharp');
  const [job, setJob] = useState<{ done: number; total: number } | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [zipping, setZipping] = useState(false);
  const [notice, setNotice] = useState<ReactNode>(null);
  const doc = useRef<RenderablePdf | null>(null);
  const generation = useRef(0);
  const running = useRef<AbortController | null>(null);
  const payoff = useRef<HTMLDivElement>(null);

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
  const dpi = RESOLUTIONS[resolution].dpi;
  const label = format === 'png' ? 'PNG' : 'JPG';

  const showing = rendered !== null;
  useEffect(() => {
    if (!showing) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    payoff.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }, [showing]);

  function reset() {
    generation.current += 1;
    running.current?.abort();
    doc.current?.close();
    doc.current = null;
    setOpened(null);
    setOpening(null);
    setThumbs([]);
    setPicked([]);
    setRange('');
    setRendered(null);
    setJob(null);
    setNotice(null);
  }

  async function open(file: File) {
    reset();
    const run = generation.current;
    if (file.size > MAX_PDF_BYTES) {
      setNotice(`“${file.name}” is ${formatBytes(file.size)}. Convert opens PDFs up to 50 MB.`);
      return;
    }
    setOpening(file.name);
    try {
      const { openRenderablePdf } = await import('@/lib/tools/pdf-render');
      const pdf = await openRenderablePdf(file);
      if (run !== generation.current) return pdf.close();
      if (pdf.pages > MAX_PDF_PAGES) {
        pdf.close();
        setNotice(
          <>
            “{file.name}” has {pdf.pages} pages. Convert takes up to {MAX_PDF_PAGES} at a time: pull
            out the pages you need with the{' '}
            <Link href="/tools/pdf" className="font-medium underline underline-offset-2">
              PDF tool
            </Link>{' '}
            first.
          </>,
        );
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
      setNotice(openProblem(error, file.name));
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
      return;
    }
    void open(pdfFiles[0]).then(() => {
      if (pdfFiles.length > 1) setNotice(`One PDF at a time: this is “${pdfFiles[0].name}”.`);
    });
  }

  useImperativeHandle(ref, () => ({ take, reset }));

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
    const snapshot = (stopped = false): Rendered => ({
      images: [...images],
      pages,
      total: pages.length,
      format,
      dpi,
      capped,
      failed: [...failed],
      zipName: pagesZipName(base, format),
      stopped,
    });
    setRendered(snapshot());
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
    setRendered(snapshot(controller.signal.aborted));
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
      setNotice(
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

  if (!opened)
    return (
      <section hidden={hidden} aria-label="PDF to images" className="grid min-w-0 gap-5">
        <SideHeader
          title={opening ? `Opening ${opening}…` : 'A PDF'}
          detail={opening ? 'Reading its pages' : 'Nothing open'}
          top={top}
          onStartOver={onStartOver}
        />
        {opening ? (
          <div className="skeleton h-[260px] !rounded-[28px]" />
        ) : (
          notice && (
            <p className="rounded-[16px] bg-caution-soft px-4 py-3.5 text-[14.5px] [overflow-wrap:anywhere] text-caution">
              {notice}
            </p>
          )
        )}
      </section>
    );

  const renderedLabel = rendered?.format === 'png' ? 'PNG' : 'JPG';
  const doneIndexes = new Set(rendered?.images.map((image) => image.index));

  return (
    <section hidden={hidden} aria-label="PDF to images" className="grid min-w-0 gap-5">
      {rendered && (
        <div ref={payoff} className="scroll-mt-24">
          <Payoff
            headline={
              busy
                ? `Converting ${Math.min((job?.done ?? 0) + 1, rendered.total)} of ${rendered.total}…`
                : rendered.stopped
                  ? `Stopped · ${rendered.images.length} of ${rendered.total} ready`
                  : `✓ ${plural(rendered.images.length, 'page')} → ${renderedLabel}`
            }
            caption={
              !busy && rendered.images.length ? (
                <span className="tabular-nums">
                  {formatBytes(weight)} · {RESOLUTIONS[resolution].label.toLowerCase()} quality
                </span>
              ) : undefined
            }
            action={
              !busy && rendered.images.length
                ? {
                    label: zipping
                      ? 'Zipping…'
                      : rendered.images.length === 1
                        ? `Download ${renderedLabel}`
                        : `Download all ${rendered.images.length} (.zip)`,
                    icon: 'download',
                    onClick: downloadAll,
                  }
                : undefined
            }
            secondary={
              busy ? (
                <PillButton icon="x" onClick={() => running.current?.abort()}>
                  Stop
                </PillButton>
              ) : (
                <PillButton icon="undo" onClick={() => setRendered(null)}>
                  Make changes
                </PillButton>
              )
            }
            onReset={busy ? undefined : onStartOver}
          >
            <FlipTiles
              label={renderedLabel}
              tiles={rendered.pages
                .filter((index) => !rendered.failed.includes(index))
                .map((index) => {
                  const image = rendered.images.find((item) => item.index === index);
                  return {
                    key: index,
                    thumb: thumbs[index],
                    paper: true,
                    name: image?.name ?? `Page ${index + 1}`,
                    detail: image
                      ? `${image.width}×${image.height} · ${formatBytes(image.blob.size)}`
                      : '',
                    done: doneIndexes.has(index),
                    onDownload: image ? () => download(image.blob, image.name) : undefined,
                  };
                })}
            />
            {rendered.failed.length > 0 && (
              <p className="mt-4 text-[13px] text-caution">
                {rendered.failed.length === 1 ? 'Page' : 'Pages'} {formatRange(rendered.failed)}{' '}
                couldn’t be drawn, so {rendered.failed.length === 1 ? 'it’s' : 'they’re'} not
                included.
              </p>
            )}
            {rendered.capped > 0 && (
              <p className="mt-2 text-[12.5px] text-muted">
                {plural(rendered.capped, 'page')} {rendered.capped === 1 ? 'was' : 'were'} too big
                for that quality, so {rendered.capped === 1 ? 'it was' : 'they were'} made as large
                as a browser can draw.
              </p>
            )}
          </Payoff>
        </div>
      )}

      <div hidden={rendered !== null} className="grid min-w-0 gap-5">
        <SideHeader
          title={opened.file.name}
          detail={`${plural(opened.pages, 'page')} · ${formatBytes(opened.file.size)}`}
          top={top}
          onStartOver={onStartOver}
        />
        <Transform<'jpeg' | 'png'>
          from={{
            thumbs: thumbs.slice(0, 3),
            paper: true,
            tag: 'PDF',
            caption: plural(opened.pages, 'page'),
          }}
          to={{
            thumbs: picked.slice(0, 3).map((index) => thumbs[index]),
            paper: true,
            tag: label,
            caption: plural(picked.length, 'image'),
          }}
          targets={PAGE_TARGETS}
          value={format}
          onChange={setFormat}
          disabled={busy}
        />

        <div className="flex min-h-11 items-center justify-between gap-3">
          <p className="text-[14px] text-muted">
            {picked.length === opened.pages ? (
              'Every page · tap one to leave it out'
            ) : picked.length ? (
              <span className="font-semibold text-ink">{plural(picked.length, 'page')} picked</span>
            ) : (
              'Tap the pages to convert'
            )}
          </p>
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
            className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-ink/[.05] px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/[.09] hover:text-ink disabled:opacity-45 lg:min-h-10"
          >
            {picked.length === opened.pages ? 'Select none' : 'Select all'}
          </button>
        </div>

        <ol
          aria-label="Pages"
          className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8"
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
                    'relative block w-full rounded-[14px] p-1.5 transition-[background-color,transform] active:scale-[.96]',
                    on
                      ? 'bg-[color-mix(in_srgb,var(--accent)_13%,transparent)]'
                      : 'hover:bg-ink/[.04]',
                  )}
                >
                  {/* Dimmed on this wrapper: the image's fade-in animation holds its opacity. */}
                  <span
                    className={cn(
                      'relative block aspect-[3/4] transition-opacity',
                      picked.length > 0 && !on && 'opacity-35',
                    )}
                  >
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={src}
                        alt=""
                        className={cn(
                          'absolute inset-0 m-auto block max-h-full max-w-full animate-fade rounded-[3px] bg-white object-contain',
                          EDGE,
                        )}
                      />
                    ) : src === null ? (
                      <span className="absolute inset-[6%] grid place-items-center rounded-[4px] bg-white text-[11px] text-muted">
                        Can’t preview
                      </span>
                    ) : (
                      <span className="skeleton absolute inset-[8%]" />
                    )}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full transition-[transform,background-color]',
                      on
                        ? 'scale-100 text-[var(--on-accent,#12110d)]'
                        : 'scale-90 bg-surface text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
                    )}
                    style={on ? { background: 'var(--accent)' } : undefined}
                  >
                    <Icon name="check" size={13} strokeWidth={3} />
                  </span>
                  <span
                    className={cn(
                      'mono-num mt-1 block text-center text-[12px]',
                      on ? 'font-semibold text-ink' : 'text-muted',
                    )}
                  >
                    {index + 1}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div aria-live="polite" className={cn(!notice && 'sr-only')}>
          {notice && (
            <p className="text-[13.5px] leading-relaxed [overflow-wrap:anywhere] text-muted">
              {notice}
            </p>
          )}
        </div>

        <Advanced summary={`${RESOLUTIONS[resolution].label} · ${range || 'no pages'}`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice<Resolution>
              label="Quality"
              value={resolution}
              disabled={busy}
              onChange={setResolution}
              options={(Object.keys(RESOLUTIONS) as Resolution[]).map((value) => ({
                value,
                label: RESOLUTIONS[value].label,
                detail: `${RESOLUTIONS[value].dpi} dpi`,
              }))}
              hint={
                format === 'png' && resolution === 'print'
                  ? `${RESOLUTIONS[resolution].use} Print-size PNGs are big files.`
                  : RESOLUTIONS[resolution].use
              }
            />
            <div className="grid content-start gap-1.5">
              <label htmlFor={`${id}-range`} className="text-[13.5px] font-medium text-ink-2">
                Pages to convert <span className="font-normal text-muted">(1–{opened.pages})</span>
              </label>
              <Input
                id={`${id}-range`}
                value={range}
                disabled={busy}
                onChange={(event) => typeRange(event.target.value)}
                placeholder="Like 1-3, 5"
                aria-invalid={rangeInvalid}
                className={cn(rangeInvalid && '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]')}
              />
              {rangeInvalid && (
                <p className="text-[12.5px] text-caution">
                  Pages go from 1 to {opened.pages}. Try something like 1-3, 5.
                </p>
              )}
            </div>
          </div>
        </Advanced>

        <DeskBar
          summary={
            <span role="status" className="block truncate">
              {picked.length
                ? `${plural(picked.length, 'page')} → ${label}`
                : 'Pick the pages to convert.'}
            </span>
          }
        >
          <DeskButton icon="file-image" onClick={makeImages} disabled={!picked.length || busy}>
            {picked.length ? `Make ${plural(picked.length, label)}` : `Make ${label}s`}
          </DeskButton>
        </DeskBar>
      </div>
    </section>
  );
}
