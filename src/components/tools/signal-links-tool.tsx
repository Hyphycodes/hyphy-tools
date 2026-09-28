'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
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
import {
  ActionButton,
  ChoiceCards,
  Choices,
  IconButton,
  Label,
  Note,
  Surface,
  useCopy,
} from './kit';

/*
 * Signal Links: a page's address, turned into a link that tells your analytics which post, email
 * or flyer brought people in. Paste, tap where it's going, copy. The raw tags wait under
 * Fine-tune. Built on this device: the link goes straight to your page and nothing here counts
 * clicks.
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

/** The big picture choices; everything else waits behind "Other". */
const MAIN_PLACES: { id: PlaceId; label: string; hint: string }[] = [
  { id: 'instagram-post', label: 'Instagram post', hint: 'Post or reel' },
  { id: 'instagram-story', label: 'Story', hint: 'Instagram link sticker' },
  { id: 'tiktok', label: 'TikTok', hint: 'Bio or video' },
  { id: 'newsletter', label: 'Newsletter', hint: 'An email you send' },
  { id: 'flyer', label: 'Flyer or QR', hint: 'Printed, people scan' },
  { id: 'facebook', label: 'Facebook', hint: 'Post or page' },
  { id: 'youtube', label: 'YouTube', hint: 'Video description' },
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

const accent = 'var(--accent,var(--color-signal))';
const field =
  'h-11 w-full min-w-0 rounded-[12px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none transition-shadow placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-signal)),0_0_0_4px_color-mix(in_srgb,var(--accent,var(--color-signal))_16%,transparent)] lg:text-[15px]';
const quietButton =
  'inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-well px-4 text-[15px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40 lg:h-11 lg:text-[14.5px]';
/** The kit's big accent action, for the moments it has to be a link (to QR Studio). */
const accentLink =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-[16px] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent,transparent)] transition-transform active:scale-[.985] sm:h-13 sm:text-[16px]';
const smallButton =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-[11px] bg-well px-3 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-9';

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
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, visible] as const;
}

function StepTitle({
  n,
  id,
  children,
  aside,
}: {
  /** The step's number, or an icon for an optional step. */
  n: number | IconName;
  id: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3
        id={id}
        className="flex items-center gap-2.5 font-display text-[19px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[20px]"
      >
        <span
          aria-hidden="true"
          className="mono-num grid size-7 shrink-0 place-items-center rounded-full font-sans text-[12.5px] font-bold tracking-normal text-[#12110d]"
          style={typeof n === 'number' ? { background: accent } : undefined}
        >
          {typeof n === 'number' ? (
            n
          ) : (
            <span className="grid size-7 place-items-center rounded-full bg-well text-ink-2">
              <Icon name={n} size={14} />
            </span>
          )}
        </span>
        {children}
      </h3>
      {aside}
    </div>
  );
}

export function SignalLinksTool() {
  const id = useId();
  const toast = useToast();
  const { copy, copied } = useCopy();
  // The link being built is kept too, so a reload (or a trip to QR Studio) doesn't lose it.
  const [draft, setDraft] = useLocalState<Draft>(DRAFT_KEY, draftSchema, emptyDraft());
  // "Doesn't look like an address" waits while someone is still typing it.
  const [entry, setEntry] = useState<'idle' | 'typing' | 'pasted'>('idle');
  const [fineTune, setFineTune] = useState(false);
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

  const load = (next: Draft, message?: string) => {
    setDraft(next);
    setEntry('idle');
    setOtherOpen(false);
    setFineTune(Object.keys(next.raw).length > 0 || next.version.trim() !== '');
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
    <div className="grid gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] lg:items-start">
        <Surface
          as="section"
          id={`${id}-builder`}
          aria-label="Build your link"
          className="grid scroll-mt-24 gap-8 sm:!p-6"
        >
          <section aria-labelledby={`${id}-s1`} className="grid gap-3">
            <StepTitle
              n={1}
              id={`${id}-s1`}
              aside={
                started ? (
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
                    className="-my-1 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-signal-ink transition-colors hover:bg-signal-soft lg:h-9"
                  >
                    <Icon name="sparkles" size={15} /> Try an example
                  </button>
                )
              }
            >
              Paste your link
            </StepTitle>
            <div className="relative">
              <Icon
                name="link"
                size={19}
                className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
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
                  '!h-15 rounded-[16px] pr-12 pl-12 !text-[17px] aria-[invalid=true]:shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
                )}
              />
              {draft.page && (
                <IconButton
                  icon="x"
                  size="sm"
                  label="Clear the address"
                  onClick={() => {
                    setDraft((current) => ({ ...current, page: '' }));
                    setEntry('idle');
                    document.getElementById(`${id}-page`)?.focus();
                  }}
                  className="absolute top-1/2 right-2 -translate-y-1/2 max-lg:!size-11"
                />
              )}
            </div>
            <div id={`${id}-page-note`} className="grid gap-2 text-[13.5px] leading-relaxed">
              {page.ok ? (
                <p className="flex min-w-0 items-start gap-2 text-muted">
                  <Icon name="check" size={15} className="mt-[3px] shrink-0 text-positive" />
                  <span className="min-w-0 break-all">
                    Sending people to <span className="text-ink-2">{page.url.host}</span>
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
                <p className="text-muted">
                  The page you want people to land on: your shop, menu, booking page or sign-up.
                </p>
              )}
              {link && link.replaced.length > 0 && (
                <Note tone="caution" icon="replace">
                  This link already had tracking on it. Your answers below replace it.
                </Note>
              )}
            </div>
          </section>

          {showRest && (
            <>
              <section aria-labelledby={`${id}-s2`} className="grid animate-rise gap-3.5">
                <StepTitle n={2} id={`${id}-s2`}>
                  Where will you share it?
                </StepTitle>
                <ChoiceCards
                  label="Where will you share it?"
                  columns={4}
                  selected={other ? ['other'] : draft.place ? [draft.place] : []}
                  onToggle={(value) => {
                    if (value === 'other') {
                      setOtherOpen(true);
                      if (draft.place && MAIN_IDS.has(draft.place)) choosePlace(null);
                      return;
                    }
                    setOtherOpen(false);
                    choosePlace(value);
                  }}
                  options={[
                    ...MAIN_PLACES.map((option) => ({
                      value: option.id as PlaceId | 'other',
                      label: option.label,
                      hint: option.hint,
                      icon: PLACE_ICONS[option.id],
                    })),
                    {
                      value: 'other',
                      label: 'Other',
                      hint: 'Bio, text, ad…',
                      icon: 'more',
                    },
                  ]}
                />
                {other && (
                  <div className="grid animate-rise gap-2 rounded-[18px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
                    <p className="px-1 text-[13.5px] text-muted">Which one?</p>
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
                    <p className="px-1 text-[12.5px] text-muted">
                      Somewhere else? Name it yourself under Fine-tune.
                    </p>
                  </div>
                )}
              </section>

              <section aria-labelledby={`${id}-s3`} className="grid animate-rise gap-3.5">
                <StepTitle n="tag" id={`${id}-s3`}>
                  Name the campaign{' '}
                  <span className="font-sans text-[14px] font-normal tracking-normal text-faint">
                    optional
                  </span>
                </StepTitle>
                <p className="-mt-1.5 text-[13.5px] leading-relaxed text-muted">
                  What’s it for? Give every link for the same promotion the same name, and they’re
                  counted together.
                </p>
                <Choices
                  label="Campaign ideas"
                  value={IDEAS.find((idea) => idea === draft.purpose) ?? null}
                  onChange={(idea) => setPurpose(idea === draft.purpose ? '' : idea)}
                  options={IDEAS.map((idea) => ({ value: idea, label: idea }))}
                />
                <div className="grid gap-1.5">
                  <input
                    id={`${id}-purpose`}
                    aria-label="Campaign name"
                    aria-describedby={`${id}-purpose-note`}
                    autoComplete="off"
                    enterKeyHint="done"
                    maxLength={120}
                    placeholder="Or type your own, like Fall menu launch"
                    value={draft.purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                    className={field}
                  />
                  {tags.utm_campaign && (
                    <p
                      id={`${id}-purpose-note`}
                      className="text-[12.5px] leading-relaxed text-muted"
                    >
                      In the link as <TagValue>{tags.utm_campaign}</TagValue>
                      {draft.raw.utm_campaign !== undefined && ' (set under Fine-tune)'}
                    </p>
                  )}
                </div>
              </section>

              <section className="-mt-2 grid gap-4 border-t border-line pt-4">
                <button
                  type="button"
                  aria-expanded={fineTune}
                  aria-controls={`${id}-fine`}
                  onClick={() => setFineTune((value) => !value)}
                  className="flex min-h-11 w-full min-w-0 items-center gap-2 text-left text-[14.5px] font-medium text-ink-2 hover:text-ink"
                >
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-full bg-well transition-transform',
                      fineTune && 'rotate-45',
                    )}
                  >
                    <Icon name="plus" size={15} />
                  </span>
                  <span className="flex-1 whitespace-nowrap">Fine-tune</span>
                  {!fineTune && tagSummary && (
                    <span className="mono-num min-w-0 truncate text-[12px] font-normal text-muted">
                      {tagSummary}
                    </span>
                  )}
                </button>
                {fineTune && (
                  <div id={`${id}-fine`} className="grid animate-fade gap-5">
                    <div className="grid gap-1.5">
                      <label
                        htmlFor={`${id}-version`}
                        className="flex items-baseline justify-between gap-2 text-[14px] font-medium text-ink-2"
                      >
                        Which version?
                        <span className="text-[12px] font-normal text-faint">Optional</span>
                      </label>
                      <input
                        id={`${id}-version`}
                        aria-describedby={`${id}-version-note`}
                        autoComplete="off"
                        maxLength={120}
                        placeholder="Blue poster"
                        value={draft.version}
                        onChange={(event) => setVersion(event.target.value)}
                        className={field}
                      />
                      <p
                        id={`${id}-version-note`}
                        className="text-[12.5px] leading-relaxed text-muted"
                      >
                        Only if you’re comparing two versions, like two flyer designs.
                      </p>
                    </div>
                    <div className="grid gap-4 rounded-[18px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
                      <p className="text-[13px] leading-relaxed text-muted">
                        The tracking tags themselves. Your answers fill them in; type here to set
                        one yourself.
                      </p>
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
                            <p
                              id={`${id}-${tag}-help`}
                              className="text-[12px] leading-snug text-muted"
                            >
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
            </>
          )}
        </Surface>

        <aside aria-label="Your link" className="grid gap-4 lg:sticky lg:top-24">
          <Surface className="relative isolate grid gap-4 overflow-hidden !p-5 sm:!p-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background: `radial-gradient(80% 60% at 100% 0%, color-mix(in srgb, ${accent} 12%, transparent), transparent 70%)`,
              }}
            />
            <StepTitle
              n={link ? 3 : 'sparkles'}
              id={`${id}-s4`}
              aside={
                <p aria-live="polite" className="truncate text-[12.5px] text-muted">
                  {link ? (place ? `For ${place.label}` : 'Ready') : ''}
                </p>
              }
            >
              {link ? 'Copy your link' : 'What you’ll get'}
            </StepTitle>
            {link ? (
              <>
                <LinkPreview link={link} />
                <div ref={result} className="grid gap-2 sm:grid-cols-2">
                  {qrFirst ? (
                    <Link
                      href={qrStudioHref(link.href)}
                      onClick={() => rememberLink(link.href)}
                      className={cn(accentLink, 'sm:col-span-2')}
                      style={{ background: accent }}
                    >
                      <Icon name="qr" size={19} /> Make a QR code
                    </Link>
                  ) : (
                    <ActionButton
                      icon={copied === link.href ? 'check' : 'copy'}
                      onClick={copyLink}
                      className="sm:col-span-2"
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
          </Surface>

          {link && (
            <details className="group/results rounded-[22px] bg-surface p-4 shadow-card sm:px-6">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[14.5px] font-medium text-ink-2 select-none hover:text-ink [&::-webkit-details-marker]:hidden">
                <Icon name="activity" size={16} />
                <span className="flex-1">Where do I see the results?</span>
                <Icon
                  name="chevron-down"
                  size={16}
                  className="transition-transform group-open/results:rotate-180"
                />
              </summary>
              <p className="pt-2 pb-1 text-[13.5px] leading-relaxed text-ink-2">
                In your own analytics. In Google Analytics, open{' '}
                <span className="font-medium text-ink">
                  Reports → Acquisition → Traffic acquisition
                </span>{' '}
                and look for{' '}
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
                    and the campaign <TagValue>{tags.utm_campaign}</TagValue>
                  </>
                ) : (
                  ' and the campaign name'
                )}
                .
              </p>
            </details>
          )}
        </aside>
      </div>

      {/* On a phone the finished link is a long scroll away: its main button floats until the
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
                style={{ background: accent }}
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
        <Surface as="section" aria-labelledby={`${id}-recent`} className="grid gap-3 sm:!p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label id={`${id}-recent`}>Recent links · {recent.length}</Label>
              <p className="mt-1 text-[12.5px] text-muted">
                The last {recent.length === 1 ? 'one' : recent.length} you copied, opened or made
                into a code.
              </p>
            </div>
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
        </Surface>
      )}
    </div>
  );
}

function TagValue({ children }: { children: ReactNode }) {
  return (
    <code className="mono-num rounded-[5px] bg-signal-soft px-1 py-px text-[0.92em] text-signal-ink [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

/** Before there's a link: a picture of what's coming, so the empty side isn't empty. */
function EmptyLink() {
  return (
    <div className="grid gap-3">
      <p
        aria-hidden="true"
        className="mono-num rounded-[16px] bg-subtle p-4 text-[13px] leading-[2] break-all text-faint shadow-[inset_0_0_0_1px_var(--color-line)]"
      >
        <span className="text-ink-2">shop.example/menu</span>?utm_source=
        <Pill>instagram</Pill>&amp;utm_medium=<Pill>social</Pill>&amp;utm_campaign=
        <Pill>new-menu</Pill>
      </p>
      <p className="text-[14px] leading-relaxed text-muted">
        Paste a link, tap where you’ll share it, and your finished link lands here — ready to copy
        or turn into a QR code.
      </p>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[6px] bg-signal-soft box-decoration-clone px-1.5 py-0.5 break-normal text-signal-ink [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

/**
 * The finished link, readable: the page's address plain, the tracking parts after it quiet, with
 * each value softly highlighted. Copying a selection gives the link as it really is.
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
      className="mono-num rounded-[16px] bg-subtle p-4 text-[13px] leading-[2] break-all shadow-[inset_0_0_0_1px_var(--color-line)] lg:text-[12.5px]"
    >
      <span className="text-faint">{/^https?:\/\//.exec(link.base)?.[0]}</span>
      <span className="text-ink">{link.base.replace(/^https?:\/\//, '')}</span>
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
        text: 'Tap where you’ll share it (step 2), so your analytics knows where visits came from.',
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
          text: 'The medium is empty. Add one under Fine-tune, like social or email.',
          tone: 'caution',
        });
    }
  }
  for (const { tag, problem } of untidyTags(tags))
    notes.push({
      text:
        problem === 'capitals'
          ? `${TAG_HELP[tag].label} has capital letters. Reports count “Instagram” and “instagram” as two different things.`
          : `${TAG_HELP[tag].label} has spaces, which become %20 in the link. Try ${slug(tags[tag])}.`,
      tone: 'caution',
    });

  // Always in the page (so changes are announced), taking no room while there's nothing to say.
  return (
    <ul aria-live="polite" className={cn('grid gap-2', notes.length === 0 && 'sr-only')}>
      {notes.map((note) => (
        <li key={note.text}>
          <Note tone={note.tone} icon={note.tone === 'caution' ? 'alert' : 'arrow-left'}>
            {note.text}
          </Note>
        </li>
      ))}
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
