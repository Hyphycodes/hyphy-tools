import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import type { Category } from '@/lib/tools/bring';

/*
 * Bring's little pictures: the occasions as drawings, the picnic cloth, the category marks and
 * the people's initial circles. Drawn in the world's colors (green, cream, sky, butter).
 */

export const tint = (color: string, amount: number) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

/* ---------------- the cloth ---------------- */

/** A strip of picnic cloth, in the tool's green. */
export function Gingham({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none', className)}
      style={{
        background: `repeating-linear-gradient(90deg, ${tint('var(--accent, #8ee0a0)', 60)} 0 12px, transparent 12px 24px), repeating-linear-gradient(0deg, ${tint('var(--accent, #8ee0a0)', 38)} 0 12px, transparent 12px 24px)`,
      }}
    />
  );
}

/* ---------------- people ---------------- */

/** Friendly fills that hold dark text; the same name always gets the same one. */
const PERSON_COLORS = [
  '#8ee0a0',
  '#8ecff5',
  '#f5d77a',
  '#ffb38a',
  '#c9b6ff',
  '#7fd6c8',
  '#f7a6c1',
  '#a9b8ff',
];

export function personColor(name: string) {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return PERSON_COLORS[hash % PERSON_COLORS.length];
}

export const initialOf = (name: string) =>
  (name.trim().match(/\p{L}|\p{N}/u)?.[0] ?? '?').toUpperCase();

/** Someone's initial in their color. */
export function PersonDot({
  name,
  size = 32,
  ring = false,
  className,
}: {
  name: string;
  size?: number;
  /** A paper-colored ring, for stacks. */
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-[var(--on-accent,#12110d)]',
        ring && 'shadow-[0_0_0_2.5px_var(--color-surface)]',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: personColor(name),
        fontSize: Math.round(size * 0.44),
      }}
    >
      {initialOf(name)}
    </span>
  );
}

/** A few people, overlapping. */
export function PeopleStack({ names, size = 34 }: { names: string[]; size?: number }) {
  const shown = names.slice(0, 6);
  const more = names.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((name, index) => (
        <PersonDot
          key={name}
          name={name}
          size={size}
          ring
          className={cn('fx-pop', index > 0 && '-ml-2')}
        />
      ))}
      {more > 0 && (
        <span
          className="-ml-2 grid place-items-center rounded-full bg-well text-[12px] font-semibold text-ink-2 shadow-[0_0_0_2.5px_var(--color-surface)]"
          style={{ width: size, height: size }}
        >
          +{more}
        </span>
      )}
    </span>
  );
}

/* ---------------- categories ---------------- */

export const CATEGORY_LOOK: Record<Category, { icon: IconName; color: string }> = {
  food: { icon: 'utensils', color: '#ffb38a' },
  drinks: { icon: 'snowflake', color: 'var(--glow, #8ecff5)' },
  supplies: { icon: 'basket', color: 'var(--accent, #8ee0a0)' },
  other: { icon: 'party', color: '#c9b6ff' },
};

export function CategoryMark({ cat, size = 36 }: { cat: Category; size?: number }) {
  const look = CATEGORY_LOOK[cat];
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[11px] text-ink-2"
      style={{ width: size, height: size, background: tint(look.color, 42) }}
    >
      <Icon name={look.icon} size={Math.round(size * 0.47)} />
    </span>
  );
}

/* ---------------- the occasions ---------------- */

export const OCCASION_LOOK: Record<string, { color: string }> = {
  cookout: { color: '#ffb38a' },
  potluck: { color: '#f5d77a' },
  camping: { color: '#8ee0a0' },
  'game-night': { color: '#c9b6ff' },
  ideas: { color: '#8ecff5' },
};

const INK = 'var(--color-ink, #16251a)';

/** A drawing of the occasion: a grill, a covered dish, a tent, dice… */
export function OccasionPicture({ id, className }: { id: string; className?: string }) {
  const common = {
    viewBox: '0 0 120 80',
    className: cn('h-auto w-full', className),
    fill: 'none',
    stroke: INK,
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  const ground = <ellipse cx="60" cy="72" rx="34" ry="3.5" fill={INK} stroke="none" opacity=".1" />;
  switch (id) {
    case 'cookout':
      return (
        <svg {...common}>
          {ground}
          <path d="M52 22c-4-4 4-7 0-12M66 22c-4-4 4-7 0-12" opacity=".45" />
          <rect x="40" y="27" width="20" height="7" rx="3.5" fill="#c9774f" />
          <ellipse cx="72" cy="31" rx="10" ry="4" fill="#8a4b2f" />
          <path d="M30 37h60" />
          <path d="M32 37a28 20 0 0 0 56 0" fill="#ff9d6e" />
          <path d="M46 54l-7 16M74 54l7 16M60 57v13" />
        </svg>
      );
    case 'potluck':
      return (
        <svg {...common}>
          {ground}
          <path d="M50 20c-4-4 4-7 0-12M70 20c-4-4 4-7 0-12" opacity=".45" />
          <rect x="22" y="44" width="10" height="8" rx="4" fill="#fffdf5" />
          <rect x="88" y="44" width="10" height="8" rx="4" fill="#fffdf5" />
          <rect x="28" y="40" width="64" height="26" rx="9" fill="#f5d77a" />
          <path d="M27 40c8-15 58-15 66 0z" fill="#fffdf5" />
          <circle cx="60" cy="27" r="3.5" fill={INK} />
        </svg>
      );
    case 'camping':
      return (
        <svg {...common}>
          {ground}
          <path d="M92 70V58" />
          <path d="M92 20l-12 22h7l-9 16h28l-9-16h7z" fill="#2f8a52" />
          <path d="M16 70L46 20l30 50z" fill="#8ee0a0" />
          <path d="M38 70l8-22 8 22z" fill={INK} />
          <path d="M40 16l12-10" opacity=".45" />
          <circle cx="20" cy="18" r="1.6" fill={INK} stroke="none" opacity=".5" />
          <circle cx="104" cy="12" r="1.6" fill={INK} stroke="none" opacity=".5" />
        </svg>
      );
    case 'game-night':
      return (
        <svg {...common}>
          {ground}
          <rect
            x="22"
            y="16"
            width="30"
            height="44"
            rx="5"
            fill="#fffdf5"
            transform="rotate(-12 37 38)"
          />
          <path
            d="M34 34l4 5 4-5-4-5z"
            fill="#ff7a6b"
            stroke="none"
            transform="rotate(-12 37 38)"
          />
          <rect x="50" y="38" width="28" height="28" rx="7" fill="#c9b6ff" />
          <circle cx="58" cy="46" r="2.4" fill={INK} stroke="none" />
          <circle cx="70" cy="58" r="2.4" fill={INK} stroke="none" />
          <circle cx="64" cy="52" r="2.4" fill={INK} stroke="none" />
          <rect
            x="80"
            y="26"
            width="24"
            height="24"
            rx="6"
            fill="#8ecff5"
            transform="rotate(14 92 38)"
          />
          <circle cx="92" cy="38" r="2.3" fill={INK} stroke="none" />
        </svg>
      );
    default:
      // A blank list: a sheet with a pencil.
      return (
        <svg {...common}>
          {ground}
          <rect x="36" y="12" width="44" height="56" rx="6" fill="#fffdf5" />
          <path d="M45 28h26M45 38h26M45 48h14" opacity=".35" />
          <path d="M72 58l18-24 6 4-18 24-8 3z" fill="#f5d77a" />
        </svg>
      );
  }
}
