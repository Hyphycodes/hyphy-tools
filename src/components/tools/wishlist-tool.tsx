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
import { CopyButton, IconButton, Label, Note, Surface } from './kit';
import { MoneyInput } from './money-input';
import { ShareLinkCard } from './share-link';

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
          <Label>Wishes · {list.items.length}</Label>
          <ul className="grid gap-2.5">
            {list.items.map((item) => (
              <WishCard key={item.id} item={item} currency={list.currency} />
            ))}
          </ul>
        </Surface>
      </div>
      <aside aria-label="Your list" className="grid gap-4 lg:sticky lg:top-24">
        <Surface className="grid gap-3">
          <h2 className="text-[16px] font-semibold text-ink">Make changes from this device</h2>
          <p className="text-[13.5px] leading-relaxed text-muted">
            Keeps the list in this browser so you can edit it and share a new link. Claims stay out
            of it.
          </p>
          <Button variant="primary" size="lg" onClick={onAdopt}>
            <Icon name="pencil" size={16} /> Edit it on this device
          </Button>
        </Surface>
        {deviceLists}
        <button
          type="button"
          onClick={onShowAsGiver}
          className="justify-self-start px-1 text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
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
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)] lg:items-start">
      <div className="grid min-w-0 gap-5">
        {notices}
        <ListHeader list={list} giver />
        <Surface className="grid gap-4">
          <Label>Wishes · {list.items.length}</Label>
          {list.items.length === 0 ? (
            <p className="text-[14px] text-muted">Nothing on this list yet.</p>
          ) : (
            <ul className="grid gap-2.5">
              {list.items.map((item) => {
                const record = holder(list.claims[item.id]);
                return (
                  <WishCard
                    key={item.id}
                    item={item}
                    currency={list.currency}
                    dim={Boolean(record && record.by !== me?.id)}
                  >
                    <GiverActions
                      name={nameOf(item)}
                      record={record}
                      mine={Boolean(record && me && record.by === me.id)}
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
                className="mt-1 font-display text-[44px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                style={{ fontVariationSettings: "'wdth' 110" }}
              >
                {claimed}
                <span className="text-faint"> of {total}</span>
              </p>
            </div>
            <p className="pb-1 text-right text-[13.5px] leading-snug text-muted">
              {bought ? `${bought} bought` : total - claimed ? `${total - claimed} open` : ''}
            </p>
          </div>
          <Progress
            value={total ? (claimed / total) * 100 : 0}
            color="var(--accent, var(--color-ink))"
            label="Claimed so far"
          />
          {me && (
            <p className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
              <span className="min-w-0 truncate">
                Claiming as{' '}
                <span className="font-medium text-ink-2">{me.name.trim() || 'Someone'}</span>
              </span>
              <button
                type="button"
                onClick={onAskName}
                className="h-9 shrink-0 font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
              >
                Change name
              </button>
            </p>
          )}
        </Surface>

        <Surface className="grid gap-4">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">Pass the link along</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
              Claims live in the link. After you claim something, send the updated link to the other
              gift-givers{owner ? `, not to ${owner},` : ''} so nobody buys the same thing twice.
            </p>
          </div>
          <ShareLinkCard
            key={version}
            title={titleOf(list)}
            cta="Get the updated link"
            build={() => linkFor(list)}
          />
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
  const [editing, setEditing] = useState<string | null>(null);
  const [removal, setRemoval] = useState<WishRemoval | null>(null);
  const list = own.list;
  const items = list?.items ?? [];
  const currency = list?.currency ?? 'USD';
  const loves = items.filter((item) => item.want === 'love').length;
  const changed = Boolean(list && own.shared !== null && list.edited > own.shared);

  useEffect(() => {
    if (!removal) return;
    const timer = setTimeout(() => setRemoval(null), 12_000);
    return () => clearTimeout(timer);
  }, [removal]);

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
          <Label>Wishes{items.length ? ` · ${items.length}` : ''}</Label>
          {items.length === 0 && (
            <div className="grid justify-items-start gap-3 rounded-[16px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <p className="text-[14px] leading-relaxed text-ink-2">
                Add what you’d love below: a link, a price, a note, how much you want it. Or see how
                a finished list looks first.
              </p>
              <button
                type="button"
                onClick={onSample}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-10"
              >
                <Icon name="sparkles" size={15} /> Try a sample list
              </button>
            </div>
          )}
          {items.length > 0 && (
            <ul className="grid gap-2.5">
              {items.map((item, index) =>
                editing === item.id ? (
                  <li
                    key={item.id}
                    className="rounded-[16px] bg-subtle p-3.5 shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] sm:p-4"
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
                    />
                  </li>
                ) : (
                  <WishCard key={item.id} item={item} currency={currency}>
                    <div className="flex items-center justify-end gap-1 border-t border-line pt-2">
                      <IconButton
                        icon="pencil"
                        label={`Edit ${nameOf(item)}`}
                        onClick={() => setEditing(item.id)}
                        className="!size-11 lg:!size-9"
                      />
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
                      <IconButton
                        icon="trash"
                        tone="danger"
                        label={`Remove ${nameOf(item)}`}
                        onClick={() => {
                          setRemoval(onRemove(item.id));
                          if (editing === item.id) setEditing(null);
                        }}
                        className="!size-11 lg:!size-9"
                      />
                    </div>
                  </WishCard>
                ),
              )}
            </ul>
          )}
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
          <div className="grid gap-3 border-t border-line pt-4">
            <h3 className="text-[15px] font-semibold text-ink">Add a wish</h3>
            {items.length >= MAX_ITEMS ? (
              <Note icon="alert">
                That’s {MAX_ITEMS} wishes, as many as one list holds. Remove one to add another.
              </Note>
            ) : (
              <WishForm
                initial={EMPTY_DRAFT}
                currency={currency}
                submitLabel="Add to the list"
                onSubmit={onAdd}
              />
            )}
          </div>
        </Surface>
      </div>

      <aside aria-label="Sharing" className="grid gap-4 lg:sticky lg:top-24">
        <Surface className="relative grid gap-4 overflow-hidden">
          <Ribbon />
          <div>
            <p className="label">Gift-giver link</p>
            <h2 className="mt-1.5 text-[17px] font-semibold text-ink">
              Share it with family and friends
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
              They claim what they’ll give and pass the link along, so nobody buys the same thing
              twice. You never see who claimed what.
            </p>
          </div>
          {list && items.length > 0 ? (
            <>
              <ShareLinkCard
                key={list.edited}
                title={titleOf(list)}
                cta="Get the gift-giver link"
                build={() => {
                  onShared(list.edited);
                  return linkFor(toGift(list));
                }}
              />
              <Note icon="eye-off" tone="caution">
                Not for you: don’t open it yourself as a gift-giver, or you’ll see what’s been
                claimed.
              </Note>
              {changed && (
                <Note icon="refresh">
                  You’ve changed the list since you last shared it. Share the new link: gift-givers
                  who open it on the same device keep the claims they’ve seen, and the newest link
                  carries your list.
                </Note>
              )}
            </>
          ) : (
            <p className="text-[13.5px] text-muted">Add a wish or two first.</p>
          )}
        </Surface>

        {list && items.length > 0 && (
          <Surface className="grid gap-3">
            <p className="text-[14px] text-ink-2">
              <span className="font-semibold text-ink">
                {items.length} {items.length === 1 ? 'wish' : 'wishes'}
              </span>
              {loves > 0 && `, ${loves} you’d love`}. Saved in this browser.
            </p>
            <CopyButton
              text={wishText(list)}
              label="Copy the list as text"
              what="List copied (no claims in it)"
              className="!h-11 w-full lg:!h-10"
            />
          </Surface>
        )}

        {deviceLists}

        {list && (
          <button
            type="button"
            onClick={onStartOver}
            className="justify-self-start px-1 text-[13.5px] text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Start a new list
          </button>
        )}
      </aside>
    </div>
  );
}

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

function HeaderEditor({
  list,
  onChange,
}: {
  list: WishList | null;
  onChange: (details: Details) => void;
}) {
  const id = useId();
  const who = list?.who.trim() ?? '';
  return (
    <Surface className="relative grid gap-4 overflow-hidden">
      <Ribbon />
      <input
        aria-label="List name"
        placeholder={who ? `${who}’s list` : 'Maya’s list'}
        value={list?.title ?? ''}
        maxLength={80}
        onChange={(event) => onChange({ title: event.target.value })}
        className="h-12 min-w-0 rounded-[12px] bg-transparent px-1 font-display text-[24px] font-bold tracking-[-0.02em] text-ink outline-none placeholder:text-faint focus:bg-subtle focus:px-3"
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_132px]">
        <Field label="Whose list?" htmlFor={`${id}-who`} hint="Gift-givers see this name.">
          <Input
            id={`${id}-who`}
            value={list?.who ?? ''}
            maxLength={40}
            placeholder="Maya"
            autoComplete="off"
            onChange={(event) => onChange({ who: event.target.value })}
          />
        </Field>
        <Field label="Prices in" htmlFor={`${id}-currency`}>
          <Select
            id={`${id}-currency`}
            value={list?.currency ?? 'USD'}
            onChange={(event) => onChange({ currency: event.target.value as WishList['currency'] })}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-2">
        <span id={`${id}-occasion`} className="text-[13.5px] font-medium text-ink-2">
          Occasion
        </span>
        <div
          role="radiogroup"
          aria-labelledby={`${id}-occasion`}
          className="flex flex-wrap gap-1.5"
        >
          {OCCASIONS.map((occasion) => {
            const on = (list?.occasion ?? 'christmas') === occasion;
            return (
              <button
                key={occasion}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ occasion })}
                className={cn(
                  'inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-colors lg:h-9 lg:text-[13.5px]',
                  on ? 'bg-ink text-on-ink' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
                )}
              >
                <Icon name={OCCASION_ICONS[occasion]} size={14} />
                {OCCASION_NAMES[occasion]}
              </button>
            );
          })}
        </div>
      </div>
    </Surface>
  );
}

/* ---------------- shared pieces ---------------- */

function ListHeader({ list, giver = false }: { list: WishList | GiftList; giver?: boolean }) {
  const who = list.who.trim();
  return (
    <Surface className="relative grid gap-3 overflow-hidden">
      <Ribbon />
      <p className="label flex items-center gap-2">
        <Tinted name={OCCASION_ICONS[list.occasion]} size={13} color={GOLD} />
        {list.occasion === 'other' ? 'A wish list' : OCCASION_NAMES[list.occasion]}
        {giver && ' · gift-giver view'}
      </p>
      <h2
        className="font-display text-[30px] leading-[1.02] font-extrabold tracking-[-0.03em] text-ink sm:text-[38px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {titleOf(list)}
      </h2>
      {giver && (
        <p className="text-[14.5px] leading-relaxed text-ink-2">
          Claim what you’ll give. {who || 'The owner'} never sees who claimed what; the other
          gift-givers do, once you pass the link along.
        </p>
      )}
    </Surface>
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

function WantTag({ want }: { want: Want }) {
  const { icon, color } = WANT_ICONS[want];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
      <Tinted name={icon} size={13} color={color} />
      {WANT_NAMES[want]}
    </span>
  );
}

function WishCard({
  item,
  currency,
  dim = false,
  children,
}: {
  item: WishItem;
  currency: string;
  dim?: boolean;
  children?: ReactNode;
}) {
  const domain = item.url && isWebUrl(item.url) ? domainOf(item.url) : '';
  return (
    <li
      className={cn(
        'grid gap-3 rounded-[16px] bg-subtle p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-4',
        dim && 'bg-transparent',
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('min-w-0 flex-1', dim && 'opacity-60')}>
          <p className="text-[16px] leading-snug font-semibold break-words text-ink">
            {nameOf(item)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <WantTag want={item.want} />
          </div>
          {item.note && (
            <p className="mt-2 text-[14px] leading-relaxed break-words text-ink-2">{item.note}</p>
          )}
        </div>
        {item.price > 0 && (
          <p
            className={cn(
              'mono-num shrink-0 pt-0.5 text-[15px] font-semibold text-ink',
              dim && 'opacity-60',
            )}
          >
            {formatMoney(item.price, currency)}
          </p>
        )}
      </div>
      {domain && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex h-11 max-w-full items-center gap-2 justify-self-start rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-9"
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
      <div className="flex justify-end border-t border-line pt-3">
        <button
          type="button"
          onClick={onClaim}
          aria-label={`I’ll get ${name}`}
          className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-well px-4 text-[14.5px] font-semibold text-ink transition-colors hover:bg-ink/10 max-sm:w-full max-sm:justify-center lg:h-10"
        >
          <Tinted name="gift" size={16} color="var(--accent, #ff5e57)" /> I’ll get this
        </button>
      </div>
    );
  }
  if (!mine) {
    return (
      <p className="flex items-center gap-2 border-t border-line pt-3 text-[13.5px] text-ink-2">
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
      <p className="flex min-w-0 flex-1 items-center gap-2 text-[14px] font-semibold text-ink">
        <Tinted name="gift" size={16} color="var(--accent, #ff5e57)" />
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

function WishForm({
  initial,
  currency,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: WishDraft;
  currency: string;
  submitLabel: string;
  onSubmit: (wish: Wish) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<WishDraft>(initial);
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({});
  // Remounting the price field clears it after an add (it keeps its own text while focused).
  const [round, setRound] = useState(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const change = (patch: Partial<WishDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = checkDraft(draft);
    setErrors(checked.errors);
    if (!checked.wish) {
      (checked.errors.name ? nameInput.current : document.getElementById(`${id}-url`))?.focus();
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
    <form onSubmit={submit} noValidate className="grid gap-3">
      <Field label="What is it?" htmlFor={`${id}-name`} error={errors.name}>
        <Input
          ref={nameInput}
          id={`${id}-name`}
          value={draft.name}
          maxLength={120}
          placeholder="Merino hiking socks"
          aria-invalid={Boolean(errors.name)}
          onChange={(event) => change({ name: event.target.value })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_148px]">
        <Field
          label="Link"
          optional
          htmlFor={`${id}-url`}
          error={errors.url}
          hint="Paste it from the shop. Only the address is kept; nothing is fetched."
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
            key={`${round}-${currency}`}
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
        <span id={`${id}-want`} className="text-[13.5px] font-medium text-ink-2">
          How much you want it
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-want`} className="flex flex-wrap gap-1.5">
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
                  'inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-colors lg:h-9 lg:text-[13.5px]',
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
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="submit"
          className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-ink px-4 text-[14.5px] font-semibold text-on-ink transition-colors hover:bg-ink-2 lg:h-10"
        >
          <Icon name={onCancel ? 'check' : 'plus'} size={16} /> {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-[11px] px-4 text-[14.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-10"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
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
        className="pointer-events-none absolute -top-28 left-1/2 size-72 -translate-x-1/2 rounded-full opacity-[.14] blur-3xl"
        style={{ background: 'var(--accent, #ff5e57)' }}
      />
      <span
        className="relative grid size-16 place-items-center rounded-full text-[#12110d] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]"
        style={{ background: 'var(--accent, #ff5e57)' }}
      >
        <Icon name="gift" size={28} />
      </span>
      <div className="relative grid gap-3">
        <p className="label">Gift-giver link</p>
        <h2
          className="font-display text-[28px] leading-[1.05] font-extrabold tracking-[-0.03em] text-ink sm:text-[36px]"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          This is the gift-giver view of {titleOf(list)}.
        </h2>
        <p className="text-[16px] leading-relaxed text-ink-2">
          If it’s your list, stop here to keep the surprise.
        </p>
      </div>
      <div className="relative grid w-full gap-2 sm:flex sm:w-auto sm:justify-center">
        <button
          type="button"
          onClick={onGiver}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[12px] bg-ink px-6 text-[15.5px] font-semibold text-on-ink transition-colors hover:bg-ink-2"
        >
          <Icon name="gift" size={17} /> I’m a gift-giver
        </button>
        <button
          type="button"
          onClick={onOwner}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[12px] bg-well px-6 text-[15.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <Icon name="eye-off" size={17} /> It’s my list
        </button>
      </div>
      <p className="relative text-[12.5px] text-muted">
        This device remembers your answer for this list.
      </p>
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
    'inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-well px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-50 lg:h-10';
  const solid =
    'inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-ink px-4 text-[14px] font-semibold text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-50 lg:h-10';
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
            Opening a link on this device already combines its claims with the ones here. You can
            also paste one to fold it in without leaving the page.
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
      <Label>Lists on this device</Label>
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
        <Field
          label="Your name"
          optional
          htmlFor={`${id}-name`}
          hint="Saved in this browser, so you’re only asked once."
        >
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
