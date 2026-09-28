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
      <span
        className="grid size-12 place-items-center rounded-full text-[#12110d] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]"
        style={{ background: accent ?? 'var(--color-well)' }}
      >
        <Icon name={icon} size={22} />
      </span>
      <p className="text-[15.5px] font-semibold text-ink">{over ? 'Drop to add' : title}</p>
      {hint && <p className="max-w-sm text-[13px] text-muted">{hint}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <label
          htmlFor={id}
          className={cn(
            'inline-flex h-11 items-center gap-2 rounded-[12px] bg-ink px-4 text-[15px] font-medium text-on-ink transition-colors hover:bg-ink-2 lg:h-10 lg:text-[14px]',
            disabled && 'pointer-events-none opacity-45',
          )}
        >
          <Icon name="plus" size={16} /> {multiple ? 'Choose files' : 'Choose a file'}
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
