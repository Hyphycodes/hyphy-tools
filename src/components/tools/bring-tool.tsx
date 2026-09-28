'use client';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { clearHash, decodeState, linkFor, newId, writeHash } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  addItems,
  applyTemplate,
  bringListSchema,
  bringPeopleSchema,
  bringStoreSchema,
  bringText,
  CATEGORIES,
  CATEGORY_NAMES,
  changeCurrent,
  editItem,
  EMPTY_PEOPLE,
  EMPTY_STORE,
  keep,
  MAX_ITEMS,
  moveItem,
  newList,
  parseLine,
  parseLines,
  personNamed,
  progress,
  receive,
  removeItem,
  restoreItem,
  setDetails,
  TEMPLATES,
  type BringItem,
  type BringList,
  type BringPeople,
  type BringStore,
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
  type Claimer,
} from '@/lib/tools/claims';
import { ActionBar, ActionButton, IconButton, MoreOptions, Note, Surface } from './kit';
import {
  CategoryMark,
  Gingham,
  OCCASION_LOOK,
  OccasionPicture,
  PeopleStack,
  PersonDot,
  personColor,
  tint,
} from './bring-art';
import { ItemSheet, NameSheet } from './bring-sheets';
import {
  Combine,
  DeviceLists,
  GuestCard,
  InviteCard,
  SendBack,
  useSendLink,
  type Combined,
} from './bring-share';
import { PlanReturn, usePlanHandoff } from './plan-return';

/*
 * Bring: who's bringing what. The list is the object: a picnic blanket of little things. The
 * organizer picks the occasion, taps the usual things onto the blanket and sends the invite;
 * people tap what they'll bring and send the link back. Every list this device has seen is kept
 * here, so opening anyone's link merges it with what's already known (lib/tools/claims).
 */

type Details = Partial<Pick<BringList, 'title' | 'when' | 'where' | 'note'>>;
type Sent = { listId: string; version: string; how: 'shared' | 'copied' };

const nameOf = (item: Pick<BringItem, 'name'> | undefined) => item?.name.trim() || 'Something';

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

/** The neighbor an item swaps with: the next one of the same kind (the list shows kinds together). */
function neighbor(list: BringList, itemId: string, delta: -1 | 1) {
  const index = list.items.findIndex((item) => item.id === itemId);
  if (index < 0) return -1;
  const cat = list.items[index].cat;
  for (let at = index + delta; at >= 0 && at < list.items.length; at += delta) {
    if (list.items[at].cat === cat) return at;
  }
  return -1;
}

/** Move an item past the next one of its kind, one swap at a time. */
function moveWithin(list: BringList, itemId: string, delta: -1 | 1, now: number) {
  const index = list.items.findIndex((item) => item.id === itemId);
  const target = neighbor(list, itemId, delta);
  if (index < 0 || target < 0) return list;
  let next = list;
  for (let step = 0; step < Math.abs(target - index); step += 1) {
    next = moveItem(next, itemId, delta, now);
  }
  return next;
}

/** The occasion a list was started from, from its name. */
const templateFor = (title: string | undefined) =>
  TEMPLATES.find((entry) => entry.name.toLowerCase() === (title ?? '').trim().toLowerCase())?.id;

export function BringTool() {
  const id = useId();
  const toast = useToast();
  const send = useSendLink();
  const handoff = usePlanHandoff();
  const [store, setStore, { loaded }] = useLocalState<BringStore>(
    'hyphy.bring.v1',
    bringStoreSchema,
    EMPTY_STORE,
  );
  const [crew, setCrew] = useLocalState<BringPeople>(
    'hyphy.bring.people.v1',
    bringPeopleSchema,
    EMPTY_PEOPLE,
  );
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [news, setNews] = useState<string[]>([]);
  /** Picked an occasion (or a blank list): straight to the blanket. */
  const [started, setStarted] = useState(false);
  /** Where the suggestions come from: an occasion, or general ideas. */
  const [source, setSource] = useState<string | null>(null);
  /** The item whose sheet is open. */
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  /** What this device claimed since the list opened: the bar asks to send the link back. */
  const [claimedNow, setClaimedNow] = useState<string[]>([]);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [link, setLink] = useState<{ version: string; url: string } | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
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
  /** Claims made on this device: mine, and the people I put down. */
  const ownIds = new Set([...(me ? [me.id] : []), ...crew.people.map((person) => person.id)]);

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
          setClaimedNow([]);
          setOpenItem(null);
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
    // Opened from a Plan: the list starts with the plan's name.
    const fresh = handoff?.title
      ? setDetails(newList(newId(), now), { title: handoff.title }, now)
      : newList(newId(), now);
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
    const added = Math.min(entries.length, room);
    const ids = freshIds(added);
    edit((current, now) => addItems(current, entries, ids, now).list);
    if (entries.length > room)
      toast({
        title: `${entries.length - room} didn’t fit: a list holds ${MAX_ITEMS} things.`,
        icon: 'alert',
      });
    setAnnounce(
      added === 1
        ? `Added ${entries[0].name}`
        : added
          ? `Added ${added} things`
          : 'The list is full',
    );
  };
  const addTemplate = (templateId: string) => {
    const ids = freshIds(24);
    edit((current, now) => applyTemplate(current, templateId, ids, now).list);
    setAnnounce('Added the usual things');
  };
  const pickOccasion = (templateId: string | null) => {
    setStarted(true);
    setSource(templateId ?? 'ideas');
    const template = TEMPLATES.find((entry) => entry.id === templateId);
    // The list takes the occasion's name (until it's given one of its own).
    if (template && !list?.title.trim() && !handoff?.title)
      edit((current, now) => setDetails(current, { title: template.name }, now));
  };
  const remove = (itemId: string) => {
    if (!list) return;
    setStarted(true);
    setOpenItem(null);
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
  /** Put someone down for an item. Someone this device put down before can be swapped out. */
  const assign = (itemId: string, who: Claimer) => {
    changeClaims((current, now) => {
      let claims = current.claims;
      const top = holder(claims[itemId]);
      if (top?.by === who.id) return current;
      if (top) {
        if (!ownIds.has(top.by)) return current;
        claims = unclaim(claims, itemId, top.by, now);
      }
      return { ...current, claims: claim(claims, itemId, who, now) };
    });
    setClaimedNow((ids) => [...ids.filter((entry) => entry !== itemId), itemId]);
    const item = list?.items.find((entry) => entry.id === itemId);
    setAnnounce(`${who.id === me?.id ? 'You’re' : `${who.name} is`} bringing ${nameOf(item)}`);
    setOpenItem(null);
  };
  const release = (itemId: string) => {
    changeClaims((current, now) => {
      const top = holder(current.claims[itemId]);
      if (!top || !ownIds.has(top.by)) return current;
      return { ...current, claims: unclaim(current.claims, itemId, top.by, now) };
    });
    setClaimedNow((ids) => ids.filter((entry) => entry !== itemId));
  };
  const saveName = (name: string): Claimer => {
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
    return who;
  };
  const assignMe = (itemId: string, name?: string) => {
    const who = name ? saveName(name) : me;
    if (who?.name.trim()) assign(itemId, who);
  };
  const assignPerson = (itemId: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    if (me && me.name.trim().toLowerCase() === clean.toLowerCase()) return assignMe(itemId);
    const result = personNamed(crew, clean, newId(8));
    setCrew(result.people);
    assign(itemId, result.person);
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
    setClaimedNow([]);
    setRemoval(null);
    setNews([]);
    setProblem(null);
    setOpenItem(null);
    setSource(null);
  };
  const startNew = () => {
    setStore((current) => ({ ...current, current: null }));
    clearHash();
    resetView();
    setStarted(false);
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
      setStarted(false);
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
      <div aria-busy="true" className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,.8fr)]">
        <div className="skeleton h-[460px] !rounded-[28px]" />
        <div className="skeleton hidden h-[320px] !rounded-[24px] lg:block" />
      </div>
    );
  }

  const count = list?.items.length ?? 0;
  const { total, needed } = list ? progress(list) : { total: 0, needed: 0 };
  const title = list?.title.trim() || 'What to bring';
  const upToDate = link && link.version === version ? link.url : null;
  const heldHere = list
    ? list.items.filter((item) => {
        const top = holder(list.claims[item.id]);
        return top && ownIds.has(top.by);
      })
    : [];
  const sending = claimedNow.filter((itemId) => heldHere.some((item) => item.id === itemId));
  const status =
    list && sent?.listId === list.id ? { how: sent.how, current: sent.version === version } : null;
  const everyone = list
    ? [
        ...new Set(
          list.items.map((item) => holder(list.claims[item.id])?.name.trim() || '').filter(Boolean),
        ),
      ]
    : [];

  const shareNow = async () => {
    if (!list || !upToDate) return;
    const how = await send(
      upToDate,
      title,
      organizer ? `${title}: tap what you’ll bring` : undefined,
    );
    if (how === 'shared' || how === 'copied') {
      setSent({ listId: list.id, version, how });
      if (organizer && !window.matchMedia('(min-width: 1024px)').matches)
        document
          .getElementById(`${id}-invite`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (how === 'failed')
      toast({ title: 'Couldn’t copy. Copy the address bar instead.', icon: 'alert' });
    return how;
  };

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
          className="fx-rise flex items-start gap-2.5 rounded-[16px] bg-surface py-2 pr-2 pl-3.5 text-[14px] leading-relaxed text-ink-2 shadow-card"
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

  // Step one for an organizer: the occasion, picked by its picture.
  if (organizer && count === 0 && !started && !removal) {
    return (
      <div className="mx-auto grid w-full max-w-[880px] gap-5">
        <PlanReturn tool="bring" ready={false} attachment={() => null} />
        {notices}
        <Blanket>
          <h2
            className="text-center font-display text-[30px] leading-[1] font-extrabold tracking-[-0.035em] text-balance text-ink sm:text-[42px]"
            style={{ fontVariationSettings: "'wdth' 110" }}
          >
            What’s the occasion?
          </h2>
          <OccasionTiles onPick={pickOccasion} />
        </Blanket>
        {store.lists.length > 0 && (
          <DeviceLists store={store} onOpen={openSaved} onForget={forget} onStartNew={startNew} />
        )}
      </div>
    );
  }

  const sheetItem = openItem ? list?.items.find((item) => item.id === openItem) : undefined;
  const sheetRecord = sheetItem && list ? holder(list.claims[sheetItem.id]) : null;
  const offered = [
    ...new Set(
      [
        ...crew.people.map((person) => person.name.trim()),
        ...everyone.filter((name) => name.toLowerCase() !== me?.name.trim().toLowerCase()),
      ].filter(Boolean),
    ),
  ].slice(0, 10);
  const activeSource = source ?? templateFor(list?.title) ?? 'ideas';

  return (
    <div
      className={cn(
        'grid gap-5',
        count > 0
          ? 'lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,.8fr)] lg:items-start'
          : 'mx-auto w-full max-w-[880px]',
      )}
    >
      <div className="grid min-w-0 gap-4">
        {list && (
          <PlanReturn
            tool="bring"
            ready={total > 0}
            attachment={async () =>
              total
                ? {
                    url: await linkFor(list),
                    summary: needed
                      ? `${needed} ${needed === 1 ? 'thing' : 'things'} still needed`
                      : `All ${total} covered`,
                    t: Date.now(),
                  }
                : null
            }
          />
        )}
        {notices}

        <Blanket>
          <ListHead
            list={list}
            organizer={organizer}
            onChange={(details) => edit((current, now) => setDetails(current, details, now))}
          />

          {list && total > 0 && (
            <div className="mt-5">
              {needed === 0 ? <Covered names={everyone} total={total} /> : <Tally list={list} />}
            </div>
          )}

          {list && count > 0 && (
            <ItemTiles
              list={list}
              meId={me?.id ?? null}
              labelledBy={`${id}-items`}
              onOpen={setOpenItem}
            />
          )}
          <h2 id={`${id}-items`} className="sr-only">
            {organizer ? 'What’s needed' : 'Tap what you’ll bring'}
          </h2>

          {!organizer && count === 0 && (
            <p className="mt-6 text-center text-[15px] text-muted">Nothing on this list yet.</p>
          )}

          {removal && (
            <div
              role="status"
              className="fx-rise mt-4 flex items-center gap-3 rounded-[14px] bg-subtle py-1.5 pr-1.5 pl-3.5 text-[14px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
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

          {organizer && (
            <Tray
              source={activeSource}
              onSource={setSource}
              names={list?.items.map((item) => item.name) ?? []}
              count={count}
              settled={needed === 0}
              onAdd={add}
              onAddAll={addTemplate}
            />
          )}
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>

          {organizer && count > 0 && (
            <ActionBar className="lg:hidden">
              <ActionButton icon="send" disabled={!upToDate} onClick={() => void shareNow()}>
                {status?.current
                  ? 'Sent · send again'
                  : needed
                    ? 'Send the invite'
                    : 'Send the final list'}
              </ActionButton>
            </ActionBar>
          )}
        </Blanket>
      </div>

      <aside aria-label="Sharing" className="grid min-w-0 gap-4 lg:sticky lg:top-24">
        {list && count > 0 && organizer && (
          <InviteCard
            id={`${id}-invite`}
            list={list}
            link={upToDate}
            text={bringText(list, upToDate ?? undefined)}
            status={status}
            people={everyone}
            onSend={() => void shareNow()}
          />
        )}

        {list && !organizer && heldHere.length > 0 && (
          <GuestCard
            names={heldHere.map((item) => nameOf(item))}
            link={upToDate}
            sent={status?.current ? status.how : null}
            onSend={() => void shareNow()}
          />
        )}

        {store.lists.length > 1 && (
          <DeviceLists store={store} onOpen={openSaved} onForget={forget} onStartNew={startNew} />
        )}

        <Surface className="!py-2">
          <MoreOptions
            label="More"
            summary={me?.name.trim() ? `You’re ${me.name.trim()}` : undefined}
          >
            <div className="grid gap-4 pb-3">
              {list && count > 0 && <Combine onCombine={combine} />}
              <div className="grid gap-1">
                {me?.name.trim() && (
                  <MoreRow
                    icon="user"
                    onClick={() => setNaming(true)}
                    label={`Claiming as ${me.name.trim()}`}
                    action="Change name"
                  />
                )}
                {!organizer && list && (
                  <MoreRow
                    icon="pencil"
                    onClick={adopt}
                    label="Are you organizing this?"
                    action="Edit the list"
                  />
                )}
                {store.lists.length <= 1 && list && (
                  <MoreRow
                    icon="plus"
                    onClick={startNew}
                    label="Another get-together"
                    action="Start a new list"
                  />
                )}
              </div>
            </div>
          </MoreOptions>
        </Surface>
      </aside>

      {list && !organizer && sending.length > 0 && (
        <SendBack
          key={sending.join('.')}
          names={sending.map((itemId) => nameOf(list.items.find((item) => item.id === itemId)))}
          link={upToDate}
          onSend={async () => (await shareNow()) ?? null}
          onDone={() => setClaimedNow([])}
        />
      )}

      <ItemSheet
        item={sheetItem}
        record={sheetRecord}
        canRelease={Boolean(sheetRecord && ownIds.has(sheetRecord.by))}
        organizer={organizer}
        me={me}
        people={offered}
        canUp={Boolean(list && sheetItem && neighbor(list, sheetItem.id, -1) >= 0)}
        canDown={Boolean(list && sheetItem && neighbor(list, sheetItem.id, 1) >= 0)}
        onMe={(name) => sheetItem && assignMe(sheetItem.id, name)}
        onPerson={(name) => sheetItem && assignPerson(sheetItem.id, name)}
        onRelease={() => sheetItem && release(sheetItem.id)}
        onEdit={(change) =>
          sheetItem && edit((current, now) => editItem(current, sheetItem.id, change, now))
        }
        onMove={(delta) =>
          sheetItem && edit((current, now) => moveWithin(current, sheetItem.id, delta, now))
        }
        onRemove={() => sheetItem && remove(sheetItem.id)}
        onClose={() => setOpenItem(null)}
      />

      <NameSheet
        key={naming ? 'naming' : 'closed'}
        open={naming}
        initial={me?.name ?? ''}
        onSave={(name) => {
          saveName(name);
          setNaming(false);
        }}
        onClose={() => setNaming(false)}
      />
    </div>
  );
}

/* ---------------- the blanket ---------------- */

/** The list's cloth: paper with a gingham edge. */
function Blanket({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'relative isolate min-w-0 overflow-clip rounded-[28px] bg-surface px-4 pt-10 pb-5 shadow-lift sm:px-7 sm:pt-12 sm:pb-7',
        className,
      )}
    >
      <Gingham className="absolute inset-x-0 top-0 h-4" />
      {children}
    </section>
  );
}

function MoreRow({
  icon,
  label,
  action,
  onClick,
}: {
  icon: IconName;
  label: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <p className="flex min-h-11 items-center gap-2.5 text-[13.5px] text-muted">
      <Icon name={icon} size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        onClick={onClick}
        className="h-10 shrink-0 rounded-full px-3 font-medium text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink"
      >
        {action}
      </button>
    </p>
  );
}

/* ---------------- step one: the occasion ---------------- */

function OccasionTiles({ onPick }: { onPick: (templateId: string | null) => void }) {
  return (
    <div
      role="group"
      aria-label="Pick the occasion"
      className="mt-7 grid grid-cols-2 gap-2.5 sm:mt-9 sm:grid-cols-5 sm:gap-3"
    >
      {TEMPLATES.map((template, index) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onPick(template.id)}
          style={{ '--i': index } as CSSProperties}
          className="fx-rise group grid min-h-[148px] content-between justify-items-center gap-2 rounded-[22px] p-3 pb-3.5 text-center transition-transform active:scale-[.97] sm:min-h-[172px]"
        >
          <span
            aria-hidden="true"
            className="grid w-full place-items-center rounded-[18px] px-3 py-3 transition-transform duration-[var(--motion-dur)] ease-[var(--motion-ease)] group-hover:-translate-y-0.5"
            style={{ background: tint(OCCASION_LOOK[template.id]?.color ?? '#8ee0a0', 34) }}
          >
            <OccasionPicture id={template.id} className="max-w-[112px]" />
          </span>
          <span className="text-[16px] leading-tight font-semibold text-ink">{template.name}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPick(null)}
        style={{ '--i': TEMPLATES.length } as CSSProperties}
        className="fx-rise group col-span-2 flex min-h-16 items-center justify-center gap-3 rounded-[22px] border-[1.5px] border-dashed border-line-strong p-3 text-center transition-[transform,background-color] hover:bg-ink/[.04] active:scale-[.97] sm:col-span-1 sm:grid sm:min-h-[172px] sm:content-between sm:justify-items-center"
      >
        <span aria-hidden="true" className="w-16 sm:w-full sm:px-3 sm:py-3">
          <OccasionPicture id="blank" className="mx-auto max-w-[112px]" />
        </span>
        <span className="text-[16px] leading-tight font-semibold text-ink">Something else</span>
      </button>
    </div>
  );
}

/* ---------------- the head of the list ---------------- */

function ListHead({
  list,
  organizer,
  onChange,
}: {
  list: BringList | null;
  organizer: boolean;
  onChange: (details: Details) => void;
}) {
  const id = useId();
  const when = list?.when.trim() ?? '';
  const where = list?.where.trim() ?? '';
  const note = list?.note.trim() ?? '';
  if (!organizer && list) {
    return (
      <header className="grid gap-3 text-center">
        <h2
          className="font-display text-[34px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance text-ink sm:text-[44px]"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          {list.title.trim() || 'What to bring'}
        </h2>
        {(when || where) && (
          <div className="flex flex-wrap justify-center gap-2 text-[14px] text-ink-2">
            {when && (
              <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-well px-3.5">
                <Icon name="calendar" size={14} className="text-muted" />
                {when}
              </span>
            )}
            {where && (
              <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-well px-3.5">
                <Icon name="map-pin" size={14} className="text-muted" />
                {where}
              </span>
            )}
          </div>
        )}
        {note && (
          <p className="mx-auto max-w-[52ch] text-[15px] leading-relaxed whitespace-pre-line text-ink-2">
            {note}
          </p>
        )}
      </header>
    );
  }
  return (
    <header className="grid justify-items-center gap-3 text-center">
      <label htmlFor={`${id}-title`} className="sr-only">
        Your get-together
      </label>
      <input
        id={`${id}-title`}
        placeholder="Name it"
        value={list?.title ?? ''}
        maxLength={80}
        enterKeyHint="done"
        autoComplete="off"
        onChange={(event) => onChange({ title: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="h-14 w-full min-w-0 rounded-[14px] bg-transparent px-2 text-center font-display text-[34px] font-extrabold tracking-[-0.035em] text-ink outline-none transition-colors placeholder:text-faint hover:bg-ink/[.03] focus:bg-subtle sm:text-[44px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      />
      <div className="flex flex-wrap justify-center gap-2">
        <DetailChip
          icon="calendar"
          label="When"
          aria="When (optional)"
          value={list?.when ?? ''}
          placeholder="Saturday, 2pm"
          maxLength={80}
          onChange={(value) => onChange({ when: value })}
        />
        <DetailChip
          icon="map-pin"
          label="Where"
          aria="Where (optional)"
          value={list?.where ?? ''}
          placeholder="Lakeside Park"
          maxLength={120}
          onChange={(value) => onChange({ where: value })}
        />
        <DetailChip
          icon="message"
          label="Note"
          aria="A note for everyone (optional)"
          value={list?.note ?? ''}
          placeholder="Bring a chair if you have one"
          maxLength={400}
          onChange={(value) => onChange({ note: value })}
        />
      </div>
    </header>
  );
}

/** When, where, a note: a little chip until it's tapped, then a field right there. */
function DetailChip({
  icon,
  label,
  aria,
  value,
  placeholder,
  maxLength,
  onChange,
}: {
  icon: IconName;
  label: string;
  aria: string;
  value: string;
  placeholder: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const shown = value.trim();
  if (editing) {
    return (
      <span className="fx-pop relative inline-flex min-w-0 items-center">
        <Icon name={icon} size={15} className="pointer-events-none absolute left-3.5 text-muted" />
        <input
          aria-label={aria}
          autoFocus
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          enterKeyHint="done"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
          }}
          className="h-11 w-[min(78vw,280px)] rounded-full bg-surface pr-4 pl-9.5 text-[16px] text-ink shadow-[inset_0_0_0_1.5px_var(--color-signal)] outline-none placeholder:text-faint lg:text-[14.5px]"
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={shown ? `${aria}: ${shown}` : aria}
      onClick={() => setEditing(true)}
      className={cn(
        'inline-flex h-11 max-w-full min-w-0 items-center gap-2 rounded-full px-4 text-[14.5px] transition-colors',
        shown
          ? 'bg-well font-medium text-ink hover:bg-ink/10'
          : 'border-[1.5px] border-dashed border-line-strong text-muted hover:bg-ink/[.04] hover:text-ink',
      )}
    >
      <Icon name={shown ? icon : 'plus'} size={15} className="shrink-0 text-muted" />
      <span className="max-w-[26ch] truncate">{shown || label}</span>
    </button>
  );
}

/* ---------------- how covered it is ---------------- */

/** One dot per thing: filled in the color of whoever's bringing it. */
function Tally({ list }: { list: BringList }) {
  const { total, claimed } = progress(list);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2.5">
      <div aria-hidden="true" className="flex max-w-[360px] flex-wrap justify-center gap-1">
        {list.items.map((item) => {
          const top = holder(list.claims[item.id]);
          return (
            <span
              key={item.id}
              className={cn(
                'size-3 rounded-full fx-move',
                !top && 'shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
              )}
              style={top ? { background: personColor(top.name.trim() || 'Someone') } : undefined}
            />
          );
        })}
      </div>
      <p aria-live="polite" aria-atomic="true" className="text-[15px] text-ink-2">
        <span className="mono-num font-semibold text-ink">{claimed}</span> of{' '}
        <span className="mono-num">{total}</span> covered
      </p>
    </div>
  );
}

/** The payoff: nothing left to bring. */
function Covered({ names, total }: { names: string[]; total: number }) {
  return (
    <div
      role="status"
      className="fx-stamp grid justify-items-center gap-3 rounded-[22px] px-4 py-6 text-center"
      style={{ background: tint('var(--accent, #8ee0a0)', 26) }}
    >
      {names.length > 0 && <PeopleStack names={names} size={40} />}
      <p
        className="font-display text-[32px] leading-none font-extrabold tracking-[-0.035em] text-ink sm:text-[40px]"
        style={{ fontVariationSettings: "'wdth' 110" }}
      >
        Everything’s covered
      </p>
      <p className="text-[15px] text-ink-2">
        {total} {total === 1 ? 'thing' : 'things'}
        {names.length > 0 && `, ${names.length} ${names.length === 1 ? 'person' : 'people'}`}
      </p>
    </div>
  );
}

/* ---------------- the things on the blanket ---------------- */

function ItemTiles({
  list,
  meId,
  labelledBy,
  onOpen,
}: {
  list: BringList;
  meId: string | null;
  labelledBy: string;
  onOpen: (itemId: string) => void;
}) {
  const kinds = CATEGORIES.map((cat) => ({
    cat,
    items: list.items.filter((item) => item.cat === cat),
  })).filter((group) => group.items.length > 0);
  const labelled = kinds.length > 1;
  return (
    <div role="group" aria-labelledby={labelledBy} className="mt-6 grid gap-5">
      {kinds.map((group) => (
        <section key={group.cat} className="grid gap-2">
          {labelled && <h3 className="label px-1">{CATEGORY_NAMES[group.cat]}</h3>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.items.map((item) => {
              const record = holder(list.claims[item.id]);
              return (
                <ItemTile
                  key={item.id}
                  item={item}
                  who={record ? record.name.trim() || 'Someone' : null}
                  mine={Boolean(record && meId && record.by === meId)}
                  order={Math.min(list.items.indexOf(item), 14)}
                  onOpen={() => onOpen(item.id)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ItemTile({
  item,
  who,
  mine,
  order,
  onOpen,
}: {
  item: BringItem;
  who: string | null;
  mine: boolean;
  order: number;
  onOpen: () => void;
}) {
  const name = nameOf(item);
  const qty = item.qty.trim();
  const label = who
    ? `${name}${qty ? `, ${qty}` : ''}: ${mine ? 'you’re' : `${who} is`} bringing it`
    : `${name}${qty ? `, ${qty}` : ''}: still needed. Who’s bringing it?`;
  return (
    <li className="fx-settle" style={{ '--i': order } as CSSProperties}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={label}
        onClick={onOpen}
        className={cn(
          'group fx-move flex min-h-[62px] w-full items-center gap-3 rounded-[16px] border-[1.5px] py-2 pr-2.5 pl-2 text-left active:scale-[.985]',
          who
            ? 'border-transparent'
            : 'border-dashed border-line-strong bg-surface hover:border-solid hover:bg-subtle',
          mine && '!border-solid !border-[var(--accent-ink)]',
        )}
        style={who ? { background: tint(personColor(who), 24) } : undefined}
      >
        <CategoryMark cat={item.cat} size={38} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] leading-snug font-semibold break-words text-ink">
            {name}
          </span>
          {(qty || who) && (
            <span className="block truncate text-[13px] text-muted">
              {[qty, who ? (mine ? 'You' : who) : ''].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
        {who ? (
          <PersonDot key={who} name={who} size={34} className="fx-pop" />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-[34px] shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-line-strong text-faint transition-colors group-hover:text-ink-2"
          >
            <Icon name="plus" size={15} />
          </span>
        )}
      </button>
    </li>
  );
}

/* ---------------- adding: the usual things, tapped on ---------------- */

/** General ideas: the usual gaps in any list. */
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
  'Blanket',
  'Games',
];

function Tray({
  source,
  onSource,
  names,
  count,
  settled,
  onAdd,
  onAddAll,
}: {
  source: string;
  onSource: (source: string) => void;
  names: string[];
  count: number;
  /** Everything's covered: adding waits behind one button. */
  settled: boolean;
  onAdd: (entries: NewItem[]) => void;
  onAddAll: (templateId: string) => void;
}) {
  const [name, setName] = useState('');
  const [expanded, setExpanded] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  if (count >= MAX_ITEMS)
    return (
      <Note icon="alert" className="mt-6">
        That’s {MAX_ITEMS} things, as many as one list holds. Remove something to add more.
      </Note>
    );

  const have = new Set(names.map((entry) => entry.trim().toLowerCase()));
  // An idea already on the list, even inside another name ("Plates, cups & napkins"), is left out.
  const onList = (idea: string) => {
    const word = new RegExp(`\\b${idea.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return names.some((entry) => word.test(entry));
  };
  const template = TEMPLATES.find((entry) => entry.id === source);
  const chips: NewItem[] = template
    ? template.items
        .filter(([item]) => !have.has(item.toLowerCase()))
        .map(([item, qty, cat]) => ({ name: item, qty, cat }))
    : IDEAS.filter((idea) => !onList(idea)).map((idea) => ({ name: idea }));

  // "Ice (2 bags)" or "Buns x2" carries its own amount.
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

  if (count > 0 && (settled || !chips.length) && !expanded)
    return (
      <div className="mt-7 grid justify-items-center border-t-[1.5px] border-dashed border-line-strong pt-6">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex h-12 items-center gap-2 rounded-full border-[1.5px] border-dashed border-line-strong px-5 text-[15px] font-medium text-ink-2 transition-colors hover:bg-ink/[.04] hover:text-ink"
        >
          <Icon name="plus" size={17} /> Add something
        </button>
      </div>
    );

  const sources = [
    ...TEMPLATES.map((entry) => ({ id: entry.id, name: entry.name })),
    { id: 'ideas', name: 'Ideas' },
  ];

  return (
    <div
      className={cn(
        'grid gap-4',
        count > 0 ? 'mt-7 border-t-[1.5px] border-dashed border-line-strong pt-6' : 'mt-7',
      )}
    >
      <div
        role="radiogroup"
        aria-label="Suggestions for"
        className="scroller -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0"
      >
        {sources.map((entry) => {
          const on = entry.id === source;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onSource(entry.id)}
              className={cn(
                'inline-flex h-12 shrink-0 items-center gap-2 rounded-full py-1 pr-4 pl-1 text-[14.5px] font-medium transition-[background-color,box-shadow]',
                on
                  ? 'bg-signal-soft text-ink shadow-[inset_0_0_0_1.5px_var(--accent-ink,var(--color-ink))]'
                  : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
              )}
            >
              <span
                aria-hidden="true"
                className="grid h-10 w-12 place-items-center rounded-full px-1"
                style={{ background: tint(OCCASION_LOOK[entry.id]?.color ?? '#8ecff5', 40) }}
              >
                {entry.id === 'ideas' ? (
                  <Icon name="sparkles" size={17} className="text-ink-2" />
                ) : (
                  <OccasionPicture id={entry.id} />
                )}
              </span>
              {entry.name}
            </button>
          );
        })}
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-2" aria-label="Tap to add">
          {template && chips.length > 1 && (
            <button
              type="button"
              onClick={() => onAddAll(template.id)}
              className="fx-pop inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_10px_22px_-14px_var(--accent)] transition-transform active:scale-[.96]"
              style={{ background: 'var(--accent, var(--color-ink))' }}
            >
              <Icon name="plus" size={16} /> Add all {chips.length}
            </button>
          )}
          {chips.map((chip, index) => (
            <button
              key={chip.name}
              type="button"
              onClick={() => onAdd([chip])}
              style={{ '--i': Math.min(index, 12) } as CSSProperties}
              className="fx-rise inline-flex h-11 items-center gap-1.5 rounded-full bg-well pr-4 pl-3 text-[14.5px] font-medium text-ink transition-[background-color,transform] hover:bg-ink/10 active:scale-[.96]"
            >
              <Icon name="plus" size={15} className="text-muted" />
              {chip.name}
              {chip.qty && <span className="font-normal text-muted">{chip.qty}</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-center text-[14px] text-muted">
          {template ? `All the usual ${template.name.toLowerCase()} things are on.` : 'All on.'}
        </p>
      )}

      <form onSubmit={submit} className="mx-auto flex w-full max-w-[520px] gap-2">
        <input
          ref={nameInput}
          aria-label="Add something to the list"
          placeholder="Something else…"
          value={name}
          maxLength={120}
          enterKeyHint="done"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          onPaste={paste}
          className="h-12 w-0 min-w-0 flex-1 rounded-full bg-surface px-4.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:text-[15px]"
        />
        <button
          type="submit"
          aria-label="Add"
          disabled={!name.trim()}
          className="grid size-12 shrink-0 place-items-center rounded-full text-[var(--on-accent,#12110d)] transition-[opacity,transform] active:scale-95 disabled:opacity-40"
          style={{ background: 'var(--accent, var(--color-ink))' }}
        >
          <Icon name="plus" size={20} />
        </button>
      </form>
    </div>
  );
}
