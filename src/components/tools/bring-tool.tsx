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
import {
  ActionBar,
  ActionButton,
  CopyButton,
  IconButton,
  Label,
  MoreOptions,
  Note,
  StartPanel,
  Surface,
  useCopy,
} from './kit';
import { LinkQr } from './share-link';

/*
 * Bring: who's bringing what. The organizer lists what's needed and shares one link; people
 * claim from their phones and send the updated link back. Every list this device has seen is
 * kept here, so opening anyone's link merges it with what's already known (lib/tools/claims).
 */

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
  /** Chose "Something else": straight to an empty list instead of the occasion cards. */
  const [blank, setBlank] = useState(false);
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
    setBlank(true);
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
  const setQty = (itemId: string, qty: string) =>
    edit((current, now) => editItem(current, itemId, { qty }, now));
  const startNew = () => {
    setStore((current) => ({ ...current, current: null }));
    clearHash();
    resetView();
    setBlank(false);
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
      'Edit this list? Do this if you’re the one organizing it. Your changes go out with the link.',
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
  const title = list?.title.trim() || 'What to bring';

  const notices = (
    <>
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
    </>
  );

  // Step one for an organizer: pick the occasion, and the list starts itself.
  if (organizer && count === 0 && !blank && !removal) {
    return (
      <div className="grid gap-5">
        {notices}
        <OccasionStart onPick={pickTemplate} onBlank={() => setBlank(true)} />
        {store.lists.length > 0 && (
          <div className="mx-auto w-full max-w-[640px]">
            <DeviceLists store={store} onOpen={openSaved} onForget={forget} onStartNew={startNew} />
          </div>
        )}
      </div>
    );
  }

  const shareButton = (
    <ActionBar className="lg:hidden">
      <ActionButton
        icon="share"
        onClick={() => {
          const card = document.getElementById(`${id}-invite`);
          card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      >
        Share with everyone
      </ActionButton>
    </ActionBar>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)] lg:items-start">
      <div className="grid min-w-0 gap-5">
        {notices}

        {organizer ? (
          <DetailsEditor
            list={list}
            onChange={(details) => edit((current, now) => setDetails(current, details, now))}
          />
        ) : (
          list && <Invitation list={list} needed={needed} total={total} />
        )}

        <Surface className="grid gap-4">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <h2 id={`${id}-items`} className="text-[17px] font-semibold text-ink">
              {organizer ? 'What’s needed' : 'Tap what you’ll bring'}
              {organizer && count > 0 && (
                <span className="mono-num ml-2 text-[13px] font-normal text-muted">{count}</span>
              )}
            </h2>
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

          {organizer && count === 0 && !editing && (
            <p className="-mt-2 text-[14px] leading-relaxed text-muted">
              Type the first thing, or tap an idea below.
            </p>
          )}

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
                organizer={organizer}
                labelledBy={`${id}-items`}
                onClaim={askOrTake}
                onRelease={release}
                onQty={setQty}
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

          {organizer && !editing && (
            <AddItems
              count={count}
              names={list?.items.map((item) => item.name) ?? []}
              onAdd={add}
            />
          )}
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
          {organizer && count > 0 && !editing && shareButton}
        </Surface>
      </div>

      <aside aria-label="Progress and sharing" className="grid gap-4 lg:sticky lg:top-24">
        {list && count > 0 && organizer && (
          <InviteCard
            id={`${id}-invite`}
            list={list}
            link={upToDate}
            claimed={claimed}
            total={total}
            needed={needed}
          />
        )}

        {list && count > 0 && !organizer && (
          <Surface className="grid gap-4 !p-5 sm:!p-6">
            <Tally claimed={claimed} total={total} needed={needed} />
            {mineNames.length > 0 && (
              <p className="text-[14px] leading-snug text-ink-2">
                You’re bringing {joinNames(mineNames)}.
              </p>
            )}
            {mine.length > 0 && (
              <div className="grid gap-2 border-t border-line pt-4">
                <p className="text-[15px] font-semibold text-ink">Now send it back</p>
                <p className="text-[13.5px] leading-relaxed text-muted">
                  Send the updated link back to the group, so everyone sees what you’re bringing.
                </p>
                <LinkButtons link={upToDate} title={title} className="mt-1" />
              </div>
            )}
          </Surface>
        )}

        {me?.name.trim() && list && count > 0 && (
          <p className="flex items-center justify-between gap-3 px-1 text-[13px] text-muted">
            <span className="min-w-0 truncate">
              Claiming as <span className="font-medium text-ink-2">{me.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setAsking({ itemId: null })}
              className="h-10 shrink-0 font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
            >
              Change name
            </button>
          </p>
        )}

        {list && count > 0 && <Combine onCombine={combine} />}

        {store.lists.length > 1 ? (
          <DeviceLists store={store} onOpen={openSaved} onForget={forget} onStartNew={startNew} />
        ) : (
          list && (
            <button
              type="button"
              onClick={startNew}
              className="h-10 justify-self-start px-1 text-[13.5px] text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Start a new list
            </button>
          )
        )}

        {!organizer && list && (
          <button
            type="button"
            onClick={adopt}
            className="h-10 justify-self-start px-1 text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Are you organizing this? Edit the list
          </button>
        )}
      </aside>

      {list && !organizer && sending.length > 0 && (
        <SendBack
          names={sending.map((itemId) => nameOf(list.items.find((item) => item.id === itemId)))}
          link={upToDate}
          title={title}
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

/* ---------------- look and feel ---------------- */

/** Each kind of thing has a color and a picture, so a long list reads at a glance. */
const CATEGORY_LOOK: Record<Category, { icon: IconName; color: string }> = {
  food: { icon: 'utensils', color: '#ffb35c' },
  drinks: { icon: 'snowflake', color: '#7fd4ff' },
  supplies: { icon: 'basket', color: 'var(--accent, #8ee0a0)' },
  other: { icon: 'party', color: '#c9a7ff' },
};

const tint = (color: string, amount: number) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

function CategoryTile({ cat, size = 40 }: { cat: Category; size?: number }) {
  const look = CATEGORY_LOOK[cat];
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[12px]"
      style={{ width: size, height: size, background: tint(look.color, 15), color: look.color }}
    >
      <Icon name={look.icon} size={Math.round(size * 0.45)} />
    </span>
  );
}

/** A strip of picnic cloth, in the tool's colors. */
function Gingham({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none', className)}
      style={{
        background: `repeating-linear-gradient(90deg, ${tint('var(--accent, #8ee0a0)', 55)} 0 10px, transparent 10px 20px), repeating-linear-gradient(0deg, ${tint('var(--accent, #8ee0a0)', 35)} 0 10px, transparent 10px 20px)`,
      }}
    />
  );
}

/* ---------------- step one: the occasion ---------------- */

const OCCASIONS: { id: string; icon: IconName; color: string; line?: string }[] = [
  { id: 'cookout', icon: 'sun', color: '#ffb35c' },
  { id: 'potluck', icon: 'utensils', color: '#ffd166' },
  { id: 'camping', icon: 'moon', color: '#8ee0a0' },
  { id: 'game-night', icon: 'dice', color: '#c9a7ff' },
];

function OccasionStart({ onPick, onBlank }: { onPick: (id: string) => void; onBlank: () => void }) {
  return (
    <StartPanel
      art={<ListPreview />}
      title="What are you planning?"
      lead="Tap one and the list starts with the usual things. You can change all of it."
      className="mx-auto w-full max-w-[760px]"
    >
      <div
        role="group"
        aria-label="Pick the occasion"
        className="grid grid-cols-2 gap-2.5 text-left sm:grid-cols-4"
      >
        {OCCASIONS.map((occasion) => {
          const template = TEMPLATES.find((entry) => entry.id === occasion.id);
          if (!template) return null;
          const peek = template.items
            .slice(0, 3)
            .map(([name]) => name)
            .join(', ');
          return (
            <button
              key={occasion.id}
              type="button"
              onClick={() => onPick(occasion.id)}
              className="group relative flex min-h-[132px] min-w-0 flex-col items-start gap-2 overflow-hidden rounded-[20px] bg-well p-3.5 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-[transform,background-color] hover:bg-ink/[.09] active:scale-[.98]"
            >
              <span
                aria-hidden="true"
                className="absolute -top-8 -right-8 size-24 rounded-full"
                style={{ background: tint(occasion.color, 14) }}
              />
              <span
                aria-hidden="true"
                className="relative grid size-11 place-items-center rounded-[14px] text-[#12110d] transition-transform group-hover:-rotate-6"
                style={{ background: occasion.color }}
              >
                <Icon name={occasion.icon} size={21} />
              </span>
              <span className="relative mt-auto text-[16px] leading-tight font-semibold text-ink">
                {template.name}
              </span>
              <span className="relative line-clamp-2 text-[12.5px] leading-snug text-muted">
                {peek}…
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onBlank}
          className="col-span-2 flex min-h-14 sm:col-span-4 items-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-line-strong px-3.5 text-left transition-colors hover:bg-ink/5"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-well text-ink-2">
            <Icon name="plus" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">Something else</span>
            <span className="block text-[12.5px] text-muted">Start with an empty list</span>
          </span>
          <Icon name="chevron-right" size={17} className="text-muted" />
        </button>
      </div>
    </StartPanel>
  );
}

/** A picture of the result: a little list, half claimed. */
function ListPreview() {
  const rows: [string, Category, string | null][] = [
    ['Burgers', 'food', 'Dana'],
    ['Ice', 'drinks', null],
    ['Lawn games', 'other', 'Sam'],
  ];
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-[248px] -rotate-2 overflow-hidden rounded-[18px] bg-subtle p-2.5 pt-5 text-left shadow-[0_18px_40px_-24px_rgb(0_0_0/.7),inset_0_0_0_1px_var(--color-line)]"
    >
      <Gingham className="absolute inset-x-0 top-0 h-2.5" />
      <div className="grid gap-1.5">
        {rows.map(([name, cat, who]) => (
          <div
            key={name}
            className="flex items-center gap-2 rounded-[11px] bg-surface py-1.5 pr-2 pl-1.5"
          >
            <CategoryTile cat={cat} size={26} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
            {who ? (
              <span className="text-[11.5px] text-muted">{who}</span>
            ) : (
              <span
                className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-[#12110d]"
                style={{ background: 'var(--glow, #ffd166)' }}
              >
                needed
              </span>
            )}
            <span
              className={cn(
                'grid size-4.5 place-items-center rounded-full',
                who ? 'text-[#12110d]' : 'shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
              )}
              style={who ? { background: 'var(--accent, #8ee0a0)' } : undefined}
            >
              {who && <Icon name="check" size={10} strokeWidth={3} />}
            </span>
          </div>
        ))}
      </div>
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
  const when = list?.when.trim() ?? '';
  const where = list?.where.trim() ?? '';
  const note = list?.note.trim() ?? '';
  const summary = [when, where, note ? 'a note' : ''].filter(Boolean).join(' · ');
  return (
    <Surface className="relative grid gap-2 overflow-hidden !pt-6">
      <Gingham className="absolute inset-x-0 top-0 h-2.5 opacity-80" />
      <label htmlFor={`${id}-title`} className="label">
        Your get-together
      </label>
      <div className="relative">
        <input
          id={`${id}-title`}
          placeholder="Give it a name"
          value={list?.title ?? ''}
          maxLength={80}
          enterKeyHint="done"
          autoComplete="off"
          onChange={(event) => onChange({ title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="h-12 w-full min-w-0 rounded-[12px] bg-transparent pr-9 font-display text-[26px] font-bold tracking-[-0.02em] text-ink outline-none placeholder:font-sans placeholder:text-[20px] placeholder:font-normal placeholder:tracking-normal placeholder:text-faint focus:bg-subtle focus:px-3"
        />
        <Icon
          name="pencil"
          size={15}
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-faint"
        />
      </div>
      <MoreOptions
        label="When, where and a note"
        summary={summary || 'Optional'}
        defaultOpen={Boolean(summary)}
      >
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <IconInput
              icon="calendar"
              label="When (optional)"
              value={list?.when ?? ''}
              maxLength={80}
              placeholder="Saturday, 2pm"
              enterKeyHint="next"
              onChange={(event) => onChange({ when: event.target.value })}
            />
            <IconInput
              icon="map-pin"
              label="Where (optional)"
              value={list?.where ?? ''}
              maxLength={120}
              placeholder="Lakeside Park"
              enterKeyHint="next"
              autoComplete="off"
              onChange={(event) => onChange({ where: event.target.value })}
            />
          </div>
          <Textarea
            aria-label="A note for everyone (optional)"
            rows={2}
            value={list?.note ?? ''}
            maxLength={400}
            placeholder="A note for everyone: bring a chair if you have one."
            onChange={(event) => onChange({ note: event.target.value })}
            className="!min-h-[76px]"
          />
        </div>
      </MoreOptions>
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

/** What a guest sees first: an invitation, and how much is still open. */
function Invitation({ list, needed, total }: { list: BringList; needed: number; total: number }) {
  const when = list.when.trim();
  const where = list.where.trim();
  const note = list.note.trim();
  return (
    <Surface className="relative grid gap-3 overflow-hidden !pt-7">
      <Gingham className="absolute inset-x-0 top-0 h-3" />
      <p className="label">You’re invited to pitch in</p>
      <h2
        className="font-display text-[32px] leading-[1.02] font-extrabold tracking-[-0.03em] text-ink sm:text-[38px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {list.title.trim() || 'What to bring'}
      </h2>
      {(when || where) && (
        <div className="flex flex-wrap gap-2 text-[14px] text-ink-2">
          {when && (
            <span className="inline-flex min-h-8 items-center gap-2 rounded-full bg-well px-3">
              <Icon name="calendar" size={14} className="text-muted" />
              {when}
            </span>
          )}
          {where && (
            <span className="inline-flex min-h-8 items-center gap-2 rounded-full bg-well px-3">
              <Icon name="map-pin" size={14} className="text-muted" />
              {where}
            </span>
          )}
        </div>
      )}
      {note && (
        <p className="text-[14.5px] leading-relaxed whitespace-pre-line text-muted">{note}</p>
      )}
      {total > 0 && (
        <p className="flex items-center gap-2 text-[14.5px] font-medium text-ink">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ background: needed ? 'var(--glow, #ffd166)' : 'var(--accent, #8ee0a0)' }}
          />
          {needed
            ? `${needed} ${needed === 1 ? 'thing' : 'things'} still needed`
            : 'Everything’s covered'}
        </p>
      )}
    </Surface>
  );
}

/* ---------------- the list ---------------- */

function ClaimList({
  list,
  meId,
  organizer,
  labelledBy,
  onClaim,
  onRelease,
  onQty,
}: {
  list: BringList;
  meId: string | null;
  organizer: boolean;
  labelledBy: string;
  onClaim: (itemId: string) => void;
  onRelease: (itemId: string) => void;
  onQty: (itemId: string, qty: string) => void;
}) {
  const { needed, covered } = groups(list);
  const byCategory = new Set(list.items.map((item) => item.cat)).size > 1;
  const sections = [
    { key: 'needed', title: 'Still needed', groups: needed },
    { key: 'covered', title: 'Covered', groups: covered },
  ].filter((section) => section.groups.length > 0);
  return (
    <div className="grid gap-6" aria-labelledby={labelledBy} role="group">
      {sections.map((section) => (
        <ItemSection
          key={section.key}
          title={section.title}
          open={section.key === 'needed'}
          groups={section.groups}
          byCategory={byCategory}
          render={(item) => {
            const record = holder(list.claims[item.id]);
            return (
              <ItemCard
                key={item.id}
                item={item}
                record={record}
                mine={Boolean(record && meId && record.by === meId)}
                organizer={organizer}
                onClaim={() => onClaim(item.id)}
                onRelease={() => onRelease(item.id)}
                onQty={(qty) => onQty(item.id, qty)}
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
  open,
  groups: sectionGroups,
  byCategory,
  render,
}: {
  title: string;
  open: boolean;
  groups: Group[];
  byCategory: boolean;
  render: (item: BringItem) => ReactNode;
}) {
  const id = useId();
  const count = sectionGroups.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <section aria-labelledby={id} className="grid gap-2.5">
      <h3 id={id} className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full"
          style={{ background: open ? 'var(--glow, #ffd166)' : 'var(--accent, #8ee0a0)' }}
        />
        {title}
        <span className="mono-num text-[12.5px] font-normal text-muted">{count}</span>
      </h3>
      {sectionGroups.map((group) => (
        <div key={group.cat} className="grid gap-1.5">
          {byCategory && <p className="label mt-1 !text-[10.5px]">{CATEGORY_NAMES[group.cat]}</p>}
          <ul className="grid gap-2">{group.items.map(render)}</ul>
        </div>
      ))}
    </section>
  );
}

/** "2 bags" → "3 bags"; "" → "2". Null when the amount isn't a number to count up or down. */
function stepQty(qty: string, delta: 1 | -1): string | null {
  const text = qty.trim();
  if (!text) return delta > 0 ? '2' : null;
  const match = text.match(/^(\d{1,4})(\s.*)?$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = from + delta;
  if (to < 1) return '';
  let rest = match[2] ?? '';
  if (to === 1 && /[^s]s$/i.test(rest)) rest = rest.slice(0, -1);
  else if (from === 1 && to > 1 && /[a-z]$/i.test(rest) && !/s$/i.test(rest)) rest += 's';
  return `${to}${rest}`.slice(0, 30);
}
const countable = (qty: string) => !qty.trim() || /^\d{1,4}(\s.*)?$/.test(qty.trim());

function ItemCard({
  item,
  record,
  mine,
  organizer,
  onClaim,
  onRelease,
  onQty,
}: {
  item: BringItem;
  record: Claim | null;
  mine: boolean;
  organizer: boolean;
  onClaim: () => void;
  onRelease: () => void;
  onQty: (qty: string) => void;
}) {
  const name = nameOf(item);
  const qty = item.qty.trim();
  const who = record ? record.name.trim() || 'Someone' : '';
  const status = !record ? (
    <span className="font-medium" style={{ color: 'var(--glow, #ffd166)' }}>
      Still needed
    </span>
  ) : mine ? (
    <span className="font-medium text-ink-2">You’re bringing this</span>
  ) : (
    <span>
      <span className="font-medium text-ink-2">{who}</span> is bringing it
    </span>
  );

  // A guest taps the whole card to claim what's still needed.
  if (!organizer && !record) {
    return (
      <li>
        <button
          type="button"
          onClick={onClaim}
          aria-label={`I’ll bring ${name}`}
          className="flex min-h-[64px] w-full items-center gap-3 rounded-[16px] bg-subtle p-2.5 pl-3 text-left transition-[background-color,transform] border-[1.5px] border-dashed border-line-strong hover:bg-ink/[.07] active:scale-[.99]"
        >
          <CategoryTile cat={item.cat} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px] leading-snug font-semibold break-words text-ink">
              {name}
              {qty && <span className="font-normal text-muted"> · {qty}</span>}
            </span>
          </span>
          <span className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-signal-soft px-3.5 text-[14px] font-semibold text-signal-ink shadow-[inset_0_0_0_1px_var(--accent,var(--color-line-strong))]">
            <Icon name="hand" size={15} /> I’ll bring it
          </span>
        </button>
      </li>
    );
  }

  const up = organizer ? stepQty(item.qty, 1) : null;
  const down = organizer ? stepQty(item.qty, -1) : null;
  const stepper = organizer && countable(item.qty);
  return (
    <li
      className={cn(
        'flex min-h-[64px] items-center gap-3 rounded-[16px] p-2.5 pl-3 transition-colors',
        mine
          ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-ink))]'
          : record
            ? 'bg-subtle/60 shadow-[inset_0_0_0_1px_var(--color-line)]'
            : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
      )}
    >
      {record && !mine ? (
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-well text-[15px] font-semibold text-ink-2"
        >
          {who.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <CategoryTile cat={item.cat} />
      )}
      <div className={cn('min-w-0 flex-1', record && !mine && 'opacity-75')}>
        <p className="text-[15.5px] leading-snug font-semibold break-words text-ink">
          {name}
          {qty && !stepper && <span className="font-normal text-muted"> · {qty}</span>}
        </p>
        {stepper ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center rounded-full bg-well">
              <button
                type="button"
                aria-label={`Fewer ${name}`}
                disabled={down === null}
                onClick={() => down !== null && onQty(down)}
                className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-30"
              >
                <Icon name="minus" size={14} />
              </button>
              <span
                className={cn(
                  'min-w-6 text-center text-[13.5px] tabular-nums',
                  qty ? 'font-semibold text-ink' : 'text-faint',
                )}
              >
                {qty || 'any'}
              </span>
              <button
                type="button"
                aria-label={`More ${name}`}
                disabled={up === null}
                onClick={() => up !== null && onQty(up)}
                className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-30"
              >
                <Icon name="plus" size={14} />
              </button>
            </span>
            {record && <span className="text-[12.5px] leading-snug text-muted">{status}</span>}
          </div>
        ) : (
          record && <p className="text-[13px] leading-snug text-muted">{status}</p>
        )}
      </div>
      {!record ? (
        <button
          type="button"
          onClick={onClaim}
          aria-label={`I’ll bring ${name}`}
          title="I’ll bring it"
          className="group/tick grid size-11 shrink-0 place-items-center rounded-full"
        >
          <span className="grid size-7 place-items-center rounded-full text-transparent shadow-[inset_0_0_0_2px_var(--color-line-strong)] transition-colors group-hover/tick:text-muted">
            <Icon name="check" size={14} strokeWidth={3} />
          </span>
        </button>
      ) : mine ? (
        <button
          type="button"
          onClick={onRelease}
          aria-label={`Unclaim ${name}`}
          title="Unclaim"
          className="grid size-11 shrink-0 place-items-center rounded-full transition-transform active:scale-95"
        >
          <span
            className="grid size-7 place-items-center rounded-full text-[#12110d]"
            style={{ background: 'var(--accent, var(--color-ink))' }}
          >
            <Icon name="check" size={14} strokeWidth={3} />
          </span>
        </button>
      ) : (
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full text-positive"
        >
          <Icon name="check-circle" size={20} />
        </span>
      )}
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

/** Ideas to tap instead of type: the usual gaps in any list. */
const IDEAS = [
  'Ice',
  'Drinks',
  'Snacks',
  'Dessert',
  'Plates & cups',
  'Napkins',
  'Chairs',
  'Speaker',
  'Trash bags',
  'Sunscreen',
];

function AddItems({
  count,
  names,
  onAdd,
}: {
  count: number;
  names: string[];
  onAdd: (entries: NewItem[]) => void;
}) {
  const [name, setName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);

  if (count >= MAX_ITEMS)
    return (
      <Note icon="alert">
        That’s {MAX_ITEMS} things, as many as one list holds. Remove something to add more.
      </Note>
    );

  // An idea already on the list, even inside another name ("Plates, cups & napkins"), is left out.
  const onList = (idea: string) => {
    const word = new RegExp(`\\b${idea.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return names.some((entry) => word.test(entry));
  };
  const ideas = IDEAS.filter((idea) => !onList(idea)).slice(0, 6);

  // "Ice (2 bags)" or "Buns x2" carries its own amount; the + on the card adds one later.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const entry = parseLine(name);
    if (!entry?.name) return;
    onAdd([entry]);
    setName('');
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
    <div className={cn('grid gap-3', count > 0 && 'border-t border-line pt-4')}>
      <form onSubmit={submit} className="flex gap-2">
        <input
          ref={nameInput}
          aria-label="Add something to the list"
          placeholder="Add something…"
          value={name}
          maxLength={120}
          enterKeyHint="done"
          autoComplete="off"
          autoFocus={count === 0}
          onChange={(event) => setName(event.target.value)}
          onPaste={paste}
          className={cn(field, 'h-12 w-0 min-w-0 flex-1 rounded-[14px] lg:h-11')}
        />
        <button
          type="submit"
          aria-label="Add"
          disabled={!name.trim()}
          className="grid size-12 shrink-0 place-items-center rounded-[14px] text-[#12110d] transition-[opacity,transform] active:scale-95 disabled:opacity-40 lg:size-11"
          style={{ background: 'var(--accent, var(--color-ink))' }}
        >
          <Icon name="plus" size={20} />
        </button>
      </form>
      {ideas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12.5px] text-muted">Ideas</span>
          {ideas.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => onAdd([{ name: idea }])}
              className="inline-flex h-10 items-center gap-1 rounded-full bg-well px-3 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
            >
              <Icon name="plus" size={13} className="text-muted" />
              {idea}
            </button>
          ))}
        </div>
      )}
      <p className="text-[12.5px] text-muted">
        Tip: “Ice (2 bags)” sets the amount. Paste a list and every line becomes its own item.
      </p>
    </div>
  );
}

/* ---------------- sharing ---------------- */

function Tally({ claimed, total, needed }: { claimed: number; total: number; needed: number }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div aria-live="polite" aria-atomic="true">
          <p className="label">Covered</p>
          <p
            className="mt-1 font-display text-[40px] leading-none font-extrabold tracking-[-0.04em] text-ink"
            style={{ fontVariationSettings: "'wdth' 110" }}
          >
            {claimed}
            <span className="text-faint"> of {total}</span>
          </p>
        </div>
        <p className="pb-1 text-right text-[13.5px] leading-snug text-muted">
          {!total ? 'Nothing on the list yet' : needed ? `${needed} still needed` : 'All covered'}
        </p>
      </div>
      <Progress
        value={total ? (claimed / total) * 100 : 0}
        color="var(--accent, var(--color-ink))"
        label="Covered so far"
      />
    </div>
  );
}

/** Share and Copy for the link as it is right now: the big way to send it. */
function LinkButtons({
  link,
  title,
  text,
  className,
}: {
  link: string | null;
  title: string;
  /** Goes with the link in the share sheet. */
  text?: string;
  className?: string;
}) {
  const canShare = useCanShare();
  const { copy, copied } = useCopy();
  const [qr, setQr] = useState(false);
  const done = Boolean(link && copied === link);
  return (
    <div className={cn('grid gap-2', className)}>
      <div className={cn('grid gap-2', canShare && 'grid-cols-2')}>
        {canShare && (
          <ActionButton
            icon="share"
            disabled={!link}
            onClick={() => link && void navigator.share({ title, text, url: link }).catch(() => {})}
          >
            Share
          </ActionButton>
        )}
        <ActionButton
          icon={done ? 'check' : 'copy'}
          variant={canShare ? 'quiet' : 'accent'}
          disabled={!link}
          onClick={() => link && void copy(link, 'Link copied')}
        >
          {!link ? 'Getting the link…' : done ? 'Copied' : canShare ? 'Copy' : 'Copy the link'}
        </ActionButton>
      </div>
      {link && link.length <= 1600 && (
        <button
          type="button"
          onClick={() => setQr((value) => !value)}
          className="inline-flex h-10 items-center gap-1.5 justify-self-center px-2 text-[13px] font-medium text-muted hover:text-ink"
        >
          <Icon name="qr" size={14} /> {qr ? 'Hide the code' : 'Show a code to scan'}
        </button>
      )}
      {qr && link && (
        <div className="mx-auto w-full max-w-[220px] animate-rise rounded-[16px] bg-white p-3">
          <LinkQr url={link} />
        </div>
      )}
    </div>
  );
}

/** The organizer's share: looks like the invitation it becomes. */
function InviteCard({
  id,
  list,
  link,
  claimed,
  total,
  needed,
}: {
  id: string;
  list: BringList;
  link: string | null;
  claimed: number;
  total: number;
  needed: number;
}) {
  const title = list.title.trim() || 'What to bring';
  const details = [list.when.trim(), list.where.trim()].filter(Boolean).join(' · ');
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="relative grid scroll-mt-24 gap-4 overflow-hidden rounded-[22px] bg-surface p-5 !pt-8 shadow-card sm:p-6"
    >
      <Gingham className="absolute inset-x-0 top-0 h-3.5" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background: `radial-gradient(80% 60% at 50% 0%, ${tint('var(--accent, #8ee0a0)', 12)}, transparent 70%)`,
        }}
      />
      <div className="relative text-center">
        <p className="label">Share the list</p>
        <h2
          id={`${id}-title`}
          className="mt-2 font-display text-[26px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance text-ink"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          {title}
        </h2>
        {details && <p className="mt-1 text-[14px] text-ink-2">{details}</p>}
        <p className="mt-2 text-[13.5px] text-muted">
          {needed
            ? `${claimed} of ${total} covered · ${needed} still needed`
            : `All ${total} covered`}
        </p>
      </div>
      <LinkButtons link={link} title={title} text="Tap what you’ll bring:" className="relative" />
      <p className="relative text-center text-[13px] leading-relaxed text-muted">
        One link for everyone. When people tap what they’ll bring, they send it back: open it here
        and their names show up.
      </p>
      <CopyButton
        text={bringText(list, link ?? undefined)}
        label="Copy as text for the group chat"
        what="Copied — paste it in the group chat"
        className="relative !h-11 w-full"
      />
    </section>
  );
}

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
    'inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[13px] bg-well px-3.5 text-[15px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-50';
  const solid =
    'inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[13px] px-4 text-[15px] font-semibold text-[#12110d] transition-opacity disabled:opacity-50';
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 animate-rise rounded-[22px] bg-surface p-4 shadow-pop lg:inset-x-0 lg:bottom-6 lg:mx-auto lg:w-[min(560px,calc(100%-48px))]"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full text-[#12110d]"
          style={{ background: 'var(--accent, var(--color-ink))' }}
        >
          <Icon name="check" size={17} strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[15.5px] leading-snug font-semibold text-ink">
            You’re bringing {joinNames(names)}.
          </p>
          <p className="mt-0.5 text-[13.5px] leading-snug text-muted">
            Now send the updated link back to the group, so everyone sees it.
          </p>
        </div>
        <IconButton icon="x" label="Close" onClick={onDone} className="-mt-1 -mr-1" />
      </div>
      <div className="mt-3 flex gap-2">
        {canShare && (
          <button
            type="button"
            disabled={!link}
            onClick={() => link && void navigator.share({ title, url: link }).catch(() => {})}
            className={solid}
            style={{ background: 'var(--accent, var(--color-ink))' }}
          >
            <Icon name="share" size={16} /> Send it back
          </button>
        )}
        <button
          type="button"
          disabled={!link}
          onClick={copy}
          className={canShare ? quiet : solid}
          style={canShare ? undefined : { background: 'var(--accent, var(--color-ink))' }}
        >
          <Icon name={link && copied === link ? 'check' : 'copy'} size={16} />
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
        <p className="mt-2 text-[12.5px] text-critical">
          This browser wouldn’t copy. Use the Copy button beside the list instead.
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
            Opening a link here already adds its claims. You can also paste one instead.
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
        Removing a list here doesn’t change anyone else’s.
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
        <Field label="Your name" htmlFor={`${id}-name`} hint="You’re only asked once.">
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
