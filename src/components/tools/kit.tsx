'use client';
import { useCallback, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';

/*
 * The parts every tool is built from. Written against the product's tokens (surface, ink, line…),
 * so a tool looks right in the dark public world and inside a light Space alike.
 */

/** A raised working area. */
export function Surface({
  children,
  className,
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'aside';
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn('min-w-0 rounded-[22px] bg-surface p-4 shadow-card sm:p-5', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A small caps label over a group of controls. */
export function Label({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <h2 id={id} className={cn('label', className)}>
      {children}
    </h2>
  );
}

export function useCopy() {
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(
    async (text: string, what = 'Copied') => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(text);
        setTimeout(() => setCopied((current) => (current === text ? null : current)), 1600);
        toast({ title: what });
        return true;
      } catch {
        toast({ title: 'Couldn’t copy. Select the text and copy it instead.', icon: 'alert' });
        return false;
      }
    },
    [toast],
  );
  return { copy, copied };
}

export function CopyButton({
  text,
  label = 'Copy',
  what,
  className,
  variant = 'quiet',
  disabled,
}: {
  text: string;
  label?: string;
  what?: string;
  className?: string;
  variant?: 'quiet' | 'solid';
  disabled?: boolean;
}) {
  const { copy, copied } = useCopy();
  const done = copied === text;
  return (
    <button
      type="button"
      disabled={disabled || !text}
      onClick={() => copy(text, what)}
      className={cn(
        'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[11px] px-3.5 text-[14px] font-medium transition-colors disabled:opacity-40 lg:h-9 lg:text-[13.5px]',
        variant === 'solid'
          ? 'bg-ink text-on-ink hover:bg-ink-2'
          : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
        className,
      )}
    >
      <Icon name={done ? 'check' : 'copy'} size={15} />
      {done ? 'Copied' : label}
    </button>
  );
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

/**
 * Where files go in: a big, obvious target that's also a button (phones), takes drops (desktops)
 * and, when asked, a whole folder. Files are only read on this device.
 */
export function FileDrop({
  onFiles,
  accept,
  multiple = true,
  folder = false,
  icon = 'upload',
  title,
  hint,
  accent,
  compact = false,
  disabled = false,
  className,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Offer "Choose a folder" as well. */
  folder?: boolean;
  icon?: IconName;
  title: string;
  hint?: ReactNode;
  accent?: string;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  // Say what it takes: phones then offer Photos and the camera for pictures.
  const kind = accept?.startsWith('image/')
    ? multiple
      ? 'Choose photos'
      : 'Choose a photo'
    : /pdf/.test(accept ?? '')
      ? multiple
        ? 'Choose PDFs'
        : 'Choose a PDF'
      : multiple
        ? 'Choose files'
        : 'Choose a file';
  return (
    <div
      onDragEnter={(event) => {
        if (!hasFiles(event) || disabled) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(false);
        if (!disabled) take(event.dataTransfer.files);
      }}
      className={cn(
        'relative flex flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed text-center transition-colors',
        compact ? 'px-4 py-6' : 'px-5 py-10 sm:py-12',
        over ? 'border-signal bg-signal-soft' : 'border-line-strong bg-subtle',
        className,
      )}
    >
      {/* The whole area is the button: a thumb anywhere on it opens the picker. */}
      <label
        htmlFor={id}
        aria-hidden="true"
        className={cn('absolute inset-0 rounded-[18px]', disabled ? '' : 'cursor-pointer')}
      />
      <span
        className="pointer-events-none relative grid size-12 place-items-center rounded-full text-[#12110d] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]"
        style={{ background: accent ?? 'var(--color-well)' }}
      >
        <Icon name={icon} size={22} />
      </span>
      <p className="pointer-events-none relative text-[15.5px] font-semibold text-ink">
        {over ? 'Drop to add' : title}
      </p>
      {hint && (
        <p className="pointer-events-none relative max-w-sm text-[13px] text-muted">{hint}</p>
      )}
      <div className="relative mt-2 flex flex-wrap justify-center gap-2">
        <label
          htmlFor={id}
          className={cn(
            'inline-flex h-11 items-center gap-2 rounded-[12px] bg-ink px-4 text-[15px] font-medium text-on-ink transition-colors hover:bg-ink-2 lg:h-10 lg:text-[14px]',
            disabled && 'pointer-events-none opacity-45',
          )}
        >
          <Icon name="plus" size={16} /> {kind}
        </label>
        {folder && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => folderInput.current?.click()}
            className="inline-flex h-11 items-center gap-2 rounded-[12px] bg-well px-4 text-[15px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink disabled:opacity-45 lg:h-10 lg:text-[14px]"
          >
            <Icon name="folder-open" size={16} /> Choose a folder
          </button>
        )}
      </div>
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
      {folder && (
        <input
          ref={folderInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          // A folder picker: every file inside, with its path.
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(event) => {
            take(event.target.files);
            event.target.value = '';
          }}
        />
      )}
    </div>
  );
}

/** A number with a label, big: totals, counts, savings. */
export function Stat({
  label,
  value,
  detail,
  className,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-[16px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]',
        className,
      )}
    >
      <p className="label">{label}</p>
      <p
        className={cn(
          'mt-1.5 truncate font-display text-[26px] leading-none font-bold tracking-[-0.03em] sm:text-[30px]',
          tone === 'accent' ? 'text-[var(--accent,var(--color-ink))]' : 'text-ink',
        )}
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {value}
      </p>
      {detail && <p className="mt-1.5 text-[12.5px] text-muted">{detail}</p>}
    </div>
  );
}

/** A quiet, dismissable note: how this works, what just happened. */
export function Note({
  children,
  icon = 'lock',
  tone = 'quiet',
  className,
}: {
  children: ReactNode;
  icon?: IconName;
  tone?: 'quiet' | 'caution' | 'positive';
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-[13px] leading-relaxed',
        tone === 'caution' && 'bg-caution-soft text-caution',
        tone === 'positive' && 'bg-positive-soft text-positive',
        tone === 'quiet' && 'bg-subtle text-muted shadow-[inset_0_0_0_1px_var(--color-line)]',
        className,
      )}
    >
      <Icon name={icon} size={15} className="mt-[2px] shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Small round icon button: remove, move, edit. */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  tone = 'default',
  className,
  size = 'md',
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid shrink-0 place-items-center rounded-[10px] text-muted transition-colors disabled:opacity-30',
        size === 'md' ? 'size-10 lg:size-9' : 'size-8',
        tone === 'danger'
          ? 'hover:bg-critical-soft hover:text-critical'
          : 'hover:bg-ink/[.07] hover:text-ink',
        className,
      )}
    >
      <Icon name={icon} size={size === 'md' ? 17 : 15} />
    </button>
  );
}

/* ---------------- guided parts ---------------- */

/*
 * The pieces that make a tool feel guided rather than like a form: a warm start screen, big
 * choices instead of typing, one obvious next action, and the rest tucked under "More options".
 * They read the tool's world (`--accent`, `--glow`), and fall back to ink inside a Space.
 */

const ACCENT = 'var(--accent, var(--color-ink))';

/**
 * The first screen of a tool: a picture of what it makes, one sentence, one big way in, and an
 * optional sample so the first try costs nothing.
 */
export function StartPanel({
  art,
  eyebrow,
  title,
  lead,
  children,
  steps,
  footer,
  className,
}: {
  /** A picture of the result: an illustration, a sample preview. */
  art?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  /** The way in: an upload target, a big button, a row of choices. */
  children?: ReactNode;
  /** The path, in a few words a step ("Add a photo", "Pick the feeds", "Export"). */
  steps?: string[];
  /** Small print under everything: privacy, "Type it in instead". */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative isolate min-w-0 overflow-hidden rounded-[26px] bg-surface p-5 shadow-card sm:p-8',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(70% 55% at 50% 0%, color-mix(in srgb, ${ACCENT} 16%, transparent), transparent 70%), radial-gradient(50% 40% at 100% 100%, color-mix(in srgb, var(--glow, ${ACCENT}) 10%, transparent), transparent 70%)`,
        }}
      />
      <div className="mx-auto flex max-w-[560px] flex-col items-center text-center">
        {art && <div className="mb-5 w-full sm:mb-6">{art}</div>}
        {eyebrow && <p className="label mb-2 !text-ink-2">{eyebrow}</p>}
        <h2
          className="font-display text-[30px] leading-[1] font-bold tracking-[-0.035em] text-balance text-ink sm:text-[40px]"
          style={{ fontVariationSettings: "'wdth' 110" }}
        >
          {title}
        </h2>
        {lead && (
          <p className="mt-2.5 max-w-[40ch] text-[15.5px] leading-snug text-pretty text-muted sm:text-[17px]">
            {lead}
          </p>
        )}
        {children && <div className="mt-6 w-full">{children}</div>}
        {steps && steps.length > 1 && <StepPath steps={steps} className="mt-6" />}
        {footer && <div className="mt-5 w-full text-[13px] text-muted">{footer}</div>}
      </div>
    </section>
  );
}

/** Three little numbered words: the whole path, at a glance. */
export function StepPath({ steps, className }: { steps: string[]; className?: string }) {
  return (
    <ol
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 text-[13px] text-muted',
        className,
      )}
    >
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-1.5">
          {index > 0 && <Icon name="chevron-right" size={13} className="text-faint" />}
          <span
            className="mono-num grid size-5 place-items-center rounded-full text-[10.5px] font-bold text-[#12110d]"
            style={{ background: ACCENT }}
          >
            {index + 1}
          </span>
          <span className="text-ink-2">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Where you are in a tool with steps: numbered, tappable when reachable, the current one lit in
 * the tool's color. On a phone it's a row of short bars with the current step named.
 */
export function Journey({
  steps,
  current,
  onPick,
  reachable,
  className,
}: {
  steps: string[];
  current: number;
  onPick?: (index: number) => void;
  reachable?: (index: number) => boolean;
  className?: string;
}) {
  return (
    <nav aria-label="Steps" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 gap-1.5">
        {steps.map((label, index) => {
          const done = index < current;
          const here = index === current;
          const can = onPick && (reachable ? reachable(index) : index <= current);
          return (
            <li key={label} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!can}
                aria-current={here ? 'step' : undefined}
                onClick={() => onPick?.(index)}
                className="group flex w-full min-w-0 flex-col gap-2 py-1.5 text-left"
              >
                <span
                  className={cn(
                    'block h-1.5 w-full rounded-full transition-colors',
                    !done && !here && 'bg-white/[.09] group-enabled:group-hover:bg-white/20',
                  )}
                  style={
                    done || here ? { background: ACCENT, opacity: done ? 0.55 : 1 } : undefined
                  }
                />
                <span
                  className={cn(
                    'hidden truncate text-[12.5px] font-medium sm:block',
                    here ? 'text-ink' : done ? 'text-ink-2' : 'text-faint',
                  )}
                >
                  <span className="mono-num mr-1">{index + 1}</span>
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-[13px] text-muted sm:hidden">
        <span className="font-semibold text-ink">{steps[current]}</span>
        <span className="mono-num ml-1.5">
          {current + 1} of {steps.length}
        </span>
      </p>
    </nav>
  );
}

/**
 * Pick one, by tapping: big chips with an optional icon and hint, instead of a select or a text
 * field. Scrolls sideways on a phone when there are many.
 */
export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  scroll = false,
  className,
}: {
  /** Read by screen readers: what's being chosen. */
  label: string;
  value: T | null;
  options: { value: T; label: ReactNode; icon?: IconName; hint?: ReactNode; swatch?: string }[];
  onChange: (value: T) => void;
  size?: 'md' | 'lg';
  /** One row that scrolls sideways (phones), instead of wrapping. */
  scroll?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex gap-2',
        scroll ? 'scroller -mx-4 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0' : 'flex-wrap',
        className,
      )}
    >
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
              'inline-flex shrink-0 items-center gap-2 rounded-full font-medium transition-[background-color,color,box-shadow,transform] active:scale-[.97]',
              size === 'lg'
                ? 'min-h-12 px-4.5 text-[15px]'
                : 'min-h-11 px-4 text-[14.5px] lg:min-h-10 lg:text-[14px]',
              on
                ? 'text-[#12110d] shadow-[0_8px_22px_-12px_var(--accent,transparent)]'
                : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
            )}
            style={on ? { background: ACCENT } : undefined}
          >
            {option.swatch && (
              <span
                aria-hidden="true"
                className="size-3.5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.15)]"
                style={{ background: option.swatch }}
              />
            )}
            {option.icon && <Icon name={option.icon} size={size === 'lg' ? 18 : 16} />}
            <span className="whitespace-nowrap">{option.label}</span>
            {option.hint && (
              <span className={cn('text-[12.5px]', on ? 'text-[#12110d]/65' : 'text-muted')}>
                {option.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A grid of big picture choices: "What kind of code?", "Which feeds?". Each is a card with an
 * icon, a name and a line; multiple selection when `multiple`.
 */
export function ChoiceCards<T extends string>({
  label,
  options,
  selected,
  onToggle,
  multiple = false,
  columns = 2,
  className,
}: {
  label: string;
  options: { value: T; label: ReactNode; icon?: IconName; hint?: ReactNode; art?: ReactNode }[];
  selected: T[];
  onToggle: (value: T) => void;
  multiple?: boolean;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      role={multiple ? 'group' : 'radiogroup'}
      aria-label={label}
      className={cn(
        'grid gap-2.5',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-2 sm:grid-cols-3',
        columns === 4 && 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
    >
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            onClick={() => onToggle(option.value)}
            className={cn(
              'relative flex min-h-[84px] min-w-0 flex-col items-start gap-1.5 rounded-[18px] p-3.5 text-left transition-[background-color,box-shadow,transform] active:scale-[.98]',
              on
                ? 'bg-signal-soft shadow-[inset_0_0_0_2px_var(--accent,var(--color-ink))]'
                : 'bg-well shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.09]',
            )}
          >
            {option.art}
            {option.icon && (
              <span
                className={cn(
                  'grid size-9 place-items-center rounded-[11px]',
                  on ? 'text-[#12110d]' : 'bg-white/[.06] text-ink-2',
                )}
                style={on ? { background: ACCENT } : undefined}
              >
                <Icon name={option.icon} size={18} />
              </span>
            )}
            <span className="text-[15px] leading-tight font-semibold text-ink">{option.label}</span>
            {option.hint && (
              <span className="text-[12.5px] leading-snug text-muted">{option.hint}</span>
            )}
            {multiple && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-3 right-3 grid size-5.5 place-items-center rounded-full transition-colors',
                  on ? 'text-[#12110d]' : 'shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
                )}
                style={on ? { background: ACCENT } : undefined}
              >
                {on && <Icon name="check" size={13} strokeWidth={3} />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Everything that isn't needed yet: closed until asked for. A native <details>, so it works
 * before the page is interactive and remembers nothing.
 */
export function MoreOptions({
  children,
  label = 'More options',
  summary,
  defaultOpen = false,
  className,
}: {
  children: ReactNode;
  label?: ReactNode;
  /** What's set now, in a few words, shown while closed ("1024px · border 4"). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn('group/more min-w-0', className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[12px] text-[14.5px] font-medium text-ink-2 transition-colors select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="grid size-7 place-items-center rounded-full bg-well transition-transform group-open/more:rotate-45">
          <Icon name="plus" size={15} />
        </span>
        <span className="min-w-0 flex-1">{label}</span>
        {summary && (
          <span className="truncate text-[13px] font-normal text-muted group-open/more:hidden">
            {summary}
          </span>
        )}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/** The one big thing to do, in the tool's color. */
export function ActionButton({
  children,
  icon,
  onClick,
  disabled,
  type = 'button',
  variant = 'accent',
  className,
}: {
  children: ReactNode;
  icon?: IconName;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  variant?: 'accent' | 'quiet';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-14 w-full items-center justify-center gap-2 rounded-[16px] px-5 text-[16.5px] font-semibold transition-[transform,opacity,background-color] active:scale-[.985] disabled:opacity-40 disabled:shadow-none sm:h-13 sm:text-[16px]',
        variant === 'accent'
          ? 'text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent,transparent)]'
          : 'bg-well text-ink shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/10',
        className,
      )}
      style={variant === 'accent' ? { background: ACCENT } : undefined}
    >
      {icon && <Icon name={icon} size={19} />}
      {children}
    </button>
  );
}

/**
 * Keeps the next action under the thumb on a phone: sticks to the bottom of the screen while its
 * section is in view. On larger screens it simply sits in place.
 */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 -mx-4 mt-5 bg-gradient-to-t from-surface via-surface/95 to-transparent px-4 pt-5 pb-[max(12px,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:bg-none sm:px-0 sm:pt-0 sm:pb-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** "Try a sample": the first use should cost nothing. */
export function SampleButton({
  onClick,
  children = 'Try a sample',
  disabled,
  className,
}: {
  onClick: () => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'mx-auto flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-medium text-signal-ink transition-colors hover:bg-signal-soft disabled:opacity-50',
        className,
      )}
    >
      <Icon name="sparkles" size={16} />
      {children}
    </button>
  );
}
