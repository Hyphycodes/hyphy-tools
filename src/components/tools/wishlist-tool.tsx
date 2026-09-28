'use client';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input, Select } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import { Sheet } from '@/components/ui/sheet';
import { clearHash, decodeState, linkFor, newId, writeHash } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  claim,
  claimChanges,
  claimsVersion,
  heldBy,
  holder,
  renameClaims,
  unclaim,
  updateClaim,
  type Claim,
  type Claimer,
} from '@/lib/tools/claims';
import { CURRENCIES, formatMoney } from '@/lib/tools/split';
import {
  addWish,
  answerGate,
  changeGiven,
  checkDraft,
  domainOf,
  editWish,
  EMPTY_DRAFT,
  EMPTY_GIVEN,
  EMPTY_OWNER,
  giftListSchema,
  giftProgress,
  givenStoreSchema,
  isWebUrl,
  MAX_ITEMS,
  mergeOwn,
  moveWish,
  newWishList,
  OCCASION_NAMES,
  OCCASIONS,
  ownerStoreSchema,
  readUrl,
  receiveGift,
  removeWish,
  restoreWish,
  sampleList,
  setWishDetails,
  titleOf,
  toGift,
  WANT_NAMES,
  WANTS,
  wishText,
  withoutClaims,
  type GiftList,
  type Given,
  type GivenStore,
  type Occasion,
  type OwnerStore,
  type Want,
  type Wish,
  type WishDraft,
  type WishItem,
  type WishList,
  type WishRemoval,
} from '@/lib/tools/wishlist';
import {
  ActionBar,
  ActionButton,
  Choices,
  CopyButton,
  IconButton,
  Label,
  MoreOptions,
  Note,
  SampleButton,
  StartPanel,
  Surface,
  useCopy,
} from './kit';
import { MoneyInput } from './money-input';
import { LinkQr } from './share-link';

/*
 * Christmas List: the owner makes a wish list (kept in this browser) and shares a gift-giver
 * link. Gift-givers claim gifts in their copies of the link and pass it along; copies merge by
 * the rules in lib/tools/claims. The owner's view never shows claims: their list has none in
 * it, and a gift-giver link opened by its owner is shown with the claims left out.
 */

/** A little gold beside the tool's red: festive, used sparingly. */
const GOLD = '#e9c46a';

const OCCASION_ICONS: Record<Occasion, IconName> = {
  christmas: 'snowflake',
  birthday: 'party',
  wedding: 'heart',
  baby: 'sparkles',
  other: 'gift',
};
const WANT_ICONS: Record<Want, { icon: IconName; color: string }> = {
  love: { icon: 'heart', color: 'var(--accent, #ff5e57)' },
  like: { icon: 'star', color: GOLD },
  nice: { icon: 'circle', color: 'var(--color-muted)' },
};

type Combined = { error: string; other?: string } | { done: string };

const nameOf = (item: Pick<WishItem, 'name'> | undefined) => item?.name.trim() || 'A wish';

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What a link changed for this gift-giver, in words. */
function whatChanged(before: GiftList | null, after: GiftList, meId: string | null) {
  if (!before) return [];
  const news: string[] = [];
  const { lost, added } = claimChanges(before.claims, after.claims, meId);
  for (const { itemId, takenBy } of lost) {
    const name = nameOf(before.items.find((item) => item.id === itemId));
    if (!after.items.some((item) => item.id === itemId))
      news.push(`${name} came off the list, so your claim went with it.`);
    else if (takenBy) news.push(`${takenBy} claimed ${name} first, so it’s theirs to give.`);
    else news.push(`Your claim on ${name} was let go.`);
  }
  const known = new Set(before.items.map((item) => item.id));
  const fresh = after.items.filter((item) => !known.has(item.id)).length;
  const parts = [
    added ? `${added} new ${added === 1 ? 'claim' : 'claims'}` : '',
    fresh ? `${fresh} new ${fresh === 1 ? 'wish' : 'wishes'}` : '',
  ].filter(Boolean);
  if (parts.length) news.push(`This link brought ${parts.join(' and ')}.`);
  else if (after.edited > before.edited)
    news.push(`${after.who.trim() || 'The owner'} changed the list since you last saw it.`);
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

export function WishlistTool() {
  const [own, setOwn, { loaded: ownLoaded, reset: resetOwn }] = useLocalState<OwnerStore>(
    'hyphy.wishlist.v1',
    ownerStoreSchema,
    EMPTY_OWNER,
  );
  const [given, setGiven, { loaded: givenLoaded }] = useLocalState<GivenStore>(
    'hyphy.wishlist.given.v1',
    givenStoreSchema,
    EMPTY_GIVEN,
  );
  const [ready, setReady] = useState(false);
  /** A list opened from a gift-giver link (null: the owner's own list). */
  const [viewing, setViewing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [news, setNews] = useState<string[]>([]);
  const [ownLink, setOwnLink] = useState(false);
  const [asking, setAsking] = useState<{ itemId: string | null } | null>(null);
  const [claimedNow, setClaimedNow] = useState<string[]>([]);
  const [link, setLink] = useState<{ version: string; url: string } | null>(null);
  const latestOwn = useRef(own);
  const latestGiven = useRef(given);

  useEffect(() => {
    latestOwn.current = own;
  }, [own]);
  useEffect(() => {
    latestGiven.current = given;
  }, [given]);

  const entry = viewing ? (given.lists.find((item) => item.list.id === viewing) ?? null) : null;
  const gift = entry?.list ?? null;
  const role = entry?.role ?? null;
  const me = given.me;
  const version = gift ? `${gift.id}.${gift.edited}.${claimsVersion(gift.claims)}` : '';

  // A gift-giver link: the owner's own list takes in item changes and never the claims; any
  // other list is kept (merged) on this device, behind the gate until this device answers it.
  useEffect(() => {
    if (!ownLoaded || !givenLoaded) return;
    let live = true;
    const open = () => {
      const fragment = window.location.hash;
      const decoding =
        fragment.length > 1 ? decodeState(fragment, giftListSchema) : Promise.resolve(undefined);
      void decoding.then((incoming) => {
        if (!live) return;
        if (incoming === null)
          setProblem(
            'This link doesn’t hold a Christmas List, or part of it got cut off. Ask for it again.',
          );
        if (incoming) {
          setProblem(null);
          setClaimedNow([]);
          if (latestOwn.current.list?.id === incoming.id) {
            setOwn((current) =>
              current.list ? { ...current, list: mergeOwn(current.list, incoming) } : current,
            );
            clearHash();
            setViewing(null);
            setNews([]);
            setOwnLink(true);
          } else {
            const current = latestGiven.current;
            const result = receiveGift(current, incoming, Date.now());
            latestGiven.current = result.store;
            setGiven(result.store);
            setViewing(incoming.id);
            setOwnLink(false);
            setNews(
              result.role === 'giver'
                ? whatChanged(result.before, result.list, current.me?.id ?? null)
                : [],
            );
          }
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
  }, [ownLoaded, givenLoaded, setOwn, setGiven]);

  // A gift-giver's address bar carries the list with every claim this device knows about.
  useEffect(() => {
    if (!ready || !gift || role !== 'giver') return;
    const timer = setTimeout(() => {
      void writeHash(gift);
      void linkFor(gift).then((url) => setLink({ version, url }));
    }, 250);
    return () => clearTimeout(timer);
  }, [ready, gift, role, version]);

  /* ---------- the owner ---------- */

  const editOwn = (change: (list: WishList, now: number) => WishList) => {
    const now = Date.now();
    const fresh = newWishList(newId(), now);
    setOwn((current) => ({ ...current, list: change(current.list ?? fresh, now) }));
  };
  const addOne = (wish: Wish) => {
    const itemId = newId(6);
    editOwn((list, now) => addWish(list, wish, itemId, now));
  };
  const trySample = () => {
    const ids = Array.from({ length: 6 }, () => newId(6));
    editOwn((list, now) => sampleList(list.id, ids, now));
  };
  const startOver = () => {
    const ok = window.confirm(
      'Start a new list? This one is cleared from this browser. Links you already shared keep working.',
    );
    if (!ok) return;
    resetOwn(EMPTY_OWNER);
    setOwnLink(false);
  };

  /* ---------- gift-givers ---------- */

  const changeGift = (change: (list: GiftList, now: number) => GiftList) => {
    if (!viewing) return;
    const now = Date.now();
    const listId = viewing;
    setGiven((current) => changeGiven(current, listId, (list) => change(list, now)));
  };
  const take = (itemId: string, who: Claimer) => {
    changeGift((list, now) => ({ ...list, claims: claim(list.claims, itemId, who, now) }));
    setClaimedNow((ids) => [...ids.filter((id) => id !== itemId), itemId]);
  };
  const askOrTake = (itemId: string) => {
    if (me) take(itemId, me);
    else setAsking({ itemId });
  };
  const release = (itemId: string) => {
    if (!me) return;
    changeGift((list, now) => ({ ...list, claims: unclaim(list.claims, itemId, me.id, now) }));
    setClaimedNow((ids) => ids.filter((id) => id !== itemId));
  };
  const markBought = (itemId: string, got: boolean) => {
    if (!me) return;
    changeGift((list, now) => ({
      ...list,
      claims: updateClaim(list.claims, itemId, me.id, { got }, now),
    }));
  };
  const saveName = (name: string) => {
    const now = Date.now();
    const who: Claimer = { id: me?.id ?? newId(8), name: name.trim().slice(0, 40) };
    setGiven((current) => ({
      ...current,
      me: who,
      lists: current.lists.map((item) =>
        heldBy(item.list.claims, who.id).length
          ? {
              ...item,
              list: {
                ...item.list,
                claims: renameClaims(item.list.claims, who.id, who.name, now),
              },
            }
          : item,
      ),
    }));
    if (asking?.itemId) take(asking.itemId, who);
    setAsking(null);
  };
  const answer = (choice: 'giver' | 'owner') => {
    if (!viewing) return;
    const listId = viewing;
    setGiven((current) => answerGate(current, listId, choice));
  };
  const showAsGiver = () => {
    const ok = window.confirm(
      'This shows who’s getting what. Only continue if this isn’t your list.',
    );
    if (!ok || !viewing) return;
    const listId = viewing;
    answer('giver');
    // Saying "it's my list" set the claims aside on this device; the link still has them.
    void decodeState(window.location.hash, giftListSchema).then((incoming) => {
      if (incoming?.id === listId)
        setGiven((current) => receiveGift(current, incoming, Date.now()).store);
    });
  };
  const adopt = () => {
    if (!gift) return;
    const mine = latestOwn.current.list;
    if (
      mine &&
      mine.id !== gift.id &&
      mine.items.length > 0 &&
      !window.confirm(
        `Replace “${titleOf(mine)}”, the list you’re making on this device, with this one?`,
      )
    )
      return;
    const listId = gift.id;
    setOwn({ v: 1, list: withoutClaims(gift), shared: gift.edited });
    setGiven((current) => ({
      ...current,
      lists: current.lists.filter((item) => item.list.id !== listId),
    }));
    setViewing(null);
    clearHash();
  };
  const combine = async (text: string): Promise<Combined> => {
    const at = text.indexOf('#');
    if (at < 0) return { error: 'Paste the whole link: the list is the part after the #.' };
    const incoming = await decodeState(text.slice(at), giftListSchema);
    if (!incoming) return { error: 'That isn’t a Christmas List link, or part of it got cut off.' };
    if (!gift || incoming.id !== gift.id)
      return {
        error: `That link is for a different list, “${titleOf(incoming)}”.`,
        other: text.slice(at),
      };
    const current = latestGiven.current;
    const result = receiveGift(current, incoming, Date.now());
    latestGiven.current = result.store;
    setGiven(result.store);
    const changes = whatChanged(result.before, result.list, current.me?.id ?? null);
    setNews(changes);
    return { done: changes.length ? 'Combined.' : 'Combined. That link had nothing new.' };
  };

  /* ---------- lists on this device ---------- */

  const resetView = () => {
    setNews([]);
    setClaimedNow([]);
    setProblem(null);
    setOwnLink(false);
  };
  const openGiven = (listId: string) => {
    resetView();
    setViewing(listId);
    // Only a gift-giver's list goes in the address bar (the effect above writes it).
    if (given.lists.find((item) => item.list.id === listId)?.role !== 'giver') clearHash();
  };
  const openOwn = () => {
    resetView();
    setViewing(null);
    clearHash();
  };
  const forget = (listId: string) => {
    const entry = given.lists.find((item) => item.list.id === listId);
    const title = entry ? titleOf(entry.list) : 'this list';
    if (!window.confirm(`Remove “${title}” from this device? Everyone else keeps their copy.`))
      return;
    setGiven((current) => ({
      ...current,
      lists: current.lists.filter((item) => item.list.id !== listId),
    }));
    if (viewing === listId) openOwn();
  };

  if (!ready) {
    return (
      <div aria-busy="true" className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)]">
        <div className="skeleton h-[420px] !rounded-[22px]" />
        <div className="skeleton hidden h-[320px] !rounded-[22px] lg:block" />
      </div>
    );
  }

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

  const deviceLists = (
    <GivenLists
      lists={given.lists}
      viewing={viewing}
      ownTitle={own.list ? titleOf(own.list) : null}
      onOpen={openGiven}
      onOpenOwn={openOwn}
      onForget={forget}
    />
  );

  const upToDate = link && link.version === version ? link.url : null;
  const mine = gift && me ? heldBy(gift.claims, me.id) : [];

  return gift && role === 'ask' ? (
    <div className="grid gap-5">
      {notices}
      <Gate list={gift} onGiver={() => answer('giver')} onOwner={() => answer('owner')} />
    </div>
  ) : gift && role === 'owner' ? (
    <OwnerChoiceView
      list={gift}
      notices={notices}
      deviceLists={deviceLists}
      onAdopt={adopt}
      onShowAsGiver={showAsGiver}
    />
  ) : gift && role === 'giver' ? (
    <GiverView
      list={gift}
      me={me}
      version={version}
      link={upToDate}
      notices={notices}
      deviceLists={deviceLists}
      sending={claimedNow.filter((itemId) => mine.includes(itemId))}
      asking={asking}
      onClaim={askOrTake}
      onRelease={release}
      onBought={markBought}
      onAskName={() => setAsking({ itemId: null })}
      onSaveName={saveName}
      onCloseName={() => setAsking(null)}
      onCombine={combine}
      onCloseBar={() => setClaimedNow([])}
    />
  ) : (
    <OwnerView
      own={own}
      notices={notices}
      ownLink={ownLink}
      deviceLists={given.lists.length > 0 ? deviceLists : null}
      onDetails={(details) => editOwn((list, now) => setWishDetails(list, details, now))}
      onAdd={addOne}
      onEdit={(itemId, wish) => editOwn((list, now) => editWish(list, itemId, wish, now))}
      onMove={(itemId, delta) => editOwn((list, now) => moveWish(list, itemId, delta, now))}
      onRemove={(itemId) => {
        let taken: WishRemoval | null = null;
        if (own.list) taken = removeWish(own.list, itemId, Date.now()).removal;
        editOwn((list, now) => removeWish(list, itemId, now).list);
        return taken;
      }}
      onRestore={(taken) => editOwn((list, now) => restoreWish(list, taken, now))}
      onSample={trySample}
      onShared={(edited) => setOwn((current) => ({ ...current, shared: edited }))}
      onStartOver={startOver}
    />
  );
}

/* ---------------- look and feel ---------------- */

/** How much it's wanted, as a color along the tag's edge. */
const WANT_EDGE: Record<Want, string> = {
  love: 'var(--accent, #ff5e57)',
  like: GOLD,
  nice: 'var(--glow, #46c28e)',
};

const tint = (color: string, amount: number) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

function Ribbon() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
      style={{
        background: `linear-gradient(90deg, transparent, var(--accent, #ff5e57) 18%, ${GOLD} 50%, var(--accent, #ff5e57) 82%, transparent)`,
      }}
    />
  );
}

/** An icon in a color of its own (a small festive highlight; the label beside it says it all). */
function Tinted({ name, size, color }: { name: IconName; size: number; color: string }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0" style={{ color }}>
      <Icon name={name} size={size} />
    </span>
  );
}

/** A picture of the result: two gift tags on a string. */
function TagArt() {
  const tags: [string, Want, string, string][] = [
    ['Merino socks', 'love', '$24', '-rotate-6'],
    ['A good book', 'like', 'Claimed', 'rotate-3'],
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto flex h-[128px] w-[280px] justify-center">
      <svg viewBox="0 0 280 40" className="absolute inset-x-0 top-0 h-10 w-full">
        <path
          d="M4 6 C 80 34, 200 34, 276 6"
          fill="none"
          stroke={GOLD}
          strokeWidth="1.5"
          strokeDasharray="3 4"
          opacity=".7"
        />
      </svg>
      {tags.map(([name, want, meta, turn], index) => (
        <div
          key={name}
          className={cn(
            'relative mt-6 w-[128px] origin-top rounded-[14px] bg-subtle p-3 pl-4 text-left shadow-[0_16px_34px_-20px_rgb(0_0_0/.8),inset_0_0_0_1px_var(--color-line)]',
            turn,
            index > 0 && '-ml-2 mt-9',
          )}
          style={{ borderLeft: `4px solid ${WANT_EDGE[want]}` }}
        >
          <span className="absolute top-2.5 right-2.5 size-2.5 rounded-full bg-surface shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]" />
          <p className="pr-3 text-[13px] leading-tight font-semibold text-ink">{name}</p>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">
            <Tinted name={WANT_ICONS[want].icon} size={11} color={WANT_ICONS[want].color} />
            {WANT_NAMES[want]}
          </p>
          <p
            className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{
              background: tint(index ? 'var(--glow, #46c28e)' : GOLD, 18),
              color: index ? 'var(--glow, #46c28e)' : GOLD,
            }}
          >
            {meta}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Share and Copy for a link that's ready: the big way to send it. */
function LinkButtons({
  link,
  title,
  onUsed,
  className,
}: {
  link: string | null;
  title: string;
  /** Called when the link leaves this page (shared or copied). */
  onUsed?: () => void;
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
            onClick={() => {
              if (!link) return;
              onUsed?.();
              void navigator.share({ title, url: link }).catch(() => {});
            }}
          >
            Share
          </ActionButton>
        )}
        <ActionButton
          icon={done ? 'check' : 'copy'}
          variant={canShare ? 'quiet' : 'accent'}
          disabled={!link}
          onClick={() => {
            if (!link) return;
            onUsed?.();
            void copy(link, 'Link copied');
          }}
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

/* ---------------- someone else's list: as its owner, or as a gift-giver ---------------- */

function OwnerChoiceView({
  list,
  notices,
  deviceLists,
  onAdopt,
  onShowAsGiver,
}: {
  list: GiftList;
  notices: ReactNode;
  deviceLists: ReactNode;
  onAdopt: () => void;
  onShowAsGiver: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)] lg:items-start">
      <div className="grid min-w-0 gap-5">
        {notices}
        <Note icon="eye-off">Your list, with the claims left out so the surprise survives.</Note>
        <ListHeader list={list} />
        <Surface className="grid gap-4">
          <h2 className="text-[17px] font-semibold text-ink">
            Wishes{' '}
            <span className="mono-num text-[13px] font-normal text-muted">{list.items.length}</span>
          </h2>
          <ul className="grid gap-3">
            {list.items.map((item) => (
              <WishCard key={item.id} item={item} currency={list.currency} />
            ))}
          </ul>
        </Surface>
      </div>
      <aside aria-label="Your list" className="grid gap-4 lg:sticky lg:top-24">
        <Surface className="grid gap-3">
          <h2 className="text-[16px] font-semibold text-ink">Want to change it?</h2>
          <p className="text-[13.5px] leading-relaxed text-muted">
            Edit your list here and share a new link. Claims stay hidden from you.
          </p>
          <ActionButton icon="pencil" onClick={onAdopt}>
            Edit my list
          </ActionButton>
        </Surface>
        {deviceLists}
        <button
          type="button"
          onClick={onShowAsGiver}
          className="h-10 justify-self-start px-1 text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Not your list? Show it as a gift-giver
        </button>
      </aside>
    </div>
  );
}

function GiverView({
  list,
  me,
  version,
  link,
  notices,
  deviceLists,
  sending,
  asking,
  onClaim,
  onRelease,
  onBought,
  onAskName,
  onSaveName,
  onCloseName,
  onCombine,
  onCloseBar,
}: {
  list: GiftList;
  me: Claimer | null;
  version: string;
  link: string | null;
  notices: ReactNode;
  deviceLists: ReactNode;
  sending: string[];
  asking: { itemId: string | null } | null;
  onClaim: (itemId: string) => void;
  onRelease: (itemId: string) => void;
  onBought: (itemId: string, got: boolean) => void;
  onAskName: () => void;
  onSaveName: (name: string) => void;
  onCloseName: () => void;
  onCombine: (text: string) => Promise<Combined>;
  onCloseBar: () => void;
}) {
  const { total, claimed, bought } = giftProgress(list);
  const owner = list.who.trim();
  const find = (itemId: string | null) => list.items.find((item) => item.id === itemId);
  const askingItem = asking?.itemId ? find(asking.itemId) : undefined;
  const mine = me ? heldBy(list.claims, me.id) : [];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)] lg:items-start">
      <div className="grid min-w-0 gap-5">
        {notices}
        <ListHeader list={list} giver open={total - claimed} />
        <Surface className="grid gap-4">
          <h2 className="text-[17px] font-semibold text-ink">Tap a gift you’ll give</h2>
          {list.items.length === 0 ? (
            <p className="text-[14px] text-muted">Nothing on this list yet.</p>
          ) : (
            <ul className="grid gap-3">
              {list.items.map((item) => {
                const record = holder(list.claims[item.id]);
                const isMine = Boolean(record && me && record.by === me.id);
                return (
                  <WishCard
                    key={item.id}
                    item={item}
                    currency={list.currency}
                    dim={Boolean(record && !isMine)}
                    mine={isMine}
                  >
                    <GiverActions
                      name={nameOf(item)}
                      record={record}
                      mine={isMine}
                      onClaim={() => onClaim(item.id)}
                      onRelease={() => onRelease(item.id)}
                      onBought={(got) => onBought(item.id, got)}
                    />
                  </WishCard>
                );
              })}
            </ul>
          )}
        </Surface>
      </div>

      <aside aria-label="Claims and sharing" className="grid gap-4 lg:sticky lg:top-24">
        <Surface className="grid gap-4 !p-5 sm:!p-6">
          <div className="flex items-end justify-between gap-3">
            <div aria-live="polite" aria-atomic="true">
              <p className="label">Claimed</p>
              <p
                className="mt-1 font-display text-[40px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                style={{ fontVariationSettings: "'wdth' 110" }}
              >
                {claimed}
                <span className="text-faint"> of {total}</span>
              </p>
            </div>
            <p className="pb-1 text-right text-[13.5px] leading-snug text-muted">
              {bought ? `${bought} bought` : total - claimed ? `${total - claimed} still open` : ''}
            </p>
          </div>
          <Progress
            value={total ? (claimed / total) * 100 : 0}
            color="var(--accent, var(--color-ink))"
            label="Claimed so far"
          />
          <div className="grid gap-2 border-t border-line pt-4">
            <p className="text-[15px] font-semibold text-ink">
              {mine.length ? 'Now pass it along' : 'Pass the link along'}
            </p>
            <p className="text-[13.5px] leading-relaxed text-muted">
              Claims live in the link. Send it to the other gift-givers
              {owner ? `, not to ${owner},` : ''} so nobody buys the same thing twice.
            </p>
            <LinkButtons key={version} link={link} title={titleOf(list)} className="mt-1" />
          </div>
          {me && (
            <p className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
              <span className="min-w-0 truncate">
                Claiming as{' '}
                <span className="font-medium text-ink-2">{me.name.trim() || 'Someone'}</span>
              </span>
              <button
                type="button"
                onClick={onAskName}
                className="h-10 shrink-0 font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
              >
                Change name
              </button>
            </p>
          )}
        </Surface>

        <Combine onCombine={onCombine} />
        {deviceLists}
      </aside>

      {sending.length > 0 && (
        <SendOn
          names={sending.map((itemId) => nameOf(find(itemId)))}
          owner={owner}
          link={link}
          title={titleOf(list)}
          onDone={onCloseBar}
        />
      )}
      <NameSheet
        key={asking ? `ask-${asking.itemId ?? 'name'}` : 'closed'}
        open={Boolean(asking)}
        itemName={askingItem ? nameOf(askingItem) : null}
        initial={me?.name ?? ''}
        onSave={onSaveName}
        onClose={onCloseName}
      />
    </div>
  );
}

/* ---------------- the owner's view ---------------- */

type Details = Partial<Pick<WishList, 'title' | 'who' | 'occasion' | 'currency'>>;

/** Tap one to add it: a start that costs nothing. */
const STARTERS = [
  'Cozy socks',
  'A good book',
  'Coffee gear',
  'Tickets to something fun',
  'Something handmade',
  'A board game',
];

function OwnerView({
  own,
  notices,
  ownLink,
  deviceLists,
  onDetails,
  onAdd,
  onEdit,
  onMove,
  onRemove,
  onRestore,
  onSample,
  onShared,
  onStartOver,
}: {
  own: OwnerStore;
  notices: ReactNode;
  ownLink: boolean;
  deviceLists: ReactNode;
  onDetails: (details: Details) => void;
  onAdd: (wish: Wish) => void;
  onEdit: (itemId: string, wish: Wish) => void;
  onMove: (itemId: string, delta: -1 | 1) => void;
  onRemove: (itemId: string) => WishRemoval | null;
  onRestore: (removal: WishRemoval) => void;
  onSample: () => void;
  onShared: (edited: number) => void;
  onStartOver: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [removal, setRemoval] = useState<WishRemoval | null>(null);
  const [made, setMade] = useState<{ edited: number; url: string } | null>(null);
  const list = own.list;
  const items = list?.items ?? [];
  const currency = list?.currency ?? 'USD';
  const changed = Boolean(list && own.shared !== null && list.edited > own.shared);
  const giftLink = list && made?.edited === list.edited ? made.url : null;

  useEffect(() => {
    if (!removal) return;
    const timer = setTimeout(() => setRemoval(null), 12_000);
    return () => clearTimeout(timer);
  }, [removal]);

  // The gift-giver link is made ahead, so Share and Copy work on the first tap.
  useEffect(() => {
    if (!list || !list.items.length) return;
    let live = true;
    const timer = setTimeout(() => {
      void linkFor(toGift(list)).then((url) => live && setMade({ edited: list.edited, url }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [list]);

  const addName = (name: string) =>
    onAdd({ name, url: '', price: 0, note: '', want: EMPTY_DRAFT.want });

  if (items.length === 0 && !removal) {
    return (
      <div className="grid gap-5">
        {notices}
        <StartPanel
          art={<TagArt />}
          title="What’s on your list?"
          lead="Add a wish with just its name. Links, prices and notes can come later."
          className="mx-auto w-full max-w-[760px]"
          footer={<SampleButton onClick={onSample}>See a finished list first</SampleButton>}
        >
          <div className="grid gap-4 text-left">
            <WishForm
              initial={EMPTY_DRAFT}
              currency={currency}
              submitLabel="Add"
              onSubmit={onAdd}
              first
            />
            <div className="grid gap-2">
              <p className="text-center text-[13px] text-muted">Or start with one of these</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {STARTERS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => addName(name)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
                  >
                    <Tinted name="gift" size={13} color="var(--accent, #ff5e57)" />
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </StartPanel>
        {deviceLists && <div className="mx-auto w-full max-w-[640px]">{deviceLists}</div>}
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)] lg:items-start">
      <div className="grid min-w-0 gap-5">
        {notices}
        {ownLink && (
          <Note icon="eye-off" tone="positive">
            That link is to your own list, so the claims in it stay hidden here. Any changes to the
            list itself came in.
          </Note>
        )}
        <HeaderEditor list={list} onChange={onDetails} />

        <Surface className="grid gap-4">
          <h2 className="text-[17px] font-semibold text-ink">
            Your wishes{' '}
            <span className="mono-num text-[13px] font-normal text-muted">{items.length}</span>
          </h2>
          <ul className="grid gap-3">
            {items.map((item, index) =>
              editing === item.id ? (
                <li
                  key={item.id}
                  className="rounded-[18px] bg-subtle p-3.5 shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] sm:p-4"
                >
                  <WishForm
                    initial={{
                      name: item.name,
                      url: item.url,
                      price: item.price,
                      note: item.note,
                      want: item.want,
                    }}
                    currency={currency}
                    submitLabel="Save"
                    onSubmit={(wish) => {
                      onEdit(item.id, wish);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  >
                    <div className="flex items-center gap-1 border-t border-line pt-3">
                      <IconButton
                        icon="arrow-up"
                        label={`Move ${nameOf(item)} up`}
                        disabled={index === 0}
                        onClick={() => onMove(item.id, -1)}
                        className="!size-11 lg:!size-9"
                      />
                      <IconButton
                        icon="arrow-down"
                        label={`Move ${nameOf(item)} down`}
                        disabled={index === items.length - 1}
                        onClick={() => onMove(item.id, 1)}
                        className="!size-11 lg:!size-9"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setRemoval(onRemove(item.id));
                          setEditing(null);
                        }}
                        className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-[11px] px-3 text-[14px] font-medium text-muted transition-colors hover:bg-critical-soft hover:text-critical lg:h-9"
                      >
                        <Icon name="trash" size={15} /> Remove
                      </button>
                    </div>
                  </WishForm>
                </li>
              ) : (
                <WishCard
                  key={item.id}
                  item={item}
                  currency={currency}
                  action={
                    <IconButton
                      icon="pencil"
                      label={`Edit ${nameOf(item)}`}
                      onClick={() => setEditing(item.id)}
                      className="!size-11 lg:!size-9"
                    />
                  }
                />
              ),
            )}
          </ul>
          {removal && (
            <div
              role="status"
              className="flex items-center gap-3 rounded-[12px] bg-subtle py-1.5 pr-1.5 pl-3.5 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              <span className="min-w-0 flex-1 truncate">Removed “{nameOf(removal.item)}”.</span>
              <button
                type="button"
                onClick={() => {
                  onRestore(removal);
                  setRemoval(null);
                }}
                className="h-10 rounded-[10px] px-3 font-semibold text-ink hover:bg-ink/5"
              >
                Undo
              </button>
            </div>
          )}
          <div className="grid gap-2 border-t border-line pt-4">
            {items.length >= MAX_ITEMS ? (
              <Note icon="alert">
                That’s {MAX_ITEMS} wishes, as many as one list holds. Remove one to add another.
              </Note>
            ) : (
              <WishForm
                initial={EMPTY_DRAFT}
                currency={currency}
                submitLabel="Add"
                onSubmit={onAdd}
              />
            )}
          </div>
          {list && items.length > 0 && (
            <ActionBar className="lg:hidden">
              <ActionButton
                icon="gift"
                onClick={() =>
                  document
                    .getElementById(`${id}-share`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                Share with gift-givers
              </ActionButton>
            </ActionBar>
          )}
        </Surface>
      </div>

      <aside aria-label="Sharing" className="grid gap-4 lg:sticky lg:top-24">
        {list && items.length > 0 && (
          <section
            id={`${id}-share`}
            aria-labelledby={`${id}-share-title`}
            className="relative grid scroll-mt-24 gap-3 overflow-hidden rounded-[22px] bg-surface p-4 shadow-card sm:p-5"
          >
            <Ribbon />
            <h2 id={`${id}-share-title`} className="pt-1 text-[17px] font-semibold text-ink">
              Share your list
            </h2>
            <div
              className="grid gap-3 rounded-[18px] p-4"
              style={{
                background: tint('var(--accent, #ff5e57)', 10),
                boxShadow: `inset 0 0 0 1px ${tint('var(--accent, #ff5e57)', 35)}`,
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-[12px] text-[#12110d]"
                  style={{ background: 'var(--accent, #ff5e57)' }}
                >
                  <Icon name="gift" size={19} />
                </span>
                <div className="min-w-0">
                  <p className="text-[15.5px] font-semibold text-ink">Gift-giver link</p>
                  <p className="mt-0.5 text-[13.5px] leading-snug text-muted">
                    Send this to family and friends. They claim gifts, so nobody buys the same thing
                    twice.
                  </p>
                </div>
              </div>
              <LinkButtons
                link={giftLink}
                title={titleOf(list)}
                onUsed={() => onShared(list.edited)}
              />
              {changed && (
                <p className="flex items-start gap-2 text-[13px] leading-snug text-ink-2">
                  <Icon name="refresh" size={14} className="mt-0.5 shrink-0 text-muted" />
                  You’ve changed the list since you shared it. Send the link again so everyone sees
                  the changes.
                </p>
              )}
            </div>
            <div className="grid gap-3 rounded-[18px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-well text-ink-2">
                  <Icon name="eye-off" size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-[15.5px] font-semibold text-ink">Just for you</p>
                  <p className="mt-0.5 text-[13.5px] leading-snug text-muted">
                    Your list stays on this page, in this browser. Come back here to change it.
                    Don’t open the gift-giver link yourself: it shows who’s getting what.
                  </p>
                </div>
              </div>
              <CopyButton
                text={wishText(list)}
                label="Copy my list as text"
                what="List copied (no claims in it)"
                className="!h-11 w-full"
              />
            </div>
          </section>
        )}

        {deviceLists}

        {list && (
          <button
            type="button"
            onClick={onStartOver}
            className="h-10 justify-self-start px-1 text-[13.5px] text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Start a new list
          </button>
        )}
      </aside>
    </div>
  );
}

function HeaderEditor({
  list,
  onChange,
}: {
  list: WishList | null;
  onChange: (details: Details) => void;
}) {
  const id = useId();
  const who = list?.who.trim() ?? '';
  const occasion = list?.occasion ?? 'christmas';
  const currency = list?.currency ?? 'USD';
  return (
    <Surface className="relative grid gap-2 overflow-hidden">
      <Ribbon />
      <label htmlFor={`${id}-who`} className="label flex items-center gap-2 pt-1">
        <Tinted name={OCCASION_ICONS[occasion]} size={13} color={GOLD} />
        Whose list is it?
      </label>
      <div className="relative">
        <input
          id={`${id}-who`}
          value={list?.who ?? ''}
          maxLength={40}
          placeholder="Your name"
          autoComplete="given-name"
          enterKeyHint="done"
          onChange={(event) => onChange({ who: event.target.value })}
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
      <p className="text-[13px] text-muted">
        Gift-givers see it as{' '}
        <span className="font-medium text-ink-2">“{titleOf(list ?? { title: '', who })}”</span>
      </p>
      <MoreOptions
        label="Name, occasion and prices"
        summary={`${OCCASION_NAMES[occasion]} · ${currency}`}
      >
        <div className="grid gap-4">
          <Field label="List name" optional htmlFor={`${id}-title`}>
            <Input
              id={`${id}-title`}
              value={list?.title ?? ''}
              maxLength={80}
              placeholder={who ? `${who}’s list` : 'Maya’s list'}
              autoComplete="off"
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </Field>
          <div className="grid gap-2">
            <span className="text-[13.5px] font-medium text-ink-2">Occasion</span>
            <Choices
              label="Occasion"
              value={occasion}
              onChange={(value) => onChange({ occasion: value })}
              options={OCCASIONS.map((option) => ({
                value: option,
                label: OCCASION_NAMES[option],
                icon: OCCASION_ICONS[option],
              }))}
            />
          </div>
          <Field label="Prices in" htmlFor={`${id}-currency`} className="max-w-[160px]">
            <Select
              id={`${id}-currency`}
              value={currency}
              onChange={(event) =>
                onChange({ currency: event.target.value as WishList['currency'] })
              }
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </MoreOptions>
    </Surface>
  );
}

/* ---------------- shared pieces ---------------- */

function ListHeader({
  list,
  giver = false,
  open = 0,
}: {
  list: WishList | GiftList;
  giver?: boolean;
  open?: number;
}) {
  const who = list.who.trim();
  return (
    <Surface className="relative grid gap-3 overflow-hidden">
      <Ribbon />
      <p className="label flex items-center gap-2 pt-1">
        <Tinted name={OCCASION_ICONS[list.occasion]} size={13} color={GOLD} />
        {list.occasion === 'other' ? 'A wish list' : `${OCCASION_NAMES[list.occasion]} list`}
      </p>
      <h2
        className="font-display text-[32px] leading-[1.02] font-extrabold tracking-[-0.03em] text-ink sm:text-[38px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {titleOf(list)}
      </h2>
      {giver && (
        <>
          <p className="text-[15px] leading-relaxed text-ink-2">
            Pick a gift you’ll give. {who || 'They'} won’t see who’s getting what, so the surprise
            is safe.
          </p>
          {list.items.length > 0 && (
            <p className="flex items-center gap-2 text-[14.5px] font-medium text-ink">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ background: open ? 'var(--accent, #ff5e57)' : 'var(--glow, #46c28e)' }}
              />
              {open
                ? `${open} ${open === 1 ? 'gift' : 'gifts'} still open`
                : 'Every gift is claimed'}
            </p>
          )}
        </>
      )}
    </Surface>
  );
}

function WantTag({ want }: { want: Want }) {
  const { icon, color } = WANT_ICONS[want];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
      <Tinted name={icon} size={13} color={color} />
      {WANT_NAMES[want]}
    </span>
  );
}

/** A wish as a gift tag: its color says how much it's wanted. */
function WishCard({
  item,
  currency,
  dim = false,
  mine = false,
  action,
  children,
}: {
  item: WishItem;
  currency: string;
  dim?: boolean;
  mine?: boolean;
  /** A small button in the tag's corner (the owner's Edit). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const domain = item.url && isWebUrl(item.url) ? domainOf(item.url) : '';
  return (
    <li
      className={cn(
        'relative grid gap-3 overflow-hidden rounded-[18px] p-3.5 pl-5 sm:p-4 sm:pl-6',
        mine
          ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-ink))]'
          : dim
            ? 'bg-transparent shadow-[inset_0_0_0_1px_var(--color-line)]'
            : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[5px]', dim && 'opacity-40')}
        style={{ background: WANT_EDGE[item.want] }}
      />
      <div className="flex items-start gap-3">
        <div className={cn('min-w-0 flex-1', dim && 'opacity-60')}>
          <p className="text-[16.5px] leading-snug font-semibold break-words text-ink">
            {nameOf(item)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <WantTag want={item.want} />
            {item.price > 0 && (
              <span
                className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums"
                style={{ background: tint(GOLD, 16), color: GOLD }}
              >
                {formatMoney(item.price, currency)}
              </span>
            )}
          </div>
          {item.note && (
            <p className="mt-2 text-[14px] leading-relaxed break-words text-ink-2">{item.note}</p>
          )}
        </div>
        {action ?? (
          <span
            aria-hidden="true"
            className="mt-1 size-3 shrink-0 rounded-full bg-surface shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]"
          />
        )}
      </div>
      {domain && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex h-10 max-w-full items-center gap-2 justify-self-start rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <Icon name="globe" size={14} className="shrink-0 text-muted" />
          <span className="truncate">{domain}</span>
          <Icon name="arrow-up-right" size={14} className="shrink-0" />
          <span className="sr-only">(opens the shop’s page in a new tab)</span>
        </a>
      )}
      {children}
    </li>
  );
}

function GiverActions({
  name,
  record,
  mine,
  onClaim,
  onRelease,
  onBought,
}: {
  name: string;
  record: Claim | null;
  mine: boolean;
  onClaim: () => void;
  onRelease: () => void;
  onBought: (got: boolean) => void;
}) {
  if (!record) {
    return (
      <button
        type="button"
        onClick={onClaim}
        aria-label={`I’ll get ${name}`}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-signal-soft px-4 text-[15px] font-semibold text-signal-ink shadow-[inset_0_0_0_1px_var(--accent,var(--color-line-strong))] transition-transform active:scale-[.98] sm:h-11 sm:w-auto sm:justify-self-start"
      >
        <Icon name="gift" size={17} /> I’ll get this
      </button>
    );
  }
  if (!mine) {
    return (
      <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
        <Icon name="check-circle" size={16} className="shrink-0 text-positive" />
        <span>
          Claimed by{' '}
          <span className="font-semibold text-ink">{record.name.trim() || 'someone'}</span>
          {record.got && ' · bought'}
        </span>
      </p>
    );
  }
  return (
    <div className="grid gap-2 border-t border-line pt-3 sm:flex sm:items-center">
      <p className="flex min-w-0 flex-1 items-center gap-2 text-[14.5px] font-semibold text-ink">
        <span
          className="grid size-6 place-items-center rounded-full text-[#12110d]"
          style={{ background: 'var(--accent, #ff5e57)' }}
        >
          <Icon name="check" size={13} strokeWidth={3} />
        </span>
        You’re getting this
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={Boolean(record.got)}
          onClick={() => onBought(!record.got)}
          className={cn(
            'inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] px-3.5 text-[14px] font-medium transition-colors sm:flex-none lg:h-10',
            record.got
              ? 'bg-positive-soft text-positive'
              : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
          )}
        >
          <Icon name={record.got ? 'check-circle' : 'circle'} size={15} />
          {record.got ? 'Bought' : 'Mark as bought'}
        </button>
        <button
          type="button"
          onClick={onRelease}
          aria-label={`Unclaim ${name}`}
          className="h-11 rounded-[11px] px-3.5 text-[14px] font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink lg:h-10"
        >
          Unclaim
        </button>
      </div>
    </div>
  );
}

/**
 * A wish: just its name, with a link, a price, a note and how much it's wanted folded under
 * "More options". Adding keeps the field ready for the next one.
 */
function WishForm({
  initial,
  currency,
  submitLabel,
  onSubmit,
  onCancel,
  first = false,
  children,
}: {
  initial: WishDraft;
  currency: string;
  submitLabel: string;
  onSubmit: (wish: Wish) => void;
  onCancel?: () => void;
  /** The very first wish: a bigger field. */
  first?: boolean;
  /** More controls for an existing wish (move, remove). */
  children?: ReactNode;
}) {
  const id = useId();
  const [draft, setDraft] = useState<WishDraft>(initial);
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({});
  // Remounting the extras clears them (and closes them) after an add.
  const [round, setRound] = useState(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const change = (patch: Partial<WishDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const extrasSet = Boolean(
    draft.url || draft.price || draft.note || draft.want !== EMPTY_DRAFT.want,
  );
  const summary = [
    draft.url && isWebUrl(draft.url) ? domainOf(draft.url) : draft.url ? 'a link' : '',
    draft.price ? formatMoney(draft.price, currency) : '',
    draft.want !== EMPTY_DRAFT.want ? WANT_NAMES[draft.want] : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = checkDraft(draft);
    setErrors(checked.errors);
    if (!checked.wish) {
      if (checked.errors.name) nameInput.current?.focus();
      else {
        const details = document.getElementById(`${id}-more`)?.querySelector('details');
        if (details) details.open = true;
        document.getElementById(`${id}-url`)?.focus();
      }
      return;
    }
    onSubmit(checked.wish);
    if (!onCancel) {
      setDraft(EMPTY_DRAFT);
      setRound((value) => value + 1);
      nameInput.current?.focus();
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-2">
      <div className="flex gap-2">
        <label htmlFor={`${id}-name`} className="sr-only">
          {onCancel ? 'What is it?' : 'Add a wish'}
        </label>
        <input
          ref={nameInput}
          id={`${id}-name`}
          value={draft.name}
          maxLength={120}
          placeholder={first ? 'I’d love…' : 'Add another wish'}
          enterKeyHint="done"
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? `${id}-name-error` : undefined}
          onChange={(event) => {
            change({ name: event.target.value });
            if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
          }}
          className={cn(
            'w-0 min-w-0 flex-1 rounded-[14px] bg-surface px-3.5 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]',
            first ? 'h-14 text-[17px]' : 'h-12 text-[16px] lg:h-11 lg:text-[15px]',
            errors.name && 'shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
          )}
        />
        {!onCancel && (
          <button
            type="submit"
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[14px] px-4 font-semibold text-[#12110d] transition-transform active:scale-95',
              first ? 'h-14 text-[16px]' : 'h-12 text-[15px] lg:h-11',
            )}
            style={{ background: 'var(--accent, var(--color-ink))' }}
          >
            <Icon name="plus" size={18} /> {submitLabel}
          </button>
        )}
      </div>
      {errors.name && (
        <p id={`${id}-name-error`} className="text-[13px] text-critical">
          {errors.name}
        </p>
      )}
      <MoreOptionsBox
        key={round}
        id={`${id}-more`}
        open={Boolean(onCancel) && extrasSet}
        label={onCancel ? 'Link, price, note' : 'Add a link, price or note'}
        summary={summary}
      >
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_148px]">
            <Field
              label="Link"
              optional
              htmlFor={`${id}-url`}
              error={errors.url}
              hint="Paste it from the shop."
            >
              <Input
                id={`${id}-url`}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={draft.url}
                maxLength={2000}
                placeholder="https://"
                aria-invalid={Boolean(errors.url)}
                onChange={(event) => change({ url: event.target.value })}
                onBlur={() => {
                  const read = readUrl(draft.url);
                  if ('error' in read) setErrors((current) => ({ ...current, url: read.error }));
                  else {
                    setErrors((current) => ({ ...current, url: undefined }));
                    if (read.url !== draft.url) change({ url: read.url });
                  }
                }}
              />
            </Field>
            <Field label="Price" optional htmlFor={`${id}-price`}>
              <MoneyInput
                key={currency}
                id={`${id}-price`}
                label="Price"
                value={draft.price}
                currency={currency}
                onChange={(price) => change({ price })}
              />
            </Field>
          </div>
          <Field label="Note" optional htmlFor={`${id}-note`}>
            <Input
              id={`${id}-note`}
              value={draft.note}
              maxLength={200}
              placeholder="Size M, dark green, anything but white"
              onChange={(event) => change({ note: event.target.value })}
            />
          </Field>
          <div className="grid gap-2">
            <span className="text-[13.5px] font-medium text-ink-2">How much you want it</span>
            <div
              role="radiogroup"
              aria-label="How much you want it"
              className="flex flex-wrap gap-1.5"
            >
              {WANTS.map((want) => {
                const on = draft.want === want;
                return (
                  <button
                    key={want}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => change({ want })}
                    className={cn(
                      'inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-colors lg:h-10 lg:text-[13.5px]',
                      on
                        ? 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)]'
                        : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
                    )}
                  >
                    <Tinted name={WANT_ICONS[want].icon} size={14} color={WANT_ICONS[want].color} />
                    {WANT_NAMES[want]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </MoreOptionsBox>
      {onCancel && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            className="inline-flex h-11 items-center gap-2 rounded-[11px] px-4 text-[14.5px] font-semibold text-[#12110d] lg:h-10"
            style={{ background: 'var(--accent, var(--color-ink))' }}
          >
            <Icon name="check" size={16} /> {submitLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-[11px] px-4 text-[14.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-10"
          >
            Cancel
          </button>
        </div>
      )}
      {children}
    </form>
  );
}

/** MoreOptions with an id, so a problem inside can open it. */
function MoreOptionsBox({
  id,
  open,
  label,
  summary,
  children,
}: {
  id: string;
  open: boolean;
  label: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className="contents">
      <MoreOptions label={label} summary={summary || undefined} defaultOpen={open}>
        {children}
      </MoreOptions>
    </div>
  );
}

/* ---------------- the gate ---------------- */

function Gate({
  list,
  onGiver,
  onOwner,
}: {
  list: GiftList;
  onGiver: () => void;
  onOwner: () => void;
}) {
  return (
    <Surface className="relative mx-auto grid w-full max-w-[680px] justify-items-center gap-6 overflow-hidden px-5 py-10 text-center sm:px-10 sm:py-14">
      <Ribbon />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(60% 45% at 50% 0%, ${tint('var(--accent, #ff5e57)', 16)}, transparent 70%)`,
        }}
      />
      <TagArt />
      <div className="relative grid gap-3">
        <p className="label">{titleOf(list)}</p>
        <h2
          className="font-display text-[30px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance text-ink sm:text-[38px]"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          Are you picking a gift?
        </h2>
        <p className="text-[16px] leading-relaxed text-pretty text-ink-2">
          This link shows who’s getting what. If it’s your own list, stop here to keep the surprise.
        </p>
      </div>
      <div className="relative grid w-full gap-2 sm:max-w-[420px]">
        <ActionButton icon="gift" onClick={onGiver}>
          I’m a gift-giver
        </ActionButton>
        <ActionButton icon="eye-off" variant="quiet" onClick={onOwner}>
          It’s my list
        </ActionButton>
      </div>
      <p className="relative text-[12.5px] text-muted">You’ll only be asked once.</p>
    </Surface>
  );
}

/* ---------------- after claiming, and sharing ---------------- */

function SendOn({
  names,
  owner,
  link,
  title,
  onDone,
}: {
  names: string[];
  owner: string;
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
  const fill = { background: 'var(--accent, var(--color-ink))' };
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 animate-rise rounded-[20px] bg-surface p-4 shadow-pop lg:inset-x-0 lg:bottom-6 lg:mx-auto lg:w-[min(560px,calc(100%-48px))]"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full text-[#12110d]"
          style={{ background: 'var(--accent, #ff5e57)' }}
        >
          <Icon name="gift" size={16} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[15px] leading-snug font-semibold text-ink">
            You’re getting {joinNames(names)}.
          </p>
          <p className="mt-0.5 text-[13.5px] leading-snug text-muted">
            Pass the updated link to the other gift-givers{owner ? `, not to ${owner},` : ''} so
            nobody doubles up.
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
            style={fill}
          >
            <Icon name="share" size={16} /> Pass it on
          </button>
        )}
        <button
          type="button"
          disabled={!link}
          onClick={copy}
          className={canShare ? quiet : solid}
          style={canShare ? undefined : fill}
        >
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
            Got another link? Combine it
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
              A gift-giver link to combine
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
              className="h-11 w-0 min-w-0 flex-1 rounded-[10px] bg-surface px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:h-10 lg:text-[14.5px]"
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

function GivenLists({
  lists,
  viewing,
  ownTitle,
  onOpen,
  onOpenOwn,
  onForget,
}: {
  lists: Given[];
  viewing: string | null;
  ownTitle: string | null;
  onOpen: (listId: string) => void;
  onOpenOwn: () => void;
  onForget: (listId: string) => void;
}) {
  if (!lists.length) return null;
  const detail = (entry: Given) => {
    if (entry.role === 'owner') return 'Your list · claims hidden';
    if (entry.role === 'ask') return 'Not opened yet';
    const { total, claimed } = giftProgress(entry.list);
    return `You’re a gift-giver · ${claimed} of ${total} claimed`;
  };
  return (
    <Surface className="grid gap-3">
      <Label>Your lists</Label>
      <ul className="grid gap-1">
        {viewing !== null && (
          <li>
            <button
              type="button"
              onClick={onOpenOwn}
              className="min-h-12 w-full rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-ink/5"
            >
              <span className="block truncate text-[14px] font-medium text-ink">
                {ownTitle ?? 'Make your own list'}
              </span>
              <span className="block text-[12px] text-muted">
                {ownTitle ? 'Your list' : 'Start a wish list of your own'}
              </span>
            </button>
          </li>
        )}
        {lists.map((entry) => {
          const active = entry.list.id === viewing;
          const title = titleOf(entry.list);
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
                <span className="block text-[12px] text-muted">{detail(entry)}</span>
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
      title={itemName ? `You’re getting ${itemName}` : 'Your name on claims'}
      description="Other gift-givers see this name. Leave it blank to show “Someone”."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`}>
            {itemName ? 'Claim it' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(name);
        }}
        className="grid gap-3 pt-1"
      >
        <Field label="Your name" optional htmlFor={`${id}-name`} hint="You’re only asked once.">
          <Input
            id={`${id}-name`}
            data-autofocus
            value={name}
            maxLength={40}
            autoComplete="given-name"
            placeholder="Someone"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}
