'use client';
import { useId, useState, type FormEvent } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { progress, type BringList, type BringStore } from '@/lib/tools/bring';
import { ActionButton, IconButton, Label, Surface } from './kit';
import { Gingham, PeopleStack } from './bring-art';
import { joinNames, LinkExtras, SentMark, type SendResult } from './group-share';

export { joinNames, useCanShare, useSendLink, type SendResult } from './group-share';

/*
 * Bring's sharing: the invitation the organizer sends, the "send it back" a guest sends, and the
 * quieter things (combine a link, the lists on this device).
 */

export type Combined = { error: string; other?: string } | { done: string };

/** The organizer's invitation: what everyone will see, and the one big way to send it. */
export function InviteCard({
  id,
  list,
  link,
  text,
  status,
  people,
  onSend,
}: {
  id: string;
  list: BringList;
  link: string | null;
  text: string;
  /** How the link last went out: for this version of the list, or an older one. */
  status: { how: 'shared' | 'copied'; current: boolean } | null;
  people: string[];
  onSend: () => void;
}) {
  const title = list.title.trim() || 'What to bring';
  const details = [list.when.trim(), list.where.trim()].filter(Boolean).join(' · ');
  const { total, claimed, needed } = progress(list);
  const fresh = status?.current;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="relative grid scroll-mt-24 gap-5 overflow-hidden rounded-[24px] bg-surface px-5 pt-8 pb-5 shadow-lift sm:px-6"
    >
      <Gingham className="absolute inset-x-0 top-0 h-3" />
      <h2 id={`${id}-title`} className="sr-only">
        Send the invite
      </h2>
      {fresh ? (
        <SentMark
          key={status.how}
          title={status.how === 'shared' ? 'Invite sent' : 'Link copied'}
          line={
            status.how === 'shared'
              ? 'Open the links people send back here, and their names land on the list.'
              : 'Paste it in the group chat. Open the links people send back here.'
          }
        />
      ) : (
        <div className="grid justify-items-center gap-1.5 text-center">
          <p
            className="font-display text-[26px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance text-ink"
            style={{ fontVariationSettings: "'wdth' 108" }}
          >
            {title}
          </p>
          {details && <p className="text-[14px] text-ink-2">{details}</p>}
          <div className="mt-1.5 flex items-center gap-2.5">
            {people.length > 0 && <PeopleStack names={people} size={28} />}
            <p className="text-[13.5px] text-muted">
              {needed ? `${claimed} of ${total} covered` : `All ${total} covered`}
            </p>
          </div>
        </div>
      )}
      <div className="grid gap-2">
        {status && !status.current && (
          <p className="flex items-center justify-center gap-1.5 text-[13px] text-ink-2">
            <Icon name="refresh" size={13} className="text-muted" /> Changed since you sent it
          </p>
        )}
        <ActionButton icon="send" disabled={!link} onClick={onSend}>
          {!link
            ? 'Getting the link…'
            : fresh
              ? 'Send it again'
              : !needed
                ? 'Send the final list'
                : status
                  ? 'Send the update'
                  : 'Send the invite'}
        </ActionButton>
        <LinkExtras link={link} text={text} />
      </div>
    </section>
  );
}

/** A guest's side: what they're bringing, and sending the link back. */
export function GuestCard({
  names,
  link,
  sent,
  onSend,
}: {
  names: string[];
  link: string | null;
  sent: 'shared' | 'copied' | null;
  onSend: () => void;
}) {
  return (
    <section className="relative grid gap-4 overflow-hidden rounded-[24px] bg-surface px-5 pt-8 pb-5 shadow-lift sm:px-6">
      <Gingham className="absolute inset-x-0 top-0 h-3" />
      {sent ? (
        <SentMark
          title={sent === 'shared' ? 'Sent back' : 'Link copied'}
          line={
            sent === 'shared'
              ? 'Everyone who opens it sees what you’re bringing.'
              : 'Send it back to the group so everyone sees what you’re bringing.'
          }
        />
      ) : (
        <div className="text-center">
          <p className="label">You’re bringing</p>
          <p className="mt-1.5 text-[18px] leading-snug font-semibold text-balance text-ink">
            {joinNames(names)}
          </p>
        </div>
      )}
      <ActionButton icon="send" disabled={!link} onClick={onSend}>
        {!link ? 'Updating the link…' : sent ? 'Send it again' : 'Send it back'}
      </ActionButton>
    </section>
  );
}

/**
 * After a guest claims: the list only travels if the link does, so ask for it back. It floats at
 * the bottom of the screen, because the thing just claimed is under the thumb.
 */
export function SendBack({
  names,
  link,
  onSend,
  onDone,
}: {
  names: string[];
  link: string | null;
  onSend: () => Promise<SendResult>;
  onDone: () => void;
}) {
  const [result, setResult] = useState<SendResult>(null);
  return (
    <div
      role="status"
      className="fx-rise fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 rounded-[22px] bg-surface p-3.5 shadow-pop lg:hidden"
    >
      <div className="flex items-center gap-3">
        <span
          className="fx-stamp grid size-10 shrink-0 place-items-center rounded-full text-[var(--on-accent,#12110d)]"
          style={{ background: 'var(--accent, var(--color-ink))' }}
        >
          <Icon name="check" size={19} strokeWidth={3} />
        </span>
        <p className="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-ink">
          {result === 'copied'
            ? 'Copied. Send it back to the group.'
            : `${joinNames(names)}: yours. Now send it back.`}
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
        <Icon name="send" size={17} /> {link ? 'Send it back' : 'Updating the link…'}
      </button>
      {result === 'failed' && (
        <p className="mt-2 text-[12.5px] text-critical">
          This browser wouldn’t copy. Use Send it back beside the list instead.
        </p>
      )}
    </div>
  );
}

/** Paste a link someone sent back (opening it here does the same). */
export function Combine({ onCombine }: { onCombine: (text: string) => Promise<Combined> }) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Combined | null>(null);

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
        Got a link back? Combine it
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
              Open that list instead
            </a>
          )}
        </p>
      )}
    </form>
  );
}

export function DeviceLists({
  store,
  onOpen,
  onForget,
  onStartNew,
}: {
  store: BringStore;
  onOpen: (listId: string) => void;
  onForget: (listId: string) => void;
  onStartNew: () => void;
}) {
  return (
    <Surface className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label>Your lists</Label>
        <button
          type="button"
          onClick={onStartNew}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <Icon name="plus" size={14} /> New list
        </button>
      </div>
      <ul className="grid gap-1">
        {store.lists.map((entry) => {
          const active = entry.list.id === store.current;
          const title = entry.list.title.trim() || 'Untitled list';
          const { total, claimed } = progress(entry.list);
          return (
            <li key={entry.list.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onOpen(entry.list.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'min-h-12 min-w-0 flex-1 rounded-[12px] px-3 py-2 text-left transition-colors',
                  active
                    ? 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
                    : 'hover:bg-ink/5',
                )}
              >
                <span className="block truncate text-[14px] font-medium text-ink">{title}</span>
                <span className="block text-[12px] text-muted">
                  {entry.role === 'organizer' ? 'You’re organizing' : 'Shared with you'} · {claimed}{' '}
                  of {total} covered
                </span>
              </button>
              <IconButton
                icon="x"
                label={`Remove “${title}” from this device`}
                onClick={() => onForget(entry.list.id)}
                className="!size-11 lg:!size-10"
              />
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}
