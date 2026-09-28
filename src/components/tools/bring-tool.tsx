'use client';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { clearHash, decodeState, linkFor, newId, writeHash } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  addItems,
  applyTemplate,
  bringListSchema,
  bringStoreSchema,
  bringText,
  CATEGORIES,
  CATEGORY_NAMES,
  changeCurrent,
  editItem,
  EMPTY_STORE,
  groups,
  keep,
  MAX_ITEMS,
  moveItem,
  newList,
  parseLine,
  parseLines,
  progress,
  receive,
  removeItem,
  restoreItem,
  setDetails,
  TEMPLATES,
  type BringItem,
  type BringList,
  type BringStore,
  type Category,
  type Group,
  type NewItem,
  type Removal,
} from '@/lib/tools/bring';
import {
  claim,
  claimChanges,
  claimsVersion,
  heldBy,
  holder,
  renameClaims,
  unclaim,
  type Claim,
  type Claimer,
} from '@/lib/tools/claims';
import { CopyButton, IconButton, Label, Note, Surface } from './kit';
import { ShareLinkCard } from './share-link';

/*
 * Bring: who's bringing what. The organizer lists what's needed and shares one link; people
 * claim from their phones and send the updated link back. Every list this device has seen is
 * kept here, so opening anyone's link merges it with what's already known (lib/tools/claims).
 */

const TEMPLATE_ICONS: Record<string, IconName> = {
  cookout: 'sun',
  potluck: 'utensils',
  camping: 'moon',
  'game-night': 'dice',
};

const field =
  'h-11 rounded-[10px] bg-surface px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none transition-shadow placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:h-10 lg:text-[14.5px]';

type Details = Partial<Pick<BringList, 'title' | 'when' | 'where' | 'note'>>;
type Combined = { error: string; other?: string } | { done: string };

const nameOf = (item: Pick<BringItem, 'name'> | undefined) => item?.name.trim() || 'Something';

/** "Burgers", "Burgers and Ice", "Burgers, Ice and Napkins". */
function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What a link changed for this device, in words: new claims, new items, claims that didn't hold. */
function whatChanged(before: BringList | null, after: BringList, meId: string | null) {
  if (!before) return [];
  const news: string[] = [];
  const { lost, added } = claimChanges(before.claims, after.claims, meId);
  for (const { itemId, takenBy } of lost) {
    const name = nameOf(before.items.find((item) => item.id === itemId));
    const exists = after.items.some((item) => item.id === itemId);
    if (!exists) news.push(`${name} came off the list, so you’re not bringing it anymore.`);
    else if (takenBy) news.push(`${takenBy} claimed ${name} first, so it’s theirs.`);
    else news.push(`Your claim on ${name} was let go.`);
  }
  const known = new Set(before.items.map((item) => item.id));
  const fresh = after.items.filter((item) => !known.has(item.id)).length;
  const parts = [
    added ? `${added} new ${added === 1 ? 'claim' : 'claims'}` : '',
    fresh ? `${fresh} new ${fresh === 1 ? 'item' : 'items'}` : '',
  ].filter(Boolean);
  if (parts.length) news.push(`This link brought ${parts.join(' and ')}.`);
  return news;
}

const noop = () => () => {};
function useCanShare() {
  return useSyncExternalStore(
    noop,
    () => 'share' in navigator,
    () => false,
  );
}

export function BringTool() {
  const id = useId();
  const toast = useToast();
  const [store, setStore, { loaded }] = useLocalState<BringStore>(
    'hyphy.bring.v1',
    bringStoreSchema,
    EMPTY_STORE,
  );
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [news, setNews] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  /** Waiting for a name: the item to claim once there is one (null = just changing the name). */
  const [asking, setAsking] = useState<{ itemId: string | null } | null>(null);
  /** What this device claimed since the list opened: the bar asks to send the link back. */
  const [claimedNow, setClaimedNow] = useState<string[]>([]);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [link, setLink] = useState<{ version: string; url: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const latest = useRef(store);

  useEffect(() => {
    latest.current = store;
  }, [store]);

  const saved = store.lists.find((entry) => entry.list.id === store.current) ?? null;
  const list = saved?.list ?? null;
  const organizer = !saved || saved.role === 'organizer';
  const me = store.me;
  const version = list ? `${list.id}.${list.edited}.${claimsVersion(list.claims)}` : '';

  // A link carries a list: merge it into this device's copy when the page opens, and again when
  // the address changes by hand. (This page's own writeHash doesn't fire hashchange.)
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    const open = () => {
      const fragment = window.location.hash;
      const decoding =
        fragment.length > 1 ? decodeState(fragment, bringListSchema) : Promise.resolve(undefined);
      void decoding.then((incoming) => {
        if (!live) return;
        if (incoming === null)
          setProblem(
            'This link doesn’t hold a Bring list, or part of it got cut off. Ask for it again.',
          );
        if (incoming) {
          const current = latest.current;
          const result = receive(current, incoming, Date.now());
          latest.current = result.store;
          setStore(result.store);
          setNews(whatChanged(result.before, result.list, current.me?.id ?? null));
          setProblem(null);
          setEditing(false);
          setClaimedNow([]);
        }
        setReady(true);
      });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => {
      live = false;
      window.removeEventListener('hashchange', open);
    };
  }, [loaded, setStore]);

  // The address bar always carries the list as it is now, so it can be shared from anywhere.
  useEffect(() => {
    if (!ready || !list) return;
    const timer = setTimeout(() => {
      void writeHash(list);
      void linkFor(list).then((url) => setLink({ version, url }));
    }, 250);
    return () => clearTimeout(timer);
  }, [ready, list, version]);

  useEffect(() => {
    if (!removal) return;
    const timer = setTimeout(() => setRemoval(null), 12_000);
    return () => clearTimeout(timer);
  }, [removal]);

  /** An organizer's change. The first one makes the list. */
  const edit = (change: (list: BringList, now: number) => BringList) => {
    const now = Date.now();
    const fresh = newList(newId(), now);
    setStore((current) => {
      const entry = current.lists.find(
        (item) => item.list.id === current.current && item.role === 'organizer',
      );
      return keep(current, {
        role: 'organizer',
        opened: now,
        list: change(entry?.list ?? fresh, now),
      });
    });
  };
  const freshIds = (count: number) => Array.from({ length: count }, () => newId(6));

  const add = (entries: NewItem[]) => {
    if (!entries.length) return;
    const room = Math.max(0, MAX_ITEMS - (list?.items.length ?? 0));
    const ids = freshIds(Math.min(entries.length, room));
    edit((current, now) => addItems(current, entries, ids, now).list);
    const added = Math.min(entries.length, room);
    if (entries.length > room)
      toast({
        title: `${entries.length - room} didn’t fit: a list holds ${MAX_ITEMS} things.`,
        icon: 'alert',
      });
    else if (added > 1) toast({ title: `Added ${added} things` });
    setAnnounce(
      added === 1
        ? `Added ${entries[0].name}`
        : added
          ? `Added ${added} things`
          : 'The list is full',
    );
  };
  const pickTemplate = (templateId: string) => {
    const ids = freshIds(24);
    edit((current, now) => applyTemplate(current, templateId, ids, now).list);
  };
  const remove = (itemId: string) => {
    if (!list) return;
    setRemoval(removeItem(list, itemId, Date.now()).removal);
    edit((current, now) => removeItem(current, itemId, now).list);
  };
  const undoRemove = () => {
    if (!removal) return;
    const taken = removal;
    edit((current, now) => restoreItem(current, taken, now));
    setRemoval(null);
  };

  const changeClaims = (change: (list: BringList, now: number) => BringList) => {
    const now = Date.now();
    setStore((current) => changeCurrent(current, (item) => change(item, now)));
  };
  const take = (itemId: string, who: Claimer) => {
    changeClaims((current, now) => ({
      ...current,
      claims: claim(current.claims, itemId, who, now),
    }));
    setClaimedNow((ids) => [...ids.filter((id) => id !== itemId), itemId]);
  };
  const askOrTake = (itemId: string) => {
    if (me?.name.trim()) take(itemId, me);
    else setAsking({ itemId });
  };
  const release = (itemId: string) => {
    if (!me) return;
    changeClaims((current, now) => ({
      ...current,
      claims: unclaim(current.claims, itemId, me.id, now),
    }));
    setClaimedNow((ids) => ids.filter((id) => id !== itemId));
  };
  const saveName = (name: string) => {
    const now = Date.now();
    const who: Claimer = { id: me?.id ?? newId(8), name: name.trim().slice(0, 40) };
    setStore((current) => ({
      ...current,
      me: who,
      // A fixed typo shows on everything already claimed, too.
      lists: current.lists.map((entry) =>
        heldBy(entry.list.claims, who.id).length
          ? {
              ...entry,
              list: {
                ...entry.list,
                claims: renameClaims(entry.list.claims, who.id, who.name, now),
              },
            }
          : entry,
      ),
    }));
    if (asking?.itemId) take(asking.itemId, who);
    setAsking(null);
  };

  const combine = async (text: string): Promise<Combined> => {
    const at = text.indexOf('#');
    if (at < 0) return { error: 'Paste the whole link: the list is the part after the #.' };
    const incoming = await decodeState(text.slice(at), bringListSchema);
    if (!incoming) return { error: 'That isn’t a Bring link, or part of it got cut off.' };
    if (!list || incoming.id !== list.id) {
      const title = incoming.title.trim();
      return {
        error: `That link is for a different list${title ? `, “${title}”` : ''}.`,
        other: text.slice(at),
      };
    }
    const current = latest.current;
    const result = receive(current, incoming, Date.now());
    latest.current = result.store;
    setStore(result.store);
    const changes = whatChanged(result.before, result.list, current.me?.id ?? null);
    setNews(changes);
    return { done: changes.length ? 'Combined.' : 'Combined. That link had nothing new.' };
  };

  const resetView = () => {
    setEditing(false);
    setClaimedNow([]);
    setRemoval(null);
    setNews([]);
    setProblem(null);
  };
  const startNew = () => {
    setStore((current) => ({ ...current, current: null }));
    clearHash();
    resetView();
  };
  const openSaved = (listId: string) => {
    setStore((current) => ({ ...current, current: listId }));
    resetView();
  };
  const forget = (listId: string) => {
    const entry = store.lists.find((item) => item.list.id === listId);
    const title = entry?.list.title.trim() || 'this list';
    if (!window.confirm(`Remove “${title}” from this device? Everyone else keeps their copy.`))
      return;
    setStore((current) => ({
      ...current,
      current: current.current === listId ? null : current.current,
      lists: current.lists.filter((item) => item.list.id !== listId),
    }));
    if (listId === store.current) {
      clearHash();
      resetView();
    }
  };
  const adopt = () => {
    if (!list) return;
    const ok = window.confirm(
      'Edit this list on this device? Do this if you’re organizing it. Your changes travel in the link, like everything else.',
    );
    if (!ok) return;
    setStore((current) => ({
      ...current,
      lists: current.lists.map((entry) =>
        entry.list.id === list.id ? { ...entry, role: 'organizer' } : entry,
      ),
    }));
  };

  if (!ready) {
    return (
      <div aria-busy="true" className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)]">
        <div className="skeleton h-[420px] !rounded-[22px]" />
        <div className="skeleton hidden h-[320px] !rounded-[22px] lg:block" />
      </div>
    );
  }

  const count = list?.items.length ?? 0;
  const { total, claimed, needed } = list ? progress(list) : { total: 0, claimed: 0, needed: 0 };
  const mine = list && me ? heldBy(list.claims, me.id) : [];
  const mineNames = mine.map((itemId) => nameOf(list?.items.find((item) => item.id === itemId)));
  const sending = list && me ? claimedNow.filter((itemId) => mine.includes(itemId)) : [];
  const upToDate = link && link.version === version ? link.url : null;
  const askingItem = asking?.itemId
    ? list?.items.find((item) => item.id === asking.itemId)
    : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)] lg:items-start">
      <div className="grid min-w-0 gap-5">
        {problem && (
          <Note tone="caution" icon="alert">
            {problem}
          </Note>
        )}
        {news.length > 0 && (
          <div
            role="status"
            className="flex animate-rise items-start gap-2.5 rounded-[14px] bg-subtle py-2 pr-2 pl-3.5 text-[13.5px] leading-relaxed text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            <Icon name="refresh" size={15} className="mt-[5px] shrink-0 text-muted" />
            <div className="grid min-w-0 flex-1 gap-0.5 py-1">
              {news.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <IconButton icon="x" size="sm" label="Dismiss" onClick={() => setNews([])} />
          </div>
        )}

        {organizer ? (
          <DetailsEditor
            list={list}
            onChange={(details) => edit((current, now) => setDetails(current, details, now))}
          />
        ) : (
          list && <DetailsCard list={list} />
        )}

        <Surface className="grid gap-4">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <Label id={`${id}-items`}>What’s needed{count ? ` · ${count}` : ''}</Label>
            {organizer && count > 0 && (
              <button
                type="button"
                aria-pressed={editing}
                onClick={() => setEditing((value) => !value)}
                className={cn(
                  'inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium transition-colors',
                  editing
                    ? 'bg-ink text-on-ink'
                    : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
                )}
              >
                <Icon name={editing ? 'check' : 'pencil'} size={14} />
                {editing ? 'Done' : 'Edit list'}
              </button>
            )}
          </div>

          {organizer && count === 0 && <Templates onPick={pickTemplate} />}

          {list &&
            count > 0 &&
            (editing ? (
              <EditList
                list={list}
                onEdit={(itemId, change) =>
                  edit((current, now) => editItem(current, itemId, change, now))
                }
                onMove={(itemId, delta) =>
                  edit((current, now) => moveItem(current, itemId, delta, now))
                }
                onRemove={remove}
              />
            ) : (
              <ClaimList
                list={list}
                meId={me?.id ?? null}
                labelledBy={`${id}-items`}
                onClaim={askOrTake}
                onRelease={release}
              />
            ))}

          {!organizer && count === 0 && (
            <p className="text-[14px] text-muted">Nothing on this list yet.</p>
          )}

          {removal && (
            <div
              role="status"
              className="flex items-center gap-3 rounded-[12px] bg-subtle py-1.5 pr-1.5 pl-3.5 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              <span className="min-w-0 flex-1 truncate">Removed “{nameOf(removal.item)}”.</span>
              <button
                type="button"
                onClick={undoRemove}
                className="h-10 rounded-[10px] px-3 font-semibold text-ink hover:bg-ink/5"
              >
                Undo
              </button>
            </div>
          )}

          {organizer && <AddItems count={count} onAdd={add} />}
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
        </Surface>
      </div>

      <aside aria-label="Progress and sharing" className="grid gap-4 lg:sticky lg:top-24">
        {count > 0 && (
          <Surface className="grid gap-4 !p-5 sm:!p-6">
            <div className="flex items-end justify-between gap-3">
              <div aria-live="polite" aria-atomic="true">
                <p className="label">Claimed</p>
                <p
                  className="mt-1 font-display text-[44px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                  style={{ fontVariationSettings: "'wdth' 110" }}
                >
                  {claimed}
                  <span className="text-faint"> of {total}</span>
                </p>
              </div>
              <p className="pb-1 text-right text-[13.5px] leading-snug text-muted">
                {!total
                  ? 'Nothing on the list yet'
                  : needed
                    ? `${needed} still needed`
                    : 'Everything’s covered'}
              </p>
            </div>
            <Progress
              value={total ? (claimed / total) * 100 : 0}
              color="var(--accent, var(--color-ink))"
              label="Claimed so far"
            />
            {mineNames.length > 0 && (
              <p className="text-[14px] leading-snug text-ink-2">
                You’re bringing {joinNames(mineNames)}.
              </p>
            )}
            {me?.name.trim() && (
              <p className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
                <span className="min-w-0 truncate">
                  Claiming as <span className="font-medium text-ink-2">{me.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAsking({ itemId: null })}
                  className="h-9 shrink-0 font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
                >
                  Change name
                </button>
              </p>
            )}
          </Surface>
        )}

        {list && count > 0 ? (
          <Surface className="grid gap-4">
            <div>
              <h2 className="text-[16px] font-semibold text-ink">
                {organizer ? 'Share the list' : 'Send the updated link back'}
              </h2>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                {organizer
                  ? 'Everyone gets the whole list inside one link. When they claim something, they send the updated link back; open it here and their claims join yours.'
                  : 'The list lives in the link, so after you claim something, send the updated link to the group. Whoever opens it next sees what you’re bringing.'}
              </p>
            </div>
            <ShareLinkCard
              key={version}
              title={list.title.trim() || 'What to bring'}
              cta={organizer ? 'Get the link' : 'Get the updated link'}
              build={() => linkFor(list)}
            />
            <CopyButton
              text={bringText(list, upToDate ?? undefined)}
              label="Copy as text for the group chat"
              what="Copied — paste it in the group chat"
              className="!h-11 w-full lg:!h-10"
            />
          </Surface>
        ) : (
          organizer && (
            <Note icon="link">
              Add what’s needed, then share one link with everyone who’s coming. Nothing is sent
              anywhere until you share it.
            </Note>
          )
        )}

        {list && count > 0 && <Combine onCombine={combine} />}

        {store.lists.length > 1 ? (
          <DeviceLists store={store} onOpen={openSaved} onForget={forget} onStartNew={startNew} />
        ) : (
          list && (
            <button
              type="button"
              onClick={startNew}
              className="justify-self-start px-1 text-[13.5px] text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Start a new list
            </button>
          )
        )}

        {!organizer && list && (
          <button
            type="button"
            onClick={adopt}
            className="justify-self-start px-1 text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Organizing this on a new device? Edit the list here
          </button>
        )}
      </aside>

      {list && sending.length > 0 && (
        <SendBack
          names={sending.map((itemId) => nameOf(list.items.find((item) => item.id === itemId)))}
          link={upToDate}
          title={list.title.trim() || 'What to bring'}
          onDone={() => setClaimedNow([])}
        />
      )}

      <NameSheet
        key={asking ? `ask-${asking.itemId ?? 'name'}` : 'closed'}
        open={Boolean(asking)}
        itemName={askingItem ? nameOf(askingItem) : null}
        initial={me?.name ?? ''}
        onSave={saveName}
        onClose={() => setAsking(null)}
      />
    </div>
  );
}

/* ---------------- the event ---------------- */

function DetailsEditor({
  list,
  onChange,
}: {
  list: BringList | null;
  onChange: (details: Details) => void;
}) {
  const id = useId();
  const [noting, setNoting] = useState(Boolean(list?.note));
  return (
    <Surface className="grid gap-3">
      <input
        aria-label="What’s the occasion?"
        placeholder="What’s the occasion?"
        value={list?.title ?? ''}
        maxLength={80}
        onChange={(event) => onChange({ title: event.target.value })}
        className="h-12 min-w-0 rounded-[12px] bg-transparent px-1 text-[20px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint focus:bg-subtle focus:px-3"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <IconInput
          icon="calendar"
          label="When (optional)"
          value={list?.when ?? ''}
          maxLength={80}
          placeholder="When? Saturday, 2pm"
          onChange={(event) => onChange({ when: event.target.value })}
        />
        <IconInput
          icon="map-pin"
          label="Where (optional)"
          value={list?.where ?? ''}
          maxLength={120}
          placeholder="Where? Lakeside Park"
          onChange={(event) => onChange({ where: event.target.value })}
        />
      </div>
      {noting ? (
        <Field label="A note for everyone" htmlFor={`${id}-note`} optional>
          <Textarea
            id={`${id}-note`}
            rows={2}
            value={list?.note ?? ''}
            maxLength={400}
            placeholder="Bring a chair if you have one."
            autoFocus={!list?.note}
            onChange={(event) => onChange({ note: event.target.value })}
            className="!min-h-[76px]"
          />
        </Field>
      ) : (
        <button
          type="button"
          onClick={() => setNoting(true)}
          className="inline-flex h-11 items-center gap-2 justify-self-start rounded-[10px] px-2 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink lg:h-9"
        >
          <Icon name="plus" size={15} /> Add a note for everyone
        </button>
      )}
    </Surface>
  );
}

function IconInput({
  icon,
  label,
  ...props
}: { icon: IconName; label: string } & ComponentProps<'input'>) {
  return (
    <div className="relative min-w-0">
      <Icon
        name={icon}
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
      />
      <input aria-label={label} {...props} className={cn(field, 'w-full pl-9')} />
    </div>
  );
}

function DetailsCard({ list }: { list: BringList }) {
  const when = list.when.trim();
  const where = list.where.trim();
  const note = list.note.trim();
  return (
    <Surface className="grid gap-3">
      <p className="label">A list shared with you</p>
      <h2
        className="font-display text-[30px] leading-[1.02] font-extrabold tracking-[-0.03em] text-ink sm:text-[36px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {list.title.trim() || 'What to bring'}
      </h2>
      {(when || where) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14.5px] text-ink-2">
          {when && (
            <span className="inline-flex items-center gap-2">
              <Icon name="calendar" size={15} className="text-muted" />
              {when}
            </span>
          )}
          {where && (
            <span className="inline-flex items-center gap-2">
              <Icon name="map-pin" size={15} className="text-muted" />
              {where}
            </span>
          )}
        </div>
      )}
      {note && (
        <p className="text-[14.5px] leading-relaxed whitespace-pre-line text-muted">{note}</p>
      )}
    </Surface>
  );
}

/* ---------------- the list ---------------- */

function Templates({ onPick }: { onPick: (templateId: string) => void }) {
  return (
    <div className="grid gap-3 rounded-[16px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div>
        <p className="text-[14.5px] font-medium text-ink">Start from a list</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
          The usual things for the occasion, to change, add to or trim. Or type your own below.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onPick(template.id)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-10"
          >
            <Icon name={TEMPLATE_ICONS[template.id] ?? 'list'} size={15} />
            {template.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClaimList({
  list,
  meId,
  labelledBy,
  onClaim,
  onRelease,
}: {
  list: BringList;
  meId: string | null;
  labelledBy: string;
  onClaim: (itemId: string) => void;
  onRelease: (itemId: string) => void;
}) {
  const { needed, covered } = groups(list);
  const byCategory = new Set(list.items.map((item) => item.cat)).size > 1;
  const sections = [
    { key: 'needed', title: 'Still needed', groups: needed },
    { key: 'covered', title: 'Claimed', groups: covered },
  ].filter((section) => section.groups.length > 0);
  return (
    <div className="grid gap-6" aria-labelledby={labelledBy} role="group">
      {sections.map((section) => (
        <ItemSection
          key={section.key}
          title={section.title}
          groups={section.groups}
          byCategory={byCategory}
          render={(item) => {
            const record = holder(list.claims[item.id]);
            return (
              <ClaimRow
                key={item.id}
                item={item}
                record={record}
                mine={Boolean(record && meId && record.by === meId)}
                onClaim={() => onClaim(item.id)}
                onRelease={() => onRelease(item.id)}
              />
            );
          }}
        />
      ))}
    </div>
  );
}

function ItemSection({
  title,
  groups: sectionGroups,
  byCategory,
  render,
}: {
  title: string;
  groups: Group[];
  byCategory: boolean;
  render: (item: BringItem) => ReactNode;
}) {
  const id = useId();
  const count = sectionGroups.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <section aria-labelledby={id} className="grid gap-2.5">
      <h3 id={id} className="flex items-baseline gap-2 text-[14.5px] font-semibold text-ink">
        {title}
        <span className="mono-num text-[12.5px] font-normal text-muted">{count}</span>
      </h3>
      {sectionGroups.map((group) => (
        <div key={group.cat} className="grid gap-1.5">
          {byCategory && <p className="label mt-1 !text-[10.5px]">{CATEGORY_NAMES[group.cat]}</p>}
          <ul className="grid gap-1.5">{group.items.map(render)}</ul>
        </div>
      ))}
    </section>
  );
}

function ClaimRow({
  item,
  record,
  mine,
  onClaim,
  onRelease,
}: {
  item: BringItem;
  record: Claim | null;
  mine: boolean;
  onClaim: () => void;
  onRelease: () => void;
}) {
  const name = nameOf(item);
  const qty = item.qty.trim();
  return (
    <li
      className={cn(
        'flex min-h-[58px] items-center gap-3 rounded-[14px] bg-subtle py-1.5 pr-1.5 pl-3',
        mine
          ? 'shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-ink))]'
          : 'shadow-[inset_0_0_0_1px_var(--color-line)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full',
          record
            ? 'bg-positive-soft text-positive'
            : 'shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
        )}
      >
        {record && <Icon name="check" size={13} />}
      </span>
      <div className="min-w-0 flex-1 py-1">
        <p className="text-[15px] leading-snug font-medium break-words text-ink">
          {name}
          {qty && <span className="font-normal text-muted"> · {qty}</span>}
        </p>
        {record && (
          <p className="text-[13px] leading-snug text-muted">
            {mine ? (
              'You’re bringing this'
            ) : (
              <>
                <span className="font-medium text-ink-2">{record.name.trim() || 'Someone'}</span> is
                bringing it
              </>
            )}
          </p>
        )}
      </div>
      {!record ? (
        <button
          type="button"
          onClick={onClaim}
          aria-label={`I’ll bring ${name}`}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[11px] bg-well px-3.5 text-[14px] font-semibold text-ink transition-colors hover:bg-ink hover:text-on-ink lg:h-10"
        >
          <Icon name="hand" size={15} />
          I’ll bring it
        </button>
      ) : mine ? (
        <button
          type="button"
          onClick={onRelease}
          aria-label={`Unclaim ${name}`}
          className="h-11 shrink-0 rounded-[11px] px-3 text-[13.5px] font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink lg:h-10"
        >
          Unclaim
        </button>
      ) : null}
    </li>
  );
}

function EditList({
  list,
  onEdit,
  onMove,
  onRemove,
}: {
  list: BringList;
  onEdit: (itemId: string, change: { name?: string; qty?: string; cat?: Category }) => void;
  onMove: (itemId: string, delta: -1 | 1) => void;
  onRemove: (itemId: string) => void;
}) {
  return (
    <ul className="grid gap-2">
      {list.items.map((item, index) => {
        const record = holder(list.claims[item.id]);
        const name = item.name.trim() || `item ${index + 1}`;
        return (
          <li
            key={item.id}
            className="grid gap-2 rounded-[14px] bg-subtle p-2 shadow-[inset_0_0_0_1px_var(--color-line)] sm:flex sm:flex-wrap sm:items-center"
          >
            <div className="flex min-w-0 items-center gap-2 sm:contents">
              <input
                aria-label={`Item ${index + 1}`}
                value={item.name}
                maxLength={80}
                placeholder="What’s needed"
                onChange={(event) => onEdit(item.id, { name: event.target.value })}
                className={cn(field, 'w-0 min-w-0 flex-1')}
              />
              <IconButton
                icon="trash"
                tone="danger"
                label={`Remove ${name}`}
                onClick={() => onRemove(item.id)}
                className="!size-11 sm:order-last lg:!size-10"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2 sm:contents">
              <input
                aria-label={`How much ${name}`}
                value={item.qty}
                maxLength={30}
                placeholder="Amount"
                onChange={(event) => onEdit(item.id, { qty: event.target.value })}
                className={cn(field, 'w-0 min-w-0 flex-1 sm:w-[108px] sm:flex-none')}
              />
              <select
                aria-label={`Category of ${name}`}
                value={item.cat}
                onChange={(event) => onEdit(item.id, { cat: event.target.value as Category })}
                className={cn(field, 'w-[104px] shrink-0 px-2.5 sm:w-[112px]')}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_NAMES[category]}
                  </option>
                ))}
              </select>
              <IconButton
                icon="arrow-up"
                label={`Move ${name} up`}
                disabled={index === 0}
                onClick={() => onMove(item.id, -1)}
                className="!size-11 lg:!size-10"
              />
              <IconButton
                icon="arrow-down"
                label={`Move ${name} down`}
                disabled={index === list.items.length - 1}
                onClick={() => onMove(item.id, 1)}
                className="!size-11 lg:!size-10"
              />
            </div>
            {record && (
              <p className="px-1 text-[12.5px] text-muted sm:order-last sm:basis-full">
                Claimed by {record.name.trim() || 'someone'}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AddItems({ count, onAdd }: { count: number; onAdd: (entries: NewItem[]) => void }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);

  if (count >= MAX_ITEMS)
    return (
      <Note icon="alert">
        That’s {MAX_ITEMS} things, as many as one list holds. Remove something to add more.
      </Note>
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const entry = qty.trim() ? { name: name.trim(), qty: qty.trim() } : parseLine(name);
    if (!entry?.name) return;
    onAdd([entry]);
    setName('');
    setQty('');
    nameInput.current?.focus();
  };
  // Several lines pasted at once: every line becomes an item.
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/\n/.test(text.trim())) return;
    event.preventDefault();
    onAdd(parseLines(text));
  };

  return (
    <form onSubmit={submit} className="grid gap-2 border-t border-line pt-4">
      <div className="flex flex-wrap gap-2">
        <input
          ref={nameInput}
          aria-label="Add something to the list"
          placeholder={count ? 'Add something else' : 'Add the first thing — Ice'}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onPaste={paste}
          className={cn(field, 'min-w-0 flex-1 basis-[220px]')}
        />
        <div className="flex min-w-0 flex-1 basis-[200px] gap-2 sm:flex-none sm:basis-auto">
          <input
            aria-label="How much (optional)"
            placeholder="How much"
            value={qty}
            maxLength={30}
            onChange={(event) => setQty(event.target.value)}
            className={cn(field, 'w-0 min-w-0 flex-1 sm:w-[112px] sm:flex-none')}
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[11px] bg-ink px-4 text-[14.5px] font-semibold text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40 lg:h-10"
          >
            <Icon name="plus" size={16} />
            Add
          </button>
        </div>
      </div>
      <p className="text-[12.5px] text-muted">
        Enter adds it. Paste a list and every line becomes its own item.
      </p>
    </form>
  );
}

/* ---------------- after claiming, and sharing ---------------- */

/**
 * After claiming: the list only travels if the link does, so ask for it to be sent back. It
 * floats at the bottom of the screen, because the claimed item just moved out of view.
 */
function SendBack({
  names,
  link,
  title,
  onDone,
}: {
  names: string[];
  link: string | null;
  title: string;
  onDone: () => void;
}) {
  const canShare = useCanShare();
  // Copied here rather than with a toast: on a phone the toast would land on top of this bar.
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  const quiet =
    'inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-well px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-50 lg:h-10';
  const solid =
    'inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-ink px-4 text-[14px] font-semibold text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-50 lg:h-10';
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 animate-rise rounded-[20px] bg-surface p-4 shadow-pop lg:inset-x-0 lg:bottom-6 lg:mx-auto lg:w-[min(560px,calc(100%-48px))]"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-positive-soft text-positive">
          <Icon name="check" size={16} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[15px] leading-snug font-semibold text-ink">
            You’re bringing {joinNames(names)}.
          </p>
          <p className="mt-0.5 text-[13.5px] leading-snug text-muted">
            The list lives in the link. Send the updated link back to the group so everyone sees it.
          </p>
        </div>
        <IconButton icon="x" label="Close" onClick={onDone} className="-mt-1 -mr-1" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 sm:pl-11">
        {canShare && (
          <button
            type="button"
            disabled={!link}
            onClick={() => link && void navigator.share({ title, url: link }).catch(() => {})}
            className={solid}
          >
            <Icon name="share" size={15} /> Share the link
          </button>
        )}
        <button type="button" disabled={!link} onClick={copy} className={canShare ? quiet : solid}>
          <Icon name={link && copied === link ? 'check' : 'copy'} size={15} />
          {!link
            ? 'Updating the link…'
            : copied === link
              ? 'Copied'
              : canShare
                ? 'Copy'
                : 'Copy the updated link'}
        </button>
      </div>
      {failed && (
        <p className="mt-2 text-[12.5px] text-critical sm:pl-11">
          This browser wouldn’t copy. Use “Get the updated link” beside the list instead.
        </p>
      )}
    </div>
  );
}

function Combine({ onCombine }: { onCombine: (text: string) => Promise<Combined> }) {
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
    <Surface className="!p-0">
      <details className="group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-[22px] px-5 text-[14.5px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2.5">
            <Icon name="link-2" size={16} className="text-muted" />
            Got a link back? Combine it
          </span>
          <Icon
            name="chevron-down"
            size={16}
            className="text-muted transition-transform group-open:rotate-180"
          />
        </summary>
        <form onSubmit={submit} className="grid gap-3 px-5 pb-5">
          <p className="text-[13px] leading-relaxed text-muted">
            Opening a link on this device already combines it with the copy here. You can also paste
            one to fold its claims in without leaving the page.
          </p>
          <div className="flex gap-2">
            <label htmlFor={`${id}-link`} className="sr-only">
              A Bring link to combine
            </label>
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
              className={cn(field, 'w-0 min-w-0 flex-1')}
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="inline-flex h-11 shrink-0 items-center rounded-[11px] bg-ink px-4 text-[14.5px] font-semibold text-on-ink disabled:opacity-40 lg:h-10"
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
      </details>
    </Surface>
  );
}

function DeviceLists({
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
    <Surface className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <Label>On this device</Label>
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
                  of {total} claimed
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
      <p className="text-[12.5px] leading-relaxed text-muted">
        Kept in this browser only. Removing a list here doesn’t touch anyone else’s copy.
      </p>
    </Surface>
  );
}

function NameSheet({
  open,
  itemName,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  itemName: string | null;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="sm"
      title={itemName ? `Who’s bringing ${itemName}?` : 'Your name on the list'}
      description="It shows next to what you claim, so everyone knows who’s got it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`} disabled={!name.trim()}>
            {itemName ? 'Claim it' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name);
        }}
        className="grid gap-3 pt-1"
      >
        <Field
          label="Your name"
          htmlFor={`${id}-name`}
          hint="Saved in this browser, so you’re only asked once."
        >
          <Input
            id={`${id}-name`}
            data-autofocus
            value={name}
            maxLength={40}
            autoComplete="given-name"
            placeholder="Dana"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}
