'use client';
import Link from 'next/link';
import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { newId } from '@/lib/share/link-state';
import { useLocalState, writeLocal } from '@/lib/share/local';
import {
  campaignLink,
  draftSchema,
  emptyDraft,
  exampleDraft,
  missingTags,
  PLACES,
  placeById,
  qrStudioHref,
  readPage,
  recentSchema,
  remember,
  slug,
  suggestedTags,
  TAG_HELP,
  TAGS,
  tagsFor,
  untidyTags,
  type CampaignLink,
  type Draft,
  type PlaceId,
  type Recent,
  type Tag,
  type Tags,
} from '@/lib/tools/campaign-links';
import { ActionButton, Choices, IconButton, Label, Note, useCopy } from './kit';

/*
 * Signal Links: a page's address, turned into a link that tells your analytics which post, email
 * or flyer brought people in. Paste, tap where it's going, copy: the tagged link is the object,
 * flipping into its final form as the answers change. The raw tags wait under Advanced. Built on
 * this device: the link goes straight to your page and nothing here counts clicks.
 */

const STORAGE_KEY = 'hyphy.signal-links.v1';
const DRAFT_KEY = 'hyphy.signal-links.draft.v1';

const PLACE_ICONS: Record<PlaceId, IconName> = {
  'instagram-post': 'instagram',
  'instagram-story': 'instagram',
  'instagram-bio': 'instagram',
  tiktok: 'tiktok',
  facebook: 'facebook',
  linkedin: 'linkedin',
  x: 'x-social',
  youtube: 'youtube',
  newsletter: 'mail',
  text: 'sms',
  flyer: 'qr',
  'business-card': 'contact',
  'google-business': 'store',
  'paid-ad': 'megaphone',
};

/** The big picture choices, named the way people say them; everything else waits behind More. */
const MAIN_PLACES: { id: PlaceId; label: string }[] = [
  { id: 'instagram-post', label: 'Instagram' },
  { id: 'instagram-story', label: 'Story' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'newsletter', label: 'Email' },
  { id: 'flyer', label: 'Flyer / QR' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' },
];
const MAIN_IDS = new Set<PlaceId>(MAIN_PLACES.map((place) => place.id));
const OTHER_PLACES = PLACES.filter((place) => !MAIN_IDS.has(place.id));

/** Campaign names people reach for: tap one instead of typing. */
const IDEAS = [
  'Grand opening',
  'New menu',
  'Summer sale',
  'Holiday special',
  'Giveaway',
  'Event night',
];

const ACCENT = 'var(--accent,var(--color-signal))';
const ON_ACCENT = 'text-[var(--on-accent,#12110d)]';
const GLOW = 'var(--glow,var(--accent,var(--color-signal)))';
const field =
  'h-11 w-full min-w-0 rounded-[12px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none transition-shadow placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--accent-ink,var(--color-signal)),0_0_0_4px_color-mix(in_srgb,var(--accent,var(--color-signal))_30%,transparent)] lg:text-[15px]';
const quietButton =
  'inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-well px-4 text-[15px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40 lg:h-11 lg:text-[14.5px]';
/** The kit's big accent action, for the moments it has to be a link (to QR Studio). */
const accentLink = cn(
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-[16px] px-5 text-[16.5px] font-semibold shadow-[0_14px_32px_-16px_var(--accent,transparent)] transition-transform active:scale-[.985] sm:h-13 sm:text-[16px]',
  ON_ACCENT,
);
const smallButton =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-[11px] bg-well px-3 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-9';
const heading =
  'font-display text-[21px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[22px]';

const without = (raw: Draft['raw'], ...drop: Tag[]) => {
  const next = { ...raw };
  for (const tag of drop) delete next[tag];
  return next;
};

/** A Recent entry, stamped with the moment it's used (from a click, never while rendering). */
const recentEntry = (href: string, draft: Draft): Recent => ({
  id: `l${newId(8)}`,
  href,
  at: Date.now(),
  draft,
});

const when = (at: number) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));

/** Whether an element is on screen: the phone's floating copy bar steps aside for the real one. */
function useOnScreen<T extends Element>() {
  // A callback ref: the element only exists once there's a link to show.
  const [element, setElement] = useState<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, visible && element !== null] as const;
}

const noop = () => () => {};
/** Whether this browser lets a button read the clipboard (a one-tap Paste). */
function useCanPaste() {
  return useSyncExternalStore(
    noop,
    () => typeof navigator.clipboard?.readText === 'function',
    () => false,
  );
}

export function SignalLinksTool() {
  const id = useId();
  const toast = useToast();
  const { copy, copied } = useCopy();
  const canPaste = useCanPaste();
  // The link being built is kept too, so a reload (or a trip to QR Studio) doesn't lose it.
  const [draft, setDraft] = useLocalState<Draft>(DRAFT_KEY, draftSchema, emptyDraft());
  // "Doesn't look like an address" waits while someone is still typing it.
  const [entry, setEntry] = useState<'idle' | 'typing' | 'pasted'>('idle');
  const [advanced, setAdvanced] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [recent, setRecent, { loaded }] = useLocalState<Recent[]>(STORAGE_KEY, recentSchema, []);

  const page = readPage(draft.page);
  const tags = tagsFor(draft);
  const suggested = suggestedTags(draft);
  const link = page.ok ? campaignLink(page.url, tags) : null;
  const place = placeById(draft.place);
  const started = draft.page.trim() !== '' || draft.place !== null || draft.purpose.trim() !== '';
  const pageError = !page.ok && !page.empty && entry !== 'typing' ? page.message : '';
  // The next questions wait for a link (or for answers already given, like a reused link).
  const showRest = page.ok || draft.place !== null || draft.purpose.trim() !== '';
  const other = otherOpen || (draft.place !== null && !MAIN_IDS.has(draft.place));

  const choosePlace = (placeId: PlaceId | null) =>
    // The latest choice wins: a place sets its own source, medium and spot.
    setDraft((current) => ({
      ...current,
      place: placeId,
      raw: without(current.raw, 'utm_source', 'utm_medium', 'utm_content'),
    }));
  const setPurpose = (purpose: string) =>
    setDraft((current) => ({ ...current, purpose, raw: without(current.raw, 'utm_campaign') }));
  const setVersion = (version: string) =>
    setDraft((current) => ({ ...current, version, raw: without(current.raw, 'utm_content') }));
  const setRaw = (tag: Tag, value: string) =>
    setDraft((current) => ({ ...current, raw: { ...current.raw, [tag]: value } }));

  /** Used links go to the top of Recent, written now: "Make a QR code" leaves this page. */
  const rememberLink = (href: string) => {
    const next = remember(recent, recentEntry(href, draft));
    setRecent(next);
    writeLocal(STORAGE_KEY, next);
  };

  const copyLink = async () => {
    if (link && (await copy(link.href, 'Link copied'))) rememberLink(link.href);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw new Error('empty');
      setDraft((current) => ({ ...current, page: text }));
      setEntry('pasted');
    } catch {
      // Not allowed, or nothing there: the field takes a long-press paste just as well.
      document.getElementById(`${id}-page`)?.focus();
    }
  };

  const load = (next: Draft, message?: string) => {
    setDraft(next);
    setEntry('idle');
    setOtherOpen(false);
    setAdvanced(Object.keys(next.raw).length > 0 || next.version.trim() !== '');
    if (!message) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(`${id}-builder`)
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    toast({ title: message, icon: 'link' });
  };

  const clearRecent = () => {
    if (!window.confirm('Clear your recent links?')) return;
    setRecent([]);
  };

  const qrFirst = Boolean(place?.qr);
  const [result, resultVisible] = useOnScreen<HTMLDivElement>();
  const tagSummary = [tags.utm_source, tags.utm_medium, tags.utm_campaign]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      id={`${id}-builder`}
      className="grid scroll-mt-24 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] lg:items-start lg:gap-x-8"
    >
      {/* 1 · The way in: one big place to paste. */}
      <section
        aria-labelledby={`${id}-s1`}
        className="relative isolate grid min-w-0 gap-3 overflow-hidden rounded-[28px] bg-surface p-5 shadow-lift sm:p-6 lg:col-start-1 lg:row-start-1"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id={`${id}-s1`}
            className="font-display text-[28px] leading-[1.02] font-bold tracking-[-0.03em] text-ink sm:text-[32px]"
            style={{ fontVariationSettings: "'wdth' 108" }}
          >
            Paste your link
          </h2>
          {started ? (
            <button
              type="button"
              onClick={() => load(emptyDraft())}
              className="-my-1 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-muted hover:bg-ink/5 hover:text-ink lg:h-9"
            >
              <Icon name="restore" size={15} /> Start over
            </button>
          ) : (
            <button
              type="button"
              onClick={() => load(exampleDraft())}
              className="-my-1 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-[var(--accent-ink)] transition-colors hover:bg-signal-soft lg:h-9"
            >
              <Icon name="sparkles" size={15} /> Try an example
            </button>
          )}
        </div>
        <div className="relative">
          <Icon
            name="link"
            size={20}
            className={cn(
              'pointer-events-none absolute top-1/2 left-4 -translate-y-1/2',
              page.ok ? 'text-[var(--accent-ink)]' : 'text-muted',
            )}
          />
          <input
            id={`${id}-page`}
            aria-label="Paste your link"
            aria-describedby={`${id}-page-note`}
            aria-invalid={pageError ? true : undefined}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="url"
            spellCheck={false}
            maxLength={4000}
            enterKeyHint="next"
            placeholder="shop.example/menu"
            value={draft.page}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) => ({ ...current, page: value }));
              if (entry !== 'pasted') setEntry('typing');
            }}
            onKeyDown={() => entry === 'pasted' && setEntry('typing')}
            onPaste={() => setEntry('pasted')}
            onBlur={() => setEntry('idle')}
            className={cn(
              field,
              '!h-16 rounded-[18px] pl-12 !text-[17px] aria-[invalid=true]:shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
              draft.page ? 'pr-12' : canPaste ? 'pr-[112px]' : 'pr-4',
            )}
          />
          {draft.page ? (
            <IconButton
              icon="x"
              size="sm"
              label="Clear the address"
              onClick={() => {
                setDraft((current) => ({ ...current, page: '' }));
                setEntry('idle');
                document.getElementById(`${id}-page`)?.focus();
              }}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 max-lg:!size-11"
            />
          ) : (
            canPaste && (
              <button
                type="button"
                onClick={pasteFromClipboard}
                className={cn(
                  'absolute top-1/2 right-2 inline-flex h-12 -translate-y-1/2 items-center gap-1.5 rounded-[13px] px-4 text-[15px] font-semibold transition-transform active:scale-[.96]',
                  ON_ACCENT,
                )}
                style={{ background: ACCENT }}
              >
                <Icon name="clipboard" size={16} /> Paste
              </button>
            )
          )}
        </div>
        <div id={`${id}-page-note`} className="grid gap-2 text-[13.5px] leading-relaxed">
          {page.ok ? (
            <p className="flex min-w-0 items-start gap-2 text-muted">
              <Icon name="check" size={15} className="mt-[3px] shrink-0 text-positive" />
              <span className="min-w-0 break-all">
                To <span className="text-ink-2">{page.url.host}</span>
                {page.url.pathname !== '/' && (
                  <span className="text-ink-2">{page.url.pathname}</span>
                )}
              </span>
            </p>
          ) : pageError ? (
            <p className="flex items-start gap-2 text-critical">
              <Icon name="alert" size={15} className="mt-[3px] shrink-0" />
              {pageError}
            </p>
          ) : (
            <p className="text-muted">Your shop, menu, booking page or sign-up.</p>
          )}
          {link && link.replaced.length > 0 && (
            <Note tone="caution" icon="replace">
              It already had tracking. Yours replaces it.
            </Note>
          )}
        </div>
      </section>

      {/* 2 · Where is this going? Pictures, not fields. */}
      {showRest && (
        <section
          aria-labelledby={`${id}-s2`}
          className="grid min-w-0 animate-rise gap-3.5 lg:col-start-1 lg:row-start-2"
        >
          <h2 id={`${id}-s2`} className={heading}>
            Where is it going?
          </h2>
          <div
            role="radiogroup"
            aria-label="Where is it going?"
            className="grid grid-cols-4 gap-2 sm:gap-2.5"
          >
            {[
              ...MAIN_PLACES.map((option) => ({
                value: option.id as PlaceId | 'other',
                label: option.label,
                icon: PLACE_ICONS[option.id],
              })),
              { value: 'other' as const, label: 'More', icon: 'more' as IconName },
            ].map((option, index) => {
              const on = option.value === 'other' ? other : draft.place === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    if (option.value === 'other') {
                      setOtherOpen(true);
                      if (draft.place && MAIN_IDS.has(draft.place)) choosePlace(null);
                      return;
                    }
                    setOtherOpen(false);
                    choosePlace(option.value);
                  }}
                  className={cn(
                    'fx-rise fx-move flex aspect-square min-w-0 flex-col items-center justify-center gap-1.5 rounded-[18px] px-1 text-center active:scale-[.94] sm:aspect-[5/4]',
                    on
                      ? cn(
                          'shadow-[inset_0_0_0_2px_var(--accent-ink),0_12px_24px_-14px_var(--accent-ink)]',
                          ON_ACCENT,
                        )
                      : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:-translate-y-0.5 hover:text-ink',
                  )}
                  style={{
                    ['--i' as string]: index,
                    ...(on ? { background: ACCENT } : {}),
                  }}
                >
                  <Icon name={option.icon} size={24} />
                  <span className="max-w-full truncate text-[12.5px] leading-tight font-semibold sm:text-[13.5px]">
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
          {other && (
            <div className="fx-rise grid gap-2">
              <Choices
                label="Other places"
                value={draft.place && !MAIN_IDS.has(draft.place) ? draft.place : null}
                onChange={(value) => choosePlace(value)}
                options={OTHER_PLACES.map((option) => ({
                  value: option.id,
                  label: option.label,
                  icon: PLACE_ICONS[option.id],
                }))}
              />
              <p className="text-[12.5px] text-muted">Somewhere else? Name it under Advanced.</p>
            </div>
          )}
        </section>
      )}

      {/* The object: the tagged link, flipping into its final form. */}
      <aside
        aria-label="Your link"
        className="grid min-w-0 gap-3 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start"
      >
        <div
          className={cn(
            'relative isolate grid gap-4 overflow-hidden rounded-[28px] p-5 sm:p-6',
            link
              ? 'bg-surface shadow-lift'
              : 'border-[1.5px] border-dashed border-line-strong bg-transparent',
          )}
        >
          {link && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background: `radial-gradient(80% 60% at 100% 0%, color-mix(in srgb, ${GLOW} 16%, transparent), transparent 70%), radial-gradient(70% 50% at 0% 100%, color-mix(in srgb, ${ACCENT} 40%, transparent), transparent 70%)`,
              }}
            />
          )}
          <div className="flex items-center justify-between gap-3">
            <h2 className="label flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: link ? GLOW : 'var(--color-line-strong)' }}
              />
              Your link
            </h2>
            <p
              aria-live="polite"
              className="flex min-w-0 items-center gap-1.5 truncate text-[13px]"
            >
              {link && place && (
                <span
                  key={place.id}
                  className="fx-pop inline-flex items-center gap-1.5 rounded-full bg-well px-2.5 py-1 font-medium text-ink-2"
                >
                  <Icon name={PLACE_ICONS[place.id]} size={13} /> {place.label}
                </span>
              )}
            </p>
          </div>
          {link ? (
            <>
              <div className="relative">
                <LinkPreview
                  // It flips when the answer changes, not on every letter typed.
                  key={`${draft.place ?? ''}|${link.base}|${IDEAS.includes(draft.purpose) ? draft.purpose : ''}`}
                  link={link}
                />
                {copied === link.href && (
                  <span
                    aria-hidden="true"
                    className="fx-stamp pointer-events-none absolute -top-3 right-2 rotate-[-6deg] rounded-[10px] bg-positive px-3 py-1 text-[13px] font-bold tracking-[.08em] text-white uppercase shadow-lift"
                  >
                    Copied
                  </span>
                )}
              </div>
              <div ref={result} className="grid gap-2 sm:grid-cols-2">
                {qrFirst ? (
                  <Link
                    href={qrStudioHref(link.href)}
                    onClick={() => rememberLink(link.href)}
                    className={cn(accentLink, 'sm:col-span-2')}
                    style={{ background: ACCENT }}
                  >
                    <Icon name="qr" size={19} /> Make a QR code
                  </Link>
                ) : (
                  <ActionButton
                    icon={copied === link.href ? 'check' : 'copy'}
                    onClick={copyLink}
                    className="!h-15 !text-[17.5px] sm:col-span-2"
                  >
                    {copied === link.href ? 'Copied' : 'Copy link'}
                  </ActionButton>
                )}
                {qrFirst ? (
                  <button type="button" onClick={copyLink} className={quietButton}>
                    <Icon name={copied === link.href ? 'check' : 'copy'} size={17} />
                    {copied === link.href ? 'Copied' : 'Copy link'}
                  </button>
                ) : (
                  <Link
                    href={qrStudioHref(link.href)}
                    onClick={() => rememberLink(link.href)}
                    className={quietButton}
                  >
                    <Icon name="qr" size={17} /> Make a QR code
                  </Link>
                )}
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => rememberLink(link.href)}
                  className={quietButton}
                >
                  <Icon name="external" size={17} /> Try it
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </div>
            </>
          ) : (
            <EmptyLink />
          )}
          <Advice link={link} tags={tags} placeChosen={draft.place !== null} />
        </div>

        {link && (
          <details className="group/results rounded-[20px] px-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[14px] font-medium text-muted select-none hover:text-ink [&::-webkit-details-marker]:hidden">
              <Icon name="activity" size={15} />
              <span className="flex-1">Where do I see the results?</span>
              <Icon
                name="chevron-down"
                size={15}
                className="transition-transform group-open/results:rotate-180"
              />
            </summary>
            <p className="pt-1 pb-2 text-[13.5px] leading-relaxed text-ink-2">
              In your own analytics. In Google Analytics:{' '}
              <span className="font-medium text-ink">
                Reports → Acquisition → Traffic acquisition
              </span>
              , then look for{' '}
              {tags.utm_source && tags.utm_medium ? (
                <TagValue>
                  {tags.utm_source} / {tags.utm_medium}
                </TagValue>
              ) : (
                'the source / medium'
              )}
              {tags.utm_campaign ? (
                <>
                  {' '}
                  and <TagValue>{tags.utm_campaign}</TagValue>
                </>
              ) : (
                ' and the campaign name'
              )}
              .
            </p>
          </details>
        )}
      </aside>

      {/* 3 · What's it for? Optional, one tap. */}
      {showRest && (
        <section
          aria-labelledby={`${id}-s3`}
          className="grid min-w-0 animate-rise gap-3 lg:col-start-1 lg:row-start-3"
        >
          <h2 id={`${id}-s3`} className={heading}>
            What’s it for?{' '}
            <span className="font-sans text-[14px] font-normal tracking-normal text-faint">
              optional
            </span>
          </h2>
          <Choices
            label="Campaign ideas"
            value={IDEAS.find((idea) => idea === draft.purpose) ?? null}
            onChange={(idea) => setPurpose(idea === draft.purpose ? '' : idea)}
            options={IDEAS.map((idea) => ({ value: idea, label: idea }))}
          />
          <input
            id={`${id}-purpose`}
            aria-label="Campaign name"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={120}
            placeholder="Or your own, like Fall menu launch"
            value={draft.purpose}
            onChange={(event) => setPurpose(event.target.value)}
            className={field}
          />
        </section>
      )}

      {/* Advanced: the tags themselves. */}
      {showRest && (
        <section className="grid min-w-0 gap-4 border-t border-line pt-3 lg:col-start-1 lg:row-start-4">
          <button
            type="button"
            aria-expanded={advanced}
            aria-controls={`${id}-fine`}
            onClick={() => setAdvanced((value) => !value)}
            className="flex min-h-11 w-full min-w-0 items-center gap-2 text-left text-[14.5px] font-medium text-ink-2 hover:text-ink"
          >
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full bg-well transition-transform',
                advanced && 'rotate-45',
              )}
            >
              <Icon name="plus" size={15} />
            </span>
            <span className="flex-1 whitespace-nowrap">Advanced</span>
            {!advanced && tagSummary && (
              <span className="mono-num min-w-0 truncate text-[12px] font-normal text-muted">
                {tagSummary}
              </span>
            )}
          </button>
          {advanced && (
            <div id={`${id}-fine`} className="grid animate-fade gap-5">
              <div className="grid gap-1.5">
                <label
                  htmlFor={`${id}-version`}
                  className="flex items-baseline justify-between gap-2 text-[14px] font-medium text-ink-2"
                >
                  Which version?
                  <span className="text-[12px] font-normal text-faint">
                    For comparing two, like two flyers
                  </span>
                </label>
                <input
                  id={`${id}-version`}
                  autoComplete="off"
                  maxLength={120}
                  placeholder="Blue poster"
                  value={draft.version}
                  onChange={(event) => setVersion(event.target.value)}
                  className={field}
                />
              </div>
              <div className="grid gap-4 rounded-[18px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
                {TAGS.map((tag) => (
                  <div
                    key={tag}
                    className="grid gap-1.5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-x-4"
                  >
                    <label htmlFor={`${id}-${tag}`} className="grid content-start sm:pt-2">
                      <span className="text-[13.5px] font-medium text-ink-2">
                        {TAG_HELP[tag].label}
                      </span>
                      <span className="mono-num text-[11.5px] text-faint">{tag}</span>
                    </label>
                    <div className="grid min-w-0 gap-1">
                      <input
                        id={`${id}-${tag}`}
                        aria-describedby={`${id}-${tag}-help`}
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={200}
                        placeholder={TAG_HELP[tag].example}
                        value={draft.raw[tag] ?? suggested[tag]}
                        onChange={(event) => setRaw(tag, event.target.value)}
                        className={cn(field, 'mono-num !text-[15px] lg:!text-[13.5px]')}
                      />
                      <p id={`${id}-${tag}-help`} className="text-[12px] leading-snug text-muted">
                        {TAG_HELP[tag].help}
                      </p>
                    </div>
                  </div>
                ))}
                {Object.keys(draft.raw).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, raw: {} }))}
                    className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-medium text-ink-2 hover:text-ink lg:min-h-0"
                  >
                    <Icon name="restore" size={15} /> Use my answers again
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* On a phone the finished link can be a scroll away: its main button floats until the
          real one is on screen. */}
      {link && !resultVisible && (
        <div className="fixed inset-x-0 bottom-0 z-30 animate-rise border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden">
          <div className="mx-auto flex max-w-[640px] items-center gap-3">
            <p className="mono-num min-w-0 flex-1 truncate text-[12.5px] text-muted">{link.href}</p>
            {qrFirst ? (
              <Link
                href={qrStudioHref(link.href)}
                onClick={() => rememberLink(link.href)}
                className={cn(accentLink, '!h-12 !w-auto shrink-0 !text-[15px]')}
                style={{ background: ACCENT }}
              >
                <Icon name="qr" size={18} /> QR code
              </Link>
            ) : (
              <ActionButton
                icon={copied === link.href ? 'check' : 'copy'}
                onClick={copyLink}
                className="!h-12 !w-auto shrink-0 !text-[15px]"
              >
                {copied === link.href ? 'Copied' : 'Copy link'}
              </ActionButton>
            )}
          </div>
        </div>
      )}

      {loaded && recent.length > 0 && (
        <section
          aria-labelledby={`${id}-recent`}
          className="grid min-w-0 gap-2 rounded-[24px] bg-surface p-4 shadow-card sm:p-6 lg:col-span-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label id={`${id}-recent`}>Recent links · {recent.length}</Label>
            <button
              type="button"
              onClick={clearRecent}
              className="inline-flex min-h-11 items-center text-[13px] text-muted underline-offset-2 hover:text-critical hover:underline lg:min-h-0"
            >
              Clear all
            </button>
          </div>
          <ul className="row-divide">
            {recent.map((item) => (
              <RecentRow
                key={item.id}
                item={item}
                copied={copied === item.href}
                onCopy={() => void copy(item.href, 'Link copied')}
                onReuse={() => load(item.draft, 'Loaded into the builder')}
                onDelete={() =>
                  setRecent((current) => current.filter((entry) => entry.id !== item.id))
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TagValue({ children }: { children: ReactNode }) {
  return (
    <code className="mono-num rounded-[5px] bg-signal-soft px-1 py-px text-[0.92em] text-[var(--accent-ink)] [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

/** Before there's a link: the object's outline, so the empty side shows what's coming. */
function EmptyLink() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      <p className="mono-num text-[14px] leading-[2] break-all text-faint">
        <span className="text-muted">shop.example/menu</span>?utm_source=
        <Pill ghost>instagram</Pill>&amp;utm_medium=<Pill ghost>social</Pill>
      </p>
      <p className="text-[14.5px] text-muted">Your tagged link lands here.</p>
    </div>
  );
}

function Pill({ children, ghost = false }: { children: ReactNode; ghost?: boolean }) {
  return (
    <span
      className={cn(
        'rounded-[7px] box-decoration-clone px-1.5 py-0.5 break-normal [overflow-wrap:anywhere]',
        ghost
          ? 'bg-ink/[.05] text-faint'
          : 'bg-[color-mix(in_srgb,var(--glow,var(--accent))_22%,transparent)] font-semibold text-ink',
      )}
    >
      {children}
    </span>
  );
}

/**
 * The finished link, readable: the page's address plain and large, the tracking parts after it
 * quiet, with each value on a highlight. It flips in whenever it changes. Copying a selection
 * gives the link as it really is.
 */
function LinkPreview({ link }: { link: CampaignLink }) {
  const onCopy = (event: ClipboardEvent<HTMLElement>) => {
    const text = window.getSelection()?.toString() ?? '';
    if (!text) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text.replace(/\s+/g, ''));
  };
  return (
    <p
      onCopy={onCopy}
      className="fx-flip mono-num rounded-[18px] bg-subtle p-4 text-[14px] leading-[2.05] break-all shadow-[inset_0_0_0_1px_var(--color-line)] sm:text-[14.5px]"
    >
      <span className="text-faint">{/^https?:\/\//.exec(link.base)?.[0]}</span>
      <span className="font-semibold text-ink">{link.base.replace(/^https?:\/\//, '')}</span>
      {link.query.map((piece, index) => (
        <span key={`q${index}`} className="text-muted">
          {index === 0 ? '?' : '&'}
          {piece}
        </span>
      ))}
      {link.tags.map(({ tag, value }, index) => (
        <span key={tag}>
          <span className="text-faint">
            {index === 0 && link.query.length === 0 ? '?' : '&'}
            {tag}=
          </span>
          <Pill>{value}</Pill>
        </span>
      ))}
      {link.hash && <span className="text-muted">{link.hash}</span>}
    </p>
  );
}

/** Gentle notes: what's missing, and hand-typed tags that will split your reports. */
function Advice({
  link,
  tags,
  placeChosen,
}: {
  link: CampaignLink | null;
  tags: Tags;
  placeChosen: boolean;
}) {
  const notes: { text: string; tone: 'quiet' | 'caution' }[] = [];
  if (link) {
    const missing = missingTags(tags);
    if (missing.includes('utm_source') && missing.includes('utm_medium') && !placeChosen)
      notes.push({
        text: 'Tap where it’s going, so you’ll know where visits came from.',
        tone: 'quiet',
      });
    else {
      if (missing.includes('utm_source'))
        notes.push({
          text: 'The source is empty. Analytics needs it to say where visits came from.',
          tone: 'caution',
        });
      if (missing.includes('utm_medium'))
        notes.push({
          text: 'The medium is empty. Add one under Advanced, like social or email.',
          tone: 'caution',
        });
    }
  }
  for (const { tag, problem } of untidyTags(tags))
    notes.push({
      text:
        problem === 'capitals'
          ? `${TAG_HELP[tag].label} has capitals: reports count “Instagram” and “instagram” apart.`
          : `${TAG_HELP[tag].label} has spaces (they become %20). Try ${slug(tags[tag])}.`,
      tone: 'caution',
    });

  // Always in the page (so changes are announced), taking no room while there's nothing to say.
  return (
    <ul aria-live="polite" className={cn('grid gap-2', notes.length === 0 && 'sr-only')}>
      {notes.map((note) =>
        note.tone === 'quiet' ? (
          <li key={note.text} className="flex items-center gap-2 text-[13.5px] text-muted">
            <Icon name="arrow-left" size={14} className="shrink-0 max-lg:rotate-90" />
            {note.text}
          </li>
        ) : (
          <li key={note.text}>
            <Note tone="caution" icon="alert">
              {note.text}
            </Note>
          </li>
        ),
      )}
    </ul>
  );
}

function RecentRow({
  item,
  copied,
  onCopy,
  onReuse,
  onDelete,
}: {
  item: Recent;
  copied: boolean;
  onCopy: () => void;
  onReuse: () => void;
  onDelete: () => void;
}) {
  const tags = tagsFor(item.draft);
  const place = placeById(item.draft.place);
  const title = item.draft.purpose.trim() || tags.utm_campaign || 'No campaign name';
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-well text-ink-2"
        >
          <Icon name={place ? PLACE_ICONS[place.id] : 'link-2'} size={17} />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[14.5px]">
            <span className="font-semibold break-words text-ink">{title}</span>
            <span className="text-[12.5px] text-muted">
              {place?.label ??
                ([tags.utm_source, tags.utm_medium].filter(Boolean).join(' / ') || 'No place')}{' '}
              · {when(item.at)}
            </span>
          </p>
          <p className="mono-num mt-0.5 truncate text-[12px] text-faint" title={item.href}>
            {item.href}
          </p>
        </div>
      </div>
      <div className="flex gap-1.5 pl-[52px] sm:pl-0">
        <button type="button" onClick={onCopy} className={smallButton}>
          <Icon name={copied ? 'check' : 'copy'} size={15} />
          {copied ? 'Copied' : 'Copy'}
          <span className="sr-only"> {title}</span>
        </button>
        <button type="button" onClick={onReuse} className={smallButton}>
          <Icon name="pencil" size={15} /> Reuse<span className="sr-only"> {title}</span>
        </button>
        <IconButton icon="trash" tone="danger" label={`Delete ${title}`} onClick={onDelete} />
      </div>
    </li>
  );
}
