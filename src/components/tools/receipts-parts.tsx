'use client';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { getPhoto } from '@/lib/share/photos';
import { CATEGORIES, CATEGORY_NAMES, type ReceiptCategory } from '@/lib/tools/receipts';

/*
 * Receipts' world: warm receipt paper on a quiet ledger, rich emerald and charcoal. The receipt
 * photo is the object; details sit on a paper slip beside it; saved receipts stack by month.
 */

export const CATEGORY_LOOK: Record<ReceiptCategory, { icon: IconName; color: string }> = {
  materials: { icon: 'hammer', color: '#d98b3a' },
  meals: { icon: 'utensils', color: '#e0655a' },
  travel: { icon: 'plane', color: '#4f7cff' },
  fuel: { icon: 'fuel', color: '#1f8a5b' },
  office: { icon: 'briefcase', color: '#8f6bd8' },
  equipment: { icon: 'wrench', color: '#3a403c' },
  other: { icon: 'tag', color: '#9aa39c' },
};

export function CategoryMark({
  category,
  size = 36,
}: {
  category: ReceiptCategory;
  size?: number;
}) {
  const look = CATEGORY_LOOK[category];
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[11px] text-white"
      style={{ width: size, height: size, background: look.color }}
    >
      <Icon name={look.icon} size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  );
}

/** Pick a category by tapping; the suggested one says so. */
export function CategoryChips({
  value,
  suggested,
  onChange,
}: {
  value: ReceiptCategory;
  suggested?: ReceiptCategory | null;
  onChange: (category: ReceiptCategory) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1.5">
      {CATEGORIES.map((category) => {
        const on = value === category;
        const look = CATEGORY_LOOK[category];
        return (
          <button
            key={category}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(category)}
            className={cn(
              'fx-move inline-flex min-h-11 items-center gap-1.5 rounded-full py-1 pr-3.5 pl-1.5 text-[14px] font-semibold active:scale-[.97]',
              on
                ? 'bg-ink text-on-ink shadow-[0_8px_18px_-10px_rgb(0_0_0/.5)]'
                : 'bg-well text-ink-2 hover:bg-ink/10',
            )}
          >
            <span
              className="grid size-8 place-items-center rounded-full text-white"
              style={{ background: look.color }}
            >
              <Icon name={look.icon} size={15} strokeWidth={2.2} />
            </span>
            {CATEGORY_NAMES[category]}
            {suggested === category && !on && (
              <span className="text-[11.5px] font-medium text-muted">suggested</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A saved receipt's photo, from this browser, as a small picture (or its category). */
export function Thumb({
  id,
  has,
  category,
  className,
}: {
  id: string;
  has: boolean;
  category: ReceiptCategory;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!has) return;
    let live = true;
    let made: string | null = null;
    void getPhoto(id).then((blob) => {
      if (!live || !blob) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, has]);
  if (!url) return <CategoryMark category={category} size={48} />;
  return (
    // A local object URL from this browser's storage: next/image can't optimize it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className={cn('size-12 shrink-0 rounded-[11px] object-cover object-top', className)}
    />
  );
}

/** A saved receipt's photo at full size, when there is one. */
export function PhotoView({ id, has, alt }: { id: string; has: boolean; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!has) return;
    let live = true;
    let made: string | null = null;
    void getPhoto(id).then((blob) => {
      if (!live) return;
      if (!blob) return setMissing(true);
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, has]);
  if (!has || missing)
    return (
      <div className="grid h-40 place-items-center rounded-[18px] bg-well text-center text-[14px] text-muted">
        <span>
          <Icon name="receipt" size={26} className="mx-auto mb-1.5" />
          {missing ? 'The photo isn’t in this browser anymore.' : 'No photo for this one.'}
        </span>
      </div>
    );
  if (!url) return <div className="skeleton h-72 !rounded-[18px]" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="max-h-[60vh] w-full rounded-[18px] bg-white object-contain shadow-card"
      />
    </a>
  );
}

/** The paper slip the details sit on: a scalloped tear along the bottom. */
export function Slip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative drop-shadow-[0_14px_22px_rgb(29_36_32/.16)]', className)}>
      <div className="rounded-t-[22px] bg-surface px-5 pt-6 pb-6 sm:px-7">{children}</div>
      <div
        aria-hidden="true"
        className="h-2.5"
        style={{
          background:
            'radial-gradient(circle at 9px 0, var(--color-surface) 8px, transparent 8.5px) 0 0 / 18px 10px repeat-x',
        }}
      />
    </div>
  );
}

/** A field on the slip that turns into an input when tapped. */
export function TapField({
  label,
  display,
  empty,
  children,
  editing,
  onEdit,
  big = false,
}: {
  label: string;
  display: ReactNode;
  empty: string;
  children: ReactNode;
  editing: boolean;
  onEdit: () => void;
  big?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-1" id={id}>
      <p className="text-[11.5px] font-bold tracking-[.12em] text-muted uppercase">{label}</p>
      {editing ? (
        children
      ) : (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${label}: ${display || empty}. Change`}
          className={cn(
            'group -mx-2 flex min-h-11 items-center gap-2 rounded-[12px] px-2 text-left transition-colors hover:bg-ink/[.04]',
            big
              ? 'font-display text-[44px] leading-none font-extrabold tracking-[-0.04em] sm:text-[52px]'
              : 'text-[18px] font-semibold',
            display ? 'text-ink' : 'text-[var(--accent-ink)]',
          )}
          style={big ? { fontVariationSettings: "'wdth' 110" } : undefined}
        >
          <span className="min-w-0 truncate">{display || empty}</span>
          <Icon
            name="pencil"
            size={big ? 18 : 14}
            className="shrink-0 text-faint opacity-60 group-hover:opacity-100"
          />
        </button>
      )}
    </div>
  );
}
