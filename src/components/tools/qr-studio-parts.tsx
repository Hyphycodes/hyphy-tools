'use client';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { qrMatrix } from '@/lib/tools/qr';
import type { QrKind } from '@/lib/tools/qr-payloads';
import {
  qrShapes,
  type CornerStyle,
  type DotStyle,
  type QrLook,
  type Shape,
} from '@/lib/tools/qr-style';

/*
 * QR Studio's own parts: the code drawn as React, the little rendered previews that stand in for
 * settings (looks, dots, corners), swatches that know "none" and "same as the code", the stamp,
 * and the kind tiles. Everything reads the world's tokens (--accent, --accent-ink, --third).
 */

export const ACCENT = 'var(--accent, var(--color-ink))';
export const ACCENT_INK = 'var(--accent-ink, var(--color-ink))';

export type Kind = {
  value: QrKind;
  label: string;
  icon: IconName;
  hint: string;
  /** What the empty code asks for. */
  empty: string;
};

export const KINDS: Kind[] = [
  {
    value: 'link',
    label: 'Link',
    icon: 'link',
    hint: 'A site or menu',
    empty: 'Paste or type a link',
  },
  {
    value: 'wifi',
    label: 'Wi-Fi',
    icon: 'wifi',
    hint: 'Guests join in one scan',
    empty: 'Name your network',
  },
  {
    value: 'contact',
    label: 'Contact',
    icon: 'contact',
    hint: 'Saves your details',
    empty: 'Add a name or number',
  },
  {
    value: 'phone',
    label: 'Call',
    icon: 'phone',
    hint: 'Rings your number',
    empty: 'Add a number',
  },
  { value: 'sms', label: 'Text', icon: 'sms', hint: 'Opens a text to you', empty: 'Add a number' },
  {
    value: 'email',
    label: 'Email',
    icon: 'mail',
    hint: 'Starts an email to you',
    empty: 'Add an address',
  },
  {
    value: 'text',
    label: 'Plain text',
    icon: 'file-text',
    hint: 'Shows a short note',
    empty: 'Type your note',
  },
];

/* ---------------- the code ---------------- */

/** The code as React elements, from the same shapes the downloads use. */
export function QrShapes({ shapes }: { shapes: Shape[] }) {
  return (
    <>
      {shapes.map((shape, index) => {
        switch (shape.type) {
          case 'rect':
            return (
              <rect
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.w}
                height={shape.h}
                rx={shape.r}
                fill={shape.fill}
              />
            );
          case 'circle':
            return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
          case 'ring':
            return (
              <rect
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.size}
                height={shape.size}
                rx={shape.r}
                fill="none"
                stroke={shape.stroke}
                strokeWidth={shape.width}
              />
            );
          case 'image':
            return (
              <image
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.size}
                height={shape.size}
                href={shape.href}
                preserveAspectRatio="xMidYMid meet"
              />
            );
        }
      })}
    </>
  );
}

/** Viewfinder corners around the code: the studio's frame. */
export function Viewfinder({ inset = '-12px', className }: { inset?: string; className?: string }) {
  const corner = 'absolute size-6 border-[2.5px] sm:size-8';
  const style = { borderColor: ACCENT };
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute', className)}
      style={{ inset }}
    >
      <span
        className={cn(corner, 'top-0 left-0 rounded-tl-[12px] border-r-0 border-b-0')}
        style={style}
      />
      <span
        className={cn(corner, 'top-0 right-0 rounded-tr-[12px] border-b-0 border-l-0')}
        style={style}
      />
      <span
        className={cn(corner, 'bottom-0 left-0 rounded-bl-[12px] border-t-0 border-r-0')}
        style={style}
      />
      <span
        className={cn(corner, 'right-0 bottom-0 rounded-br-[12px] border-t-0 border-l-0')}
        style={style}
      />
    </span>
  );
}

/** The rubber stamp that lands on a finished code. Sits on the card's blank corner, never the code. */
export function Stamp({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'fx-stamp pointer-events-none absolute z-10 inline-flex rotate-[-7deg] items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-display text-[12px] font-extrabold tracking-[.1em] whitespace-nowrap uppercase sm:px-3.5 sm:py-2 sm:text-[13.5px]',
        className,
      )}
      style={{
        background: 'var(--third, #ffd66b)',
        color: 'var(--glow, #1d2b3a)',
        boxShadow:
          'inset 0 0 0 2px var(--glow, #1d2b3a), inset 0 0 0 4px var(--third, #ffd66b), inset 0 0 0 5px color-mix(in srgb, var(--glow, #1d2b3a) 55%, transparent), 0 14px 26px -14px rgb(12 26 29 / .55)',
      }}
    >
      <Icon name="check" size={15} strokeWidth={3} />
      {children}
    </span>
  );
}

/* ---------------- the way in: what the code is for ---------------- */

const THUMB = 'hyphy.example';

/** A finished code with its stamp: what you're about to make. */
export function StudioArt() {
  const shapes = useMemo(
    () =>
      qrShapes(
        qrMatrix(THUMB, 'L'),
        {
          dot: 'rounded',
          corner: 'rounded',
          fg: 'currentColor',
          bg: '',
          corners: '#08796f',
          margin: 0,
        },
        null,
      ),
    [],
  );
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[260px]">
      <Viewfinder inset="-14px" />
      <div className="relative rounded-[22px] bg-white p-6 shadow-[0_30px_60px_-32px_rgb(12_26_29/.5)]">
        <svg
          viewBox={`0 0 ${shapes.total} ${shapes.total}`}
          className="block h-auto w-full text-[var(--glow,#1d2b3a)]"
        >
          <QrShapes shapes={shapes.shapes} />
        </svg>
        <Stamp className="-top-3 -right-5 [animation-delay:200ms]">Ready to scan</Stamp>
      </div>
    </div>
  );
}

/** Big tiles for the first tap: what scanning the code will do. */
export function KindTiles({
  options,
  value,
  onPick,
  compact = false,
}: {
  options: Kind[];
  value: QrKind | null;
  onPick: (kind: QrKind) => void;
  /** A single row of chips (the switcher above the fields). */
  compact?: boolean;
}) {
  if (compact)
    return (
      <div
        role="radiogroup"
        aria-label="What the code opens"
        className="scroller -mx-4 flex scroll-px-4 gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:px-0"
      >
        {options.map((kind) => {
          const on = kind.value === value;
          return (
            <button
              key={kind.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(kind.value)}
              className={cn(
                'fx-move inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold active:scale-[.96] lg:min-h-10 lg:text-[13.5px]',
                on
                  ? 'text-[var(--on-accent,#12110d)] shadow-[0_8px_20px_-12px_var(--accent,transparent)]'
                  : 'bg-ink/[.05] text-ink-2 hover:bg-ink/10 hover:text-ink',
              )}
              style={on ? { background: ACCENT } : undefined}
            >
              <Icon name={kind.icon} size={16} />
              {kind.label}
            </button>
          );
        })}
      </div>
    );
  return (
    <div
      role="radiogroup"
      aria-label="What the code opens"
      className="grid grid-cols-3 gap-2 sm:gap-3"
    >
      {options.map((kind, index) => (
        <button
          key={kind.value}
          type="button"
          role="radio"
          aria-checked={kind.value === value}
          onClick={() => onPick(kind.value)}
          className="group fx-move fx-rise relative flex min-h-[104px] min-w-0 flex-col items-center justify-center gap-2 rounded-[20px] bg-ink/[.045] px-2 py-3.5 text-center shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface hover:shadow-[inset_0_0_0_2px_var(--accent-ink,var(--color-ink)),0_16px_30px_-20px_var(--accent,transparent)] active:scale-[.95] sm:min-h-[132px] sm:gap-2.5"
          style={{ ['--i' as string]: index }}
        >
          <span className="fx-move grid size-12 place-items-center rounded-[14px] bg-[color-mix(in_srgb,var(--accent,var(--color-ink))_22%,transparent)] text-[var(--accent-ink,var(--color-ink))] group-hover:rotate-[-5deg] group-hover:bg-[var(--accent,var(--color-ink))] group-hover:text-[var(--on-accent,#12110d)] sm:size-14 sm:rounded-[16px]">
            <Icon name={kind.icon} size={24} />
          </span>
          <span className="text-[15.5px] leading-tight font-bold text-ink sm:text-[17px]">
            {kind.label}
          </span>
          <span className="hidden text-[12.5px] leading-snug text-muted sm:block">{kind.hint}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- previews that stand in for settings ---------------- */

/** A small code in a preset's look: the swatch is the result. */
export function LookThumb({ look }: { look: Omit<QrLook, 'margin'> }) {
  const shapes = useMemo(
    () => qrShapes(qrMatrix(THUMB, 'L'), { ...look, margin: 1 }, null),
    [look],
  );
  return (
    <svg
      viewBox={`0 0 ${shapes.total} ${shapes.total}`}
      className="block aspect-square w-full rounded-[10px]"
      style={{ background: look.bg || '#ffffff' }}
      aria-hidden="true"
    >
      <QrShapes shapes={shapes.shapes} />
    </svg>
  );
}

// A 21-module grid with a 5×5 patch of data in the middle, clear of the corner squares.
const PATCH = [
  [1, 1, 0, 1, 0],
  [0, 1, 1, 1, 1],
  [1, 1, 0, 0, 1],
  [1, 0, 1, 1, 0],
  [0, 1, 1, 0, 1],
];
const SAMPLE_MATRIX = [...Array(21)].map((_, row) =>
  [...Array(21)].map(
    (__, col) => row >= 8 && row < 13 && col >= 8 && col < 13 && PATCH[row - 8][col - 8] === 1,
  ),
);

/** One dot or corner style, drawn by the real renderer, in the code's current colors. */
function StyleSample({
  dot,
  corner,
  color,
}: {
  dot?: DotStyle;
  corner?: CornerStyle;
  color: string;
}) {
  const shapes = useMemo(() => {
    const { shapes: all } = qrShapes(
      SAMPLE_MATRIX,
      {
        dot: dot ?? 'square',
        corner: corner ?? 'square',
        fg: color,
        bg: '',
        corners: '',
        margin: 0,
      },
      null,
    );
    const inPatch = (shape: Shape) =>
      shape.type === 'circle'
        ? shape.cx > 8 && shape.cx < 13 && shape.cy > 8 && shape.cy < 13
        : 'x' in shape && shape.x >= 8 && shape.x < 13 && shape.y >= 8 && shape.y < 13;
    const inCorner = (shape: Shape) =>
      shape.type === 'circle'
        ? shape.cx < 7 && shape.cy < 7
        : 'x' in shape && shape.x < 7 && shape.y < 7;
    return all.filter(dot ? inPatch : inCorner);
  }, [dot, corner, color]);
  return (
    <svg
      viewBox={dot ? '7.8 7.8 5.4 5.4' : '-0.2 -0.2 7.4 7.4'}
      className="size-7 sm:size-8"
      aria-hidden="true"
    >
      <QrShapes shapes={shapes} />
    </svg>
  );
}

/** A row of rendered previews to pick from: dots or corners. */
export function StyleTiles<T extends DotStyle | CornerStyle>({
  label,
  type,
  value,
  options,
  onChange,
  color,
  background,
}: {
  label: string;
  type: 'dot' | 'corner';
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  color: string;
  background: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'fx-move grid min-w-0 flex-1 justify-items-center gap-1.5 rounded-[16px] px-1 pt-2 pb-1.5 active:scale-[.95]',
              on
                ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent-ink,var(--color-ink)),0_10px_22px_-16px_var(--accent,transparent)]'
                : 'bg-ink/[.045] shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.08]',
            )}
          >
            <span
              className="grid size-11 place-items-center rounded-[11px] shadow-[inset_0_0_0_1px_var(--color-line)] sm:size-12"
              style={{ background }}
            >
              {type === 'dot' ? (
                <StyleSample dot={option.value as DotStyle} color={color} />
              ) : (
                <StyleSample corner={option.value as CornerStyle} color={color} />
              )}
            </span>
            <span className={cn('text-[12.5px] font-semibold', on ? 'text-ink' : 'text-muted')}>
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- swatches ---------------- */

export type Swatch = { value: string; name: string };

const CHECKER = 'repeating-conic-gradient(#d9dde0 0% 25%, #ffffff 0% 50%) 50% / 10px 10px';

/**
 * Colors, tapped. Like the kit's Swatches, plus the two a code needs: "none" (see-through, as a
 * checkerboard) and "same as the code". The system picker comes last.
 */
export function SwatchRow({
  label,
  value,
  options,
  onChange,
  same,
}: {
  label: string;
  value: string;
  options: Swatch[];
  onChange: (value: string) => void;
  /** The color "same as the code" stands for, when '' means that. */
  same?: string;
}) {
  const known = options.some((option) => option.value.toLowerCase() === value.toLowerCase());
  const box = 'size-11 lg:size-9';
  const ring =
    'ring-[2.5px] ring-[var(--accent-ink,var(--color-ink))] ring-offset-2 ring-offset-[var(--color-surface)]';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="scroller -mx-4 -my-2 flex gap-2 overflow-x-auto px-4 py-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:my-0 lg:flex-wrap lg:gap-1.5 lg:overflow-visible lg:px-0 lg:py-0"
    >
      {options.map((option) => {
        const on = option.value.toLowerCase() === value.toLowerCase();
        const none = option.value === '' && same === undefined;
        const matches = option.value === '' && same !== undefined;
        return (
          <button
            key={option.value || 'none'}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.name}
            title={option.name}
            onClick={() => onChange(option.value)}
            className={cn(
              'fx-move relative grid shrink-0 place-items-center rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.14)] active:scale-90',
              box,
              on && cn('scale-110', ring),
            )}
            style={{ background: none ? CHECKER : matches ? same : option.value }}
          >
            {matches && (
              <span className="size-3.5 rounded-full bg-white/90 shadow-[0_0_0_1px_rgb(0_0_0/.1)]" />
            )}
          </button>
        );
      })}
      <label
        title="Any color"
        className={cn(
          'fx-move relative grid shrink-0 cursor-pointer place-items-center rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.14)]',
          box,
          !known && cn('scale-110', ring),
        )}
        style={{
          background: known
            ? 'conic-gradient(#ff5e57, #ffd166, #8ee0a0, #3ee0d0, #6a84ff, #ff8ad8, #ff5e57)'
            : value,
        }}
      >
        <input
          type="color"
          aria-label={`${label}: any color`}
          value={
            /^#[0-9a-f]{6}$/i.test(value)
              ? value
              : same && /^#[0-9a-f]{6}$/i.test(same)
                ? same
                : '#12110d'
          }
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

/* ---------------- what this device can do ---------------- */

const never = () => () => {};

/** Whether the clipboard can be read (a Paste button instead of typing). */
export function useCanPaste() {
  return useSyncExternalStore(
    never,
    () => typeof navigator.clipboard?.readText === 'function',
    () => false,
  );
}

type ContactsApi = {
  select: (
    properties: string[],
    options?: { multiple?: boolean },
  ) => Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>;
};

/** Whether this phone lets a page pick one of its contacts (Chrome on Android). */
export function useCanPickContacts() {
  return useSyncExternalStore(
    never,
    () => 'contacts' in navigator && 'ContactsManager' in window,
    () => false,
  );
}

/** One contact from the phone's address book, or null when nothing was picked. */
export async function pickContact() {
  const api = (navigator as Navigator & { contacts?: ContactsApi }).contacts;
  if (!api) return null;
  const [picked] = await api.select(['name', 'tel', 'email'], { multiple: false });
  if (!picked) return null;
  return {
    name: picked.name?.[0]?.trim() ?? '',
    tel: picked.tel?.[0]?.trim() ?? '',
    email: picked.email?.[0]?.trim() ?? '',
  };
}

/* ---------------- files ---------------- */

/** Draws a logo file onto a square PNG, at most 512 px: raster only, so an SVG can't carry anything else. */
export async function logoFrom(file: File): Promise<string> {
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|svg|gif)$/i.test(file.name))
    throw new Error('That isn’t a picture. Try a PNG, JPG or SVG logo.');
  if (file.size > 5 * 1024 * 1024) throw new Error('That logo is over 5 MB. Try a smaller file.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const side = Math.min(512, Math.max(image.naturalWidth, image.naturalHeight) || 512);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser can’t read that logo.');
    const ratio = Math.min(side / image.naturalWidth, side / image.naturalHeight);
    const width = image.naturalWidth * ratio;
    const height = image.naturalHeight * ratio;
    context.drawImage(image, (side - width) / 2, (side - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } catch (error) {
    throw error instanceof Error && error.message.includes('logo')
      ? error
      : new Error('That file couldn’t be read as a picture. Try a PNG, JPG or SVG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}
