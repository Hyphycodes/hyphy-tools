'use client';
import {
  useCallback,
  useId,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { IconButton, Label, Surface, useCopy } from './kit';
import { PersonDot } from './bring-art';
import { LinkQr } from './share-link';

/*
 * Sharing a group session (Where?, Plan, Secret Santa, Bring): the phone's share sheet or the
 * clipboard, a code to scan, the tick that lands when it went out, "what should we call you?",
 * and the sessions this device keeps. Written against the world's tokens, so each tool's room
 * colors them.
 */

export type SendResult = 'shared' | 'copied' | 'failed' | null;

const noop = () => () => {};
export function useCanShare() {
  return useSyncExternalStore(
    noop,
    () => 'share' in navigator,
    () => false,
  );
}

/** The phone's share sheet where there is one, the clipboard where there isn't. */
export function useSendLink() {
  const canShare = useCanShare();
  return useCallback(
    async (link: string, title: string, text?: string): Promise<SendResult> => {
      if (canShare) {
        try {
          await navigator.share({ title, text, url: link });
          return 'shared';
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return null;
        }
      }
      try {
        await navigator.clipboard.writeText(link);
        return 'copied';
      } catch {
        return 'failed';
      }
    },
    [canShare],
  );
}

/** The name this person last gave any group tool here, offered so they don't type it twice. */
const NAME_KEY = 'hyphy.name.v1';
export function rememberName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name.trim().slice(0, 40));
  } catch {
    // Storage refused: they'll type it again next time.
  }
}
function rememberedName() {
  try {
    return window.localStorage.getItem(NAME_KEY)?.slice(0, 40) ?? '';
  } catch {
    return '';
  }
}

export function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Copy the link, a code to scan, the thing as text: the quieter ways to pass it on. */
export function LinkExtras({ link, text }: { link: string | null; text?: string }) {
  const { copy, copied } = useCopy();
  const [qr, setQr] = useState(false);
  const small =
    'inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/[.07] hover:text-ink disabled:opacity-40 lg:h-10';
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap justify-center gap-0.5">
        <button
          type="button"
          disabled={!link}
          onClick={() => link && void copy(link, 'Link copied')}
          className={small}
        >
          <Icon name={link && copied === link ? 'check' : 'link-2'} size={15} />
          {link && copied === link ? 'Copied' : 'Copy link'}
        </button>
        {link && link.length <= 1600 && (
          <button
            type="button"
            aria-pressed={qr}
            onClick={() => setQr((value) => !value)}
            className={small}
          >
            <Icon name="qr" size={15} /> {qr ? 'Hide code' : 'Code to scan'}
          </button>
        )}
        {text && (
          <button
            type="button"
            onClick={() => void copy(text, 'Copied. Paste it in the group chat.')}
            className={small}
          >
            <Icon name={copied === text ? 'check' : 'copy'} size={15} />
            {copied === text ? 'Copied' : 'Copy as text'}
          </button>
        )}
      </div>
      {qr && link && (
        <div className="fx-pop mx-auto w-full max-w-[200px] rounded-[16px] bg-white p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <LinkQr url={link} />
        </div>
      )}
    </div>
  );
}

/** A tick that lands: the share went out. */
export function SentMark({ title, line }: { title: string; line: string }) {
  return (
    <div className="grid justify-items-center gap-2 text-center" role="status">
      <span
        className="fx-stamp grid size-16 place-items-center rounded-full text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-14px_var(--accent)]"
        style={{ background: 'var(--accent, var(--color-ink))' }}
      >
        <Icon name="check" size={30} strokeWidth={3} />
      </span>
      <p
        className="fx-rise mt-1 font-display text-[28px] leading-none font-extrabold tracking-[-0.03em] text-ink"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {title}
      </p>
      <p className="fx-rise max-w-[30ch] text-[14px] leading-snug text-muted [--i:1]">{line}</p>
    </div>
  );
}

/**
 * "What should we call you?": one field, or a tap on a name that's already there ("that's me").
 * No account: the name is kept in this browser and travels with what this person does.
 */
export function NamePrompt({
  title = 'What should we call you?',
  lead,
  names = [],
  initial = '',
  cta = 'That’s me',
  onName,
  onCancel,
  bare = false,
  className,
}: {
  /** Inside a sheet that already has the title: no heading of its own. */
  bare?: boolean;
  title?: ReactNode;
  lead?: ReactNode;
  /** Names already in the group: tap one instead of typing. */
  names?: string[];
  initial?: string;
  cta?: string;
  onName: (name: string) => void;
  onCancel?: () => void;
  className?: string;
}) {
  const id = useId();
  const [name, setName] = useState(() => initial || rememberedName());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onName(name.trim());
  };
  return (
    <form
      onSubmit={submit}
      aria-labelledby={bare ? undefined : `${id}-title`}
      className={cn(
        'fx-rise grid gap-3 rounded-[22px] bg-surface p-4 shadow-lift sm:p-5',
        className,
      )}
    >
      {!bare && (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2
              id={`${id}-title`}
              className="font-display text-[21px] leading-tight font-bold tracking-[-0.02em] text-ink"
            >
              {title}
            </h2>
            {lead && <p className="mt-1 text-[14px] leading-snug text-muted">{lead}</p>}
          </div>
          {onCancel && <IconButton icon="x" label="Not now" onClick={onCancel} />}
        </div>
      )}
      {names.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pick your name">
          {names.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => onName(entry)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-well py-1 pr-4 pl-1.5 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
            >
              <PersonDot name={entry} size={30} /> {entry}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <label htmlFor={`${id}-name`} className="sr-only">
          Your name
        </label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={40}
          autoComplete="given-name"
          placeholder={names.length ? 'Or type your name' : 'Your name'}
          onChange={(event) => setName(event.target.value)}
          className="h-12 w-0 min-w-0 flex-1 rounded-[14px] bg-subtle px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--accent-ink,var(--color-signal))]"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="inline-flex h-12 shrink-0 items-center rounded-[14px] px-5 text-[15px] font-semibold text-[var(--on-accent,#12110d)] transition-opacity disabled:opacity-40"
          style={{ background: 'var(--accent, var(--color-ink))' }}
        >
          {cta}
        </button>
      </div>
    </form>
  );
}

/**
 * The group's link only travels if people pass it on, so after someone does something (votes,
 * says they're in) this asks for the link back. It floats under the thumb on phones.
 */
export function SendBackBar({
  message,
  link,
  onSend,
  onDone,
  cta = 'Send it back',
}: {
  message: ReactNode;
  link: string | null;
  onSend: () => Promise<SendResult>;
  onDone: () => void;
  cta?: string;
}) {
  const [result, setResult] = useState<SendResult>(null);
  return (
    <div
      role="status"
      className="fx-rise fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[520px] rounded-[22px] bg-surface p-3.5 shadow-pop"
    >
      <div className="flex items-center gap-3">
        <span
          className="fx-stamp grid size-10 shrink-0 place-items-center rounded-full text-[var(--on-accent,#12110d)]"
          style={{ background: 'var(--accent, var(--color-ink))' }}
        >
          <Icon name="check" size={19} strokeWidth={3} />
        </span>
        <p className="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-ink">
          {result === 'copied' ? 'Link copied. Paste it in the group chat.' : message}
        </p>
        <IconButton icon="x" label="Close" onClick={onDone} />
      </div>
      <button
        type="button"
        disabled={!link}
        onClick={async () => {
          const outcome = await onSend();
          setResult(outcome);
          if (outcome === 'shared') onDone();
        }}
        className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15.5px] font-semibold text-[var(--on-accent,#12110d)] transition-[opacity,transform] active:scale-[.985] disabled:opacity-50"
        style={{ background: 'var(--accent, var(--color-ink))' }}
      >
        <Icon name="send" size={17} /> {link ? cta : 'Updating the link…'}
      </button>
      {result === 'failed' && (
        <p className="mt-2 text-[12.5px] text-critical">
          This browser wouldn’t copy. Long-press the address bar and copy it from there.
        </p>
      )}
    </div>
  );
}

/** Paste a link someone sent back (opening it here does the same). */
export function CombineLink({
  onCombine,
  label = 'Got a link back? Combine it',
}: {
  onCombine: (text: string) => Promise<{ error: string; other?: string } | { done: string }>;
  label?: string;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error: string; other?: string } | { done: string } | null>(
    null,
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const outcome = await onCombine(text.trim());
    setBusy(false);
    setResult(outcome);
    if ('done' in outcome) setText('');
  };
  return (
    <form onSubmit={submit} className="grid gap-2">
      <label htmlFor={`${id}-link`} className="text-[13.5px] font-medium text-ink-2">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-link`}
          value={text}
          placeholder="Paste a link"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
          }}
          className="h-11 w-0 min-w-0 flex-1 rounded-[12px] bg-surface px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:text-[14.5px]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="inline-flex h-11 shrink-0 items-center rounded-[12px] bg-ink px-4 text-[14.5px] font-semibold text-on-ink disabled:opacity-40"
        >
          Combine
        </button>
      </div>
      {result && (
        <p
          role="status"
          className={cn(
            'text-[13px] leading-relaxed',
            'error' in result ? 'text-critical' : 'text-positive',
          )}
        >
          {'error' in result ? result.error : result.done}{' '}
          {'error' in result && result.other && (
            <a
              href={`#${result.other.replace(/^#/, '')}`}
              className="font-semibold text-ink underline underline-offset-2"
            >
              Open that one instead
            </a>
          )}
        </p>
      )}
    </form>
  );
}

/** The sessions this device keeps: the ones it organizes and the ones shared with it. */
export function DeviceSessions({
  title,
  items,
  current,
  newLabel,
  onOpen,
  onForget,
  onStartNew,
}: {
  title: string;
  items: { id: string; title: string; line: string }[];
  current: string | null;
  newLabel: string;
  onOpen: (id: string) => void;
  onForget: (id: string) => void;
  onStartNew: () => void;
}) {
  return (
    <Surface className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{title}</Label>
        <button
          type="button"
          onClick={onStartNew}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <Icon name="plus" size={14} /> {newLabel}
        </button>
      </div>
      <ul className="grid gap-1">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'min-h-12 min-w-0 flex-1 rounded-[12px] px-3 py-2 text-left transition-colors',
                  active
                    ? 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
                    : 'hover:bg-ink/5',
                )}
              >
                <span className="block truncate text-[14px] font-medium text-ink">
                  {item.title}
                </span>
                <span className="block truncate text-[12px] text-muted">{item.line}</span>
              </button>
              <IconButton
                icon="x"
                label={`Remove “${item.title}” from this device`}
                onClick={() => onForget(item.id)}
                className="!size-11 lg:!size-10"
              />
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}

/** "What should we call you?" as a sheet: asked once, the first time someone joins in. */
export function AskName({
  open,
  title = 'What should we call you?',
  lead,
  names,
  initial = '',
  cta,
  onName,
  onClose,
}: {
  open: boolean;
  title?: string;
  lead?: ReactNode;
  names?: string[];
  initial?: string;
  cta?: string;
  onName: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} width="sm" title={title} description={lead}>
      {open && (
        <NamePrompt
          bare
          names={names}
          initial={initial}
          cta={cta}
          onName={onName}
          className="!animate-none !p-0 !shadow-none"
        />
      )}
    </Sheet>
  );
}
