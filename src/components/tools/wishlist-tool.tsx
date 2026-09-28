'use client';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input, Select } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/toast';
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
  type Claimer,
} from '@/lib/tools/claims';
import { CURRENCIES } from '@/lib/tools/split';
import {
  addWish,
  answerGate,
  changeGiven,
  editWish,
  EMPTY_DRAFT,
  EMPTY_GIVEN,
  EMPTY_OWNER,
  giftListSchema,
  giftProgress,
  givenStoreSchema,
  MAX_ITEMS,
  mergeOwn,
  moveWish,
  newWishList,
  OCCASION_NAMES,
  OCCASIONS,
  ownerStoreSchema,
  receiveGift,
  removeWish,
  restoreWish,
  sampleList,
  setWishDetails,
  titleOf,
  toGift,
  WANTS,
  wishText,
  withoutClaims,
  type GiftList,
  type Given,
  type GivenStore,
  type Occasion,
  type OwnerStore,
  type Wish,
  type WishList,
  type WishRemoval,
} from '@/lib/tools/wishlist';
import {
  ActionBar,
  ActionButton,
  Choices,
  CopyButton,
  IconButton,
  MoreOptions,
  Note,
  SampleButton,
  Surface,
} from './kit';
import {
  Combine,
  GiverActions,
  GOLD,
  GOLD_INK,
  joinNames,
  LinkExtras,
  ListsCard,
  NameSheet,
  nameOf,
  Parchment,
  PINE,
  SendOn,
  SentMark,
  TagArt,
  tint,
  useSendLink,
  WishForm,
  WishTag,
  type Combined,
} from './wishlist-parts';

/*
 * Christmas List: the owner makes a wish list (kept in this browser) and shares a gift-giver
 * link. Gift-givers claim gifts in their copies of the link and pass it along; copies merge by
 * the rules in lib/tools/claims. The owner's view never shows claims: their list has none in
 * it, and a gift-giver link opened by its owner is shown with the claims left out.
 */

const OCCASION_ICONS: Record<Occasion, IconName> = {
  christmas: 'snowflake',
  birthday: 'party',
  wedding: 'heart',
  baby: 'sparkles',
  other: 'gift',
};

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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,.8fr)] lg:items-start">
      <div className="grid min-w-0 gap-4">
        {notices}
        <Note icon="eye-off">Your list, with the claims left out so the surprise survives.</Note>
        <Parchment>
          <ListHeader list={list} />
          <ul className="mt-7 grid gap-3">
            {list.items.map((item, index) => (
              <WishTag key={item.id} item={item} currency={list.currency} order={index} />
            ))}
          </ul>
        </Parchment>
      </div>
      <aside aria-label="Your list" className="grid min-w-0 gap-4 lg:sticky lg:top-24">
        <Surface className="grid gap-3">
          <h2 className="text-[16px] font-semibold text-ink">Want to change it?</h2>
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
  const toast = useToast();
  const send = useSendLink();
  const [sent, setSent] = useState<{ version: string; how: 'shared' | 'copied' } | null>(null);
  const { total, claimed, bought } = giftProgress(list);
  const owner = list.who.trim();
  const find = (itemId: string | null) => list.items.find((item) => item.id === itemId);
  const askingItem = asking?.itemId ? find(asking.itemId) : undefined;
  const mine = me ? heldBy(list.claims, me.id) : [];
  const fresh = sent?.version === version ? sent.how : null;

  const passOn = async () => {
    if (!link) return null;
    const how = await send(link, titleOf(list));
    if (how === 'shared' || how === 'copied') setSent({ version, how });
    if (how === 'failed')
      toast({ title: 'Couldn’t copy. Copy the address bar instead.', icon: 'alert' });
    return how;
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,.8fr)] lg:items-start">
      <div className="grid min-w-0 gap-4">
        {notices}
        <Parchment>
          <ListHeader list={list} giver open={total - claimed} />
          <h2 className="sr-only">Tap a gift you’ll give</h2>
          {list.items.length === 0 ? (
            <p className="mt-6 text-center text-[15px] text-muted">Nothing on this list yet.</p>
          ) : (
            <ul className="mt-7 grid gap-3">
              {list.items.map((item, index) => {
                const record = holder(list.claims[item.id]);
                const isMine = Boolean(record && me && record.by === me.id);
                return (
                  <WishTag
                    key={item.id}
                    item={item}
                    currency={list.currency}
                    face={record ? (isMine ? 'mine' : 'taken') : 'open'}
                    dim={Boolean(record && !isMine)}
                    mine={isMine}
                    order={index}
                  >
                    <GiverActions
                      name={nameOf(item)}
                      record={record}
                      mine={isMine}
                      onClaim={() => onClaim(item.id)}
                      onRelease={() => onRelease(item.id)}
                      onBought={(got) => onBought(item.id, got)}
                    />
                  </WishTag>
                );
              })}
            </ul>
          )}
        </Parchment>
      </div>

      <aside aria-label="Claims and sharing" className="grid min-w-0 gap-4 lg:sticky lg:top-24">
        <section className="relative grid gap-5 overflow-clip rounded-[24px] bg-surface px-5 pt-8 pb-5 shadow-lift sm:px-6">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[5px]"
            style={{ background: 'var(--accent, #ff5e57)' }}
          />
          {fresh ? (
            <SentMark
              title={fresh === 'shared' ? 'Passed on' : 'Link copied'}
              line={`Send it to the other givers${owner ? `, not ${owner}` : ''}.`}
            />
          ) : (
            <div className="grid gap-3">
              <div className="flex items-end justify-between gap-3">
                <p aria-live="polite" aria-atomic="true" className="text-[15px] text-ink-2">
                  <span
                    className="font-display text-[40px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                    style={{ fontVariationSettings: "'wdth' 110" }}
                  >
                    {claimed}
                  </span>{' '}
                  of {total} claimed
                </p>
                {bought > 0 && <p className="pb-1 text-[13.5px] text-muted">{bought} bought</p>}
              </div>
              <Progress
                value={total ? (claimed / total) * 100 : 0}
                color="var(--accent, var(--color-ink))"
                label="Claimed so far"
              />
              <p className="text-[14px] leading-snug text-ink-2">
                {mine.length
                  ? `You’re getting ${joinNames(mine.map((itemId) => nameOf(find(itemId))))}. `
                  : ''}
                Pass it to the other givers{owner ? `, not ${owner}` : ''}.
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <ActionButton icon="send" disabled={!link} onClick={() => void passOn()}>
              {!link ? 'Getting the link…' : fresh ? 'Pass it on again' : 'Pass it on'}
            </ActionButton>
            <LinkExtras key={version} link={link} />
          </div>
        </section>

        <Surface className="!py-2">
          <MoreOptions
            label="More"
            summary={me ? `You’re ${me.name.trim() || 'Someone'}` : undefined}
          >
            <div className="grid gap-4 pb-3">
              <Combine onCombine={onCombine} />
              {me && (
                <p className="flex min-h-11 items-center gap-2.5 text-[13.5px] text-muted">
                  <Icon name="user" size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    Claiming as {me.name.trim() || 'Someone'}
                  </span>
                  <button
                    type="button"
                    onClick={onAskName}
                    className="h-10 shrink-0 rounded-full px-3 font-medium text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink"
                  >
                    Change name
                  </button>
                </p>
              )}
            </div>
          </MoreOptions>
        </Surface>
        {deviceLists}
      </aside>

      {sending.length > 0 && (
        <SendOn
          key={sending.join('.')}
          names={sending.map((itemId) => nameOf(find(itemId)))}
          owner={owner}
          link={link}
          onSend={passOn}
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
  const toast = useToast();
  const send = useSendLink();
  const [editing, setEditing] = useState<string | null>(null);
  const [removal, setRemoval] = useState<WishRemoval | null>(null);
  const [made, setMade] = useState<{ edited: number; url: string } | null>(null);
  /** Sent from this page just now: the moment gets its stamp. */
  const [sentNow, setSentNow] = useState<{ edited: number; how: 'shared' | 'copied' } | null>(null);
  const list = own.list;
  const items = list?.items ?? [];
  const currency = list?.currency ?? 'USD';
  const changed = Boolean(list && own.shared !== null && list.edited > own.shared);
  const shared = Boolean(list && own.shared !== null && !changed);
  const giftLink = list && made?.edited === list.edited ? made.url : null;
  const fresh = list && sentNow?.edited === list.edited ? sentNow.how : null;

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

  const sendToGivers = async () => {
    if (!list || !giftLink) return;
    const how = await send(giftLink, titleOf(list));
    if (how === 'shared' || how === 'copied') {
      onShared(list.edited);
      setSentNow({ edited: list.edited, how });
      if (!window.matchMedia('(min-width: 1024px)').matches)
        document
          .getElementById(`${id}-share`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (how === 'failed') toast({ title: 'Couldn’t copy. Use Copy link instead.', icon: 'alert' });
  };

  if (items.length === 0 && !removal) {
    return (
      <div className="mx-auto grid w-full max-w-[760px] gap-5">
        {notices}
        <Parchment className="text-center">
          <TagArt />
          <h2
            className="mt-4 font-display text-[32px] leading-[1] font-extrabold tracking-[-0.035em] text-balance text-ink sm:text-[42px]"
            style={{ fontVariationSettings: "'wdth' 110" }}
          >
            What’s on your list?
          </h2>
          <div className="mx-auto mt-7 grid max-w-[560px] gap-5 text-left">
            <WishForm
              initial={EMPTY_DRAFT}
              currency={currency}
              submitLabel="Add"
              onSubmit={onAdd}
              first
            />
            <div className="flex flex-wrap justify-center gap-2">
              {STARTERS.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => addName(name)}
                  style={{ '--i': index } as CSSProperties}
                  className="fx-rise inline-flex h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14.5px] font-medium text-ink transition-[background-color,transform] hover:bg-ink/10 active:scale-[.96]"
                >
                  <span className="inline-flex text-[var(--accent-ink)]">
                    <Icon name="gift" size={14} />
                  </span>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-6">
            <SampleButton onClick={onSample}>See a finished list first</SampleButton>
          </div>
        </Parchment>
        {deviceLists}
      </div>
    );
  }

  const cycle = (item: WishList['items'][number]) => {
    const next = WANTS[(WANTS.indexOf(item.want) + 1) % WANTS.length];
    onEdit(item.id, {
      name: item.name,
      url: item.url,
      price: item.price,
      note: item.note,
      want: next,
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,.8fr)] lg:items-start">
      <div className="grid min-w-0 gap-4">
        {notices}
        {ownLink && (
          <Note icon="eye-off" tone="positive">
            That link is to your own list, so its claims stay hidden. Any changes to the list came
            in.
          </Note>
        )}
        <Parchment>
          <HeaderEditor list={list} onChange={onDetails} />

          <h2 className="sr-only">Your wishes</h2>
          <ul className="mt-7 grid gap-3">
            {items.map((item, index) =>
              editing === item.id ? (
                <li
                  key={item.id}
                  className="fx-pop rounded-[20px] bg-subtle p-3.5 shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] sm:p-4"
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
                    <div className="flex items-center gap-1.5 border-t border-line pt-3">
                      <IconButton
                        icon="arrow-up"
                        label={`Move ${nameOf(item)} up`}
                        disabled={index === 0}
                        onClick={() => onMove(item.id, -1)}
                        className="!size-11 !rounded-full bg-well"
                      />
                      <IconButton
                        icon="arrow-down"
                        label={`Move ${nameOf(item)} down`}
                        disabled={index === items.length - 1}
                        onClick={() => onMove(item.id, 1)}
                        className="!size-11 !rounded-full bg-well"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setRemoval(onRemove(item.id));
                          setEditing(null);
                        }}
                        className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-muted transition-colors hover:bg-critical-soft hover:text-critical"
                      >
                        <Icon name="trash" size={15} /> Remove
                      </button>
                    </div>
                  </WishForm>
                </li>
              ) : (
                <WishTag
                  key={item.id}
                  item={item}
                  currency={currency}
                  order={index}
                  onCycle={() => cycle(item)}
                  action={
                    <IconButton
                      icon="pencil"
                      label={`Edit ${nameOf(item)}`}
                      onClick={() => setEditing(item.id)}
                      className="!size-11 !rounded-full"
                    />
                  }
                />
              ),
            )}
          </ul>
          {removal && (
            <div
              role="status"
              className="fx-rise mt-3 flex items-center gap-3 rounded-[14px] bg-subtle py-1.5 pr-1.5 pl-3.5 text-[14px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
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
          <div className="mt-6 border-t-[1.5px] border-dashed border-line-strong pt-5">
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
              <ActionButton icon="gift" disabled={!giftLink} onClick={() => void sendToGivers()}>
                {fresh ? 'Sent · send again' : changed ? 'Send the update' : 'Send to gift-givers'}
              </ActionButton>
            </ActionBar>
          )}
        </Parchment>
      </div>

      <aside aria-label="Sharing" className="grid min-w-0 gap-4 lg:sticky lg:top-24">
        {list && items.length > 0 && (
          <section
            id={`${id}-share`}
            aria-labelledby={`${id}-share-title`}
            className="relative grid scroll-mt-24 gap-5 overflow-clip rounded-[24px] bg-surface px-5 pt-8 pb-5 shadow-lift sm:px-6"
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[5px]"
              style={{ background: 'var(--accent, #ff5e57)' }}
            />
            <h2 id={`${id}-share-title`} className="sr-only">
              Share your list
            </h2>
            {fresh ? (
              <SentMark
                key={fresh}
                title={fresh === 'shared' ? 'Sent to gift-givers' : 'Link copied'}
                line={
                  fresh === 'shared'
                    ? 'They claim gifts out of your sight.'
                    : 'Send it to family and friends. They claim gifts out of your sight.'
                }
              />
            ) : (
              <div className="grid justify-items-center gap-2 text-center">
                <span
                  className="grid size-12 place-items-center rounded-full"
                  style={{ background: tint(GOLD, 26), color: GOLD_INK }}
                >
                  <Icon name={changed ? 'refresh' : shared ? 'check' : 'gift'} size={22} />
                </span>
                <p
                  className="font-display text-[24px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance text-ink"
                  style={{ fontVariationSettings: "'wdth' 108" }}
                >
                  {changed
                    ? 'You’ve changed it'
                    : shared
                      ? 'Shared with gift-givers'
                      : `${titleOf(list)} is ready`}
                </p>
                <p className="text-[14px] text-muted">
                  {items.length} {items.length === 1 ? 'wish' : 'wishes'}
                  {changed ? '. Send the update so everyone sees it.' : ''}
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <ActionButton icon="gift" disabled={!giftLink} onClick={() => void sendToGivers()}>
                {!giftLink
                  ? 'Getting the link…'
                  : changed
                    ? 'Send the update'
                    : fresh || shared
                      ? 'Send it again'
                      : 'Send to gift-givers'}
              </ActionButton>
              <p className="text-center text-[12.5px] text-muted">
                Don’t open it yourself: it shows who’s getting what.
              </p>
              <LinkExtras link={giftLink} onUsed={() => onShared(list.edited)} />
            </div>
          </section>
        )}

        {deviceLists}

        {list && (
          <Surface className="!py-2">
            <MoreOptions label="More">
              <div className="grid gap-2 pb-3">
                <CopyButton
                  text={wishText(list)}
                  label="Copy my list as text"
                  what="List copied (no claims in it)"
                  className="!h-11 w-full"
                />
                <button
                  type="button"
                  onClick={onStartOver}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] text-[14px] font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink"
                >
                  <Icon name="restore" size={15} /> Start a new list
                </button>
              </div>
            </MoreOptions>
          </Surface>
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
    <header className="grid justify-items-center gap-2 text-center">
      <p className="label flex items-center gap-2" style={{ color: GOLD_INK }}>
        <Icon name={OCCASION_ICONS[occasion]} size={13} />
        {occasion === 'other' ? 'A wish list' : `${OCCASION_NAMES[occasion]} list`}
      </p>
      <label htmlFor={`${id}-who`} className="sr-only">
        Whose list is it?
      </label>
      <input
        id={`${id}-who`}
        value={list?.who ?? ''}
        maxLength={40}
        placeholder="Whose list?"
        autoComplete="given-name"
        enterKeyHint="done"
        onChange={(event) => onChange({ who: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="h-14 w-full min-w-0 rounded-[14px] bg-transparent px-2 text-center font-display text-[34px] font-extrabold tracking-[-0.035em] text-ink outline-none transition-colors placeholder:text-faint hover:bg-ink/[.03] focus:bg-subtle sm:text-[42px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      />
      <p className="text-[13.5px] text-muted">
        Gift-givers see{' '}
        <span className="font-medium text-ink-2">“{titleOf(list ?? { title: '', who })}”</span>
      </p>
      <MoreOptions
        label="Occasion, name and prices"
        summary={`${OCCASION_NAMES[occasion]} · ${currency}`}
        className="w-full max-w-[560px] text-left"
      >
        <div className="grid gap-4">
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
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
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
            <Field label="Prices in" htmlFor={`${id}-currency`}>
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
        </div>
      </MoreOptions>
    </header>
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
  const done = giver && list.items.length > 0 && open === 0;
  return (
    <header className="grid justify-items-center gap-3 text-center">
      <p className="label flex items-center gap-2" style={{ color: GOLD_INK }}>
        <Icon name={OCCASION_ICONS[list.occasion]} size={13} />
        {list.occasion === 'other' ? 'A wish list' : `${OCCASION_NAMES[list.occasion]} list`}
      </p>
      <h2
        className="font-display text-[34px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance text-ink sm:text-[44px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {titleOf(list)}
      </h2>
      {giver && list.items.length > 0 && !done && (
        <p className="flex items-center gap-2 text-[15px] font-medium text-ink-2">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ background: 'var(--accent, #ff5e57)' }}
          />
          {open} {open === 1 ? 'gift' : 'gifts'} still open
        </p>
      )}
      {done && (
        <p
          role="status"
          className="fx-stamp inline-flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-semibold"
          style={{ background: tint(PINE, 14), color: PINE }}
        >
          <Icon name="check-circle" size={17} /> Every gift is claimed
        </p>
      )}
    </header>
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
    <Parchment className="mx-auto grid w-full max-w-[680px] justify-items-center gap-6 px-5 py-10 text-center sm:px-10 sm:py-14">
      <TagArt />
      <div className="grid gap-3">
        <p className="label" style={{ color: GOLD_INK }}>
          {titleOf(list)}
        </p>
        <h2
          className="font-display text-[32px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance text-ink sm:text-[42px]"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          Are you picking a gift?
        </h2>
        <p className="text-[16px] leading-relaxed text-pretty text-ink-2">
          This link shows who’s getting what. If it’s your own list, stop here.
        </p>
      </div>
      <div className="grid w-full gap-2 sm:max-w-[420px]">
        <ActionButton icon="gift" onClick={onGiver}>
          I’m a gift-giver
        </ActionButton>
        <ActionButton icon="eye-off" variant="quiet" onClick={onOwner}>
          It’s my list
        </ActionButton>
      </div>
      <p className="text-[12.5px] text-muted">You’ll only be asked once.</p>
    </Parchment>
  );
}

/* ---------------- lists on this device ---------------- */

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
    <ListsCard>
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
    </ListsCard>
  );
}
