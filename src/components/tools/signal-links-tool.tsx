'use client';
import Link from 'next/link';
import { useId, useState, type ClipboardEvent, type ReactNode } from 'react';
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
import { IconButton, Label, Note, Surface, useCopy } from './kit';

/*
 * Signal Links: a page's address, turned into a campaign link, so your own analytics can say
 * which post, email or flyer brought people in. Plain questions first; the raw tags wait under
 * Advanced. Built on this device: the link goes straight to your page and nothing here counts
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
  flyer: 'file-text',
  'business-card': 'contact',
  'google-business': 'store',
  'paid-ad': 'megaphone',
};

const accent = 'var(--accent,var(--color-signal))';
const field =
  'h-11 w-full min-w-0 rounded-[11px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none transition-shadow placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal),0_0_0_4px_rgb(106_116_255/.14)] lg:h-10 lg:text-[14.5px]';
const inkButton =
  'inline-flex h-12 items-center justify-center gap-2 rounded-[12px] bg-ink px-4 text-[15.5px] font-semibold text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40 lg:h-11 lg:text-[14.5px]';
const quietButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-well px-3.5 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40 lg:h-10 lg:text-[13.5px]';

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

function StepTitle({ n, id, children }: { n: number; id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="flex items-center gap-2.5 text-[16px] font-semibold text-ink">
      <span
        aria-hidden="true"
        className="mono-num grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold text-[#12110d]"
        style={{ background: accent }}
      >
        {n}
      </span>
      {children}
    </h3>
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
  const [advanced, setAdvanced] = useState(false);
  const [recent, setRecent, { loaded }] = useLocalState<Recent[]>(STORAGE_KEY, recentSchema, []);

  const page = readPage(draft.page);
  const tags = tagsFor(draft);
  const suggested = suggestedTags(draft);
  const link = page.ok ? campaignLink(page.url, tags) : null;
  const place = placeById(draft.place);
  const started = draft.page.trim() !== '' || draft.place !== null || draft.purpose.trim() !== '';
  const pageError = !page.ok && !page.empty && entry !== 'typing' ? page.message : '';

  const choosePlace = (placeId: PlaceId) =>
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
    setAdvanced(Object.keys(next.raw).length > 0);
    if (!message) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(`${id}-builder`)
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    toast({ title: message, icon: 'link' });
  };

  const clearRecent = () => {
    if (!window.confirm('Clear your recent links from this browser?')) return;
    setRecent([]);
  };

  const qrFirst = Boolean(place?.qr);

  return (
    <div className="grid gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,.88fr)] lg:items-start">
        <Surface
          as="section"
          id={`${id}-builder`}
          aria-labelledby={`${id}-title`}
          className="grid scroll-mt-24 gap-8 sm:!p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2
                id={`${id}-title`}
                className="font-display text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[24px]"
              >
                Create a trackable campaign link
              </h2>
              <p className="mt-1.5 max-w-[52ch] text-[14px] leading-relaxed text-muted">
                Three questions. Then your analytics can show which post, email or flyer actually
                brought people in.
              </p>
            </div>
            {started ? (
              <button
                type="button"
                onClick={() => load(emptyDraft())}
                className="-mx-3 -my-1 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-9"
              >
                <Icon name="restore" size={15} /> Start over
              </button>
            ) : (
              <button
                type="button"
                onClick={() => load(exampleDraft())}
                className="-mx-3 -my-1 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-signal-ink transition-colors hover:bg-signal-soft lg:h-9"
              >
                <Icon name="sparkles" size={15} /> Try an example
              </button>
            )}
          </div>

          <section aria-labelledby={`${id}-s1`} className="grid gap-3">
            <StepTitle n={1} id={`${id}-s1`}>
              Where are you sending people?
            </StepTitle>
            <div className="relative">
              <Icon
                name="globe"
                size={18}
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
              />
              <input
                id={`${id}-page`}
                aria-labelledby={`${id}-s1`}
                aria-describedby={`${id}-page-note`}
                aria-invalid={pageError ? true : undefined}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="url"
                spellCheck={false}
                maxLength={4000}
                placeholder="Paste a link, like shop.example/menu"
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
                  '!h-14 pr-12 pl-11 !text-[16px] aria-[invalid=true]:shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
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
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 max-lg:!size-11 lg:right-2.5"
                />
              )}
            </div>
            <div id={`${id}-page-note`} className="grid gap-2 text-[13px] leading-relaxed">
              {page.ok ? (
                <p className="flex min-w-0 items-start gap-2 text-muted">
                  <Icon name="check" size={15} className="mt-[3px] shrink-0 text-positive" />
                  <span className="min-w-0 break-all">
                    Sending people to <span className="text-ink-2">{page.url.href}</span>
                    {page.addedHttps && <span className="text-faint"> (https:// added)</span>}
                  </span>
                </p>
              ) : pageError ? (
                <p className="flex items-start gap-2 text-critical">
                  <Icon name="alert" size={15} className="mt-[3px] shrink-0" />
                  {pageError}
                </p>
              ) : (
                <p className="text-muted">
                  Your shop, menu, booking page or sign-up form. Anything after a ? or # in it is
                  kept.
                </p>
              )}
              {link && link.replaced.length > 0 && (
                <Note tone="caution" icon="replace">
                  This address already had campaign tags (
                  <span className="mono-num break-all">{link.replaced.join(', ')}</span>). They’re
                  replaced by the ones below.
                </Note>
              )}
            </div>
          </section>

          <section aria-labelledby={`${id}-s2`} className="grid gap-3">
            <StepTitle n={2} id={`${id}-s2`}>
              Where will people see this link?
            </StepTitle>
            <div
              role="radiogroup"
              aria-labelledby={`${id}-s2`}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {PLACES.map((option) => {
                const on = draft.place === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => choosePlace(option.id)}
                    className={cn(
                      'flex min-h-[60px] min-w-0 items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-[background-color,box-shadow] sm:min-h-[68px]',
                      on
                        ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent,var(--color-signal))]'
                        : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/5 hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
                    )}
                  >
                    {/* A tile on a phone is narrow: the icon moves in beside the name there. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'hidden size-9 shrink-0 place-items-center rounded-[10px] transition-colors sm:grid',
                        on ? 'text-[#12110d]' : 'bg-well text-ink-2',
                      )}
                      style={on ? { background: accent } : undefined}
                    >
                      <Icon name={PLACE_ICONS[option.id]} size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-tight font-medium text-ink">
                        <Icon
                          name={PLACE_ICONS[option.id]}
                          size={15}
                          className={cn(
                            'mr-1.5 inline-block align-[-2.5px] sm:hidden',
                            on ? 'text-[var(--accent,var(--color-signal))]' : 'text-muted',
                          )}
                        />
                        {option.label}
                        {option.qr && (
                          <>
                            <Icon
                              name="qr"
                              size={13}
                              className="ml-1.5 inline-block align-[-2px] text-muted"
                            />
                            <span className="sr-only">, printed as a QR code</span>
                          </>
                        )}
                      </span>
                      <span className="mono-num mt-1 block text-[11px] leading-snug break-words text-muted">
                        {option.source} · {option.medium}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby={`${id}-s3`} className="grid gap-4">
            <StepTitle n={3} id={`${id}-s3`}>
              What’s it for?
            </StepTitle>
            <div className="grid gap-1.5">
              <input
                id={`${id}-purpose`}
                aria-labelledby={`${id}-s3`}
                aria-describedby={`${id}-purpose-note`}
                autoComplete="off"
                maxLength={120}
                placeholder="Fall menu launch"
                value={draft.purpose}
                onChange={(event) => setPurpose(event.target.value)}
                className={field}
              />
              <p id={`${id}-purpose-note`} className="text-[12.5px] leading-relaxed text-muted">
                {tags.utm_campaign ? (
                  <>
                    In the link as <TagValue>{tags.utm_campaign}</TagValue>
                    {draft.raw.utm_campaign !== undefined && ' (typed under Advanced)'}
                  </>
                ) : (
                  'The promotion, event or post. Every link for it shares this name.'
                )}
              </p>
            </div>
            <div className="grid gap-1.5">
              <label
                htmlFor={`${id}-version`}
                className="flex items-baseline justify-between gap-2 text-[13.5px] font-medium text-ink-2"
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
              <p id={`${id}-version-note`} className="text-[12.5px] leading-relaxed text-muted">
                Only if you’re comparing two versions, like two flyer designs.
                {tags.utm_content && (
                  <>
                    {' '}
                    In the link as <TagValue>{tags.utm_content}</TagValue>
                  </>
                )}
              </p>
            </div>
          </section>

          <section className="-mt-2 grid gap-4 border-t border-line pt-5">
            <button
              type="button"
              aria-expanded={advanced}
              aria-controls={`${id}-advanced`}
              onClick={() => setAdvanced((value) => !value)}
              className="-my-1 inline-flex min-h-11 flex-wrap items-center gap-x-2 justify-self-start text-left text-[14px] font-medium text-ink-2 hover:text-ink lg:min-h-9"
            >
              <Icon
                name="chevron-down"
                size={16}
                className={cn('transition-transform', advanced && 'rotate-180')}
              />
              Advanced: edit the tags directly
              <span className="mono-num text-[11.5px] font-normal text-faint">utm_source…</span>
            </button>
            {advanced && (
              <div id={`${id}-advanced`} className="grid animate-fade gap-4">
                <p className="text-[13px] leading-relaxed text-muted">
                  These are the five standard campaign tags. The answers above fill them in; type
                  here to set one yourself.
                </p>
                {TAGS.map((tag) => (
                  <div
                    key={tag}
                    className="grid gap-1.5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-x-4"
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
                    <Icon name="restore" size={15} /> Use the answers above again
                  </button>
                )}
              </div>
            )}
          </section>
        </Surface>

        <aside aria-label="Your campaign link" className="grid gap-4 lg:sticky lg:top-24">
          <Surface className="grid gap-4 !p-5 sm:!p-6">
            <div className="flex items-baseline justify-between gap-3">
              <Label>Your campaign link</Label>
              <p aria-live="polite" className="text-[12.5px] text-muted">
                {link
                  ? `${link.tags.length} ${link.tags.length === 1 ? 'tag' : 'tags'} added`
                  : 'Needs a page'}
              </p>
            </div>
            <LinkPreview link={link} tags={tags} />
            {link ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {qrFirst ? (
                  <Link
                    href={qrStudioHref(link.href)}
                    onClick={() => rememberLink(link.href)}
                    className={cn(inkButton, 'sm:col-span-2')}
                  >
                    <Icon name="qr" size={17} /> Make a QR code
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={copyLink}
                    className={cn(inkButton, 'sm:col-span-2')}
                  >
                    <Icon name={copied === link.href ? 'check' : 'copy'} size={17} />
                    {copied === link.href ? 'Copied' : 'Copy link'}
                  </button>
                )}
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => rememberLink(link.href)}
                  className={quietButton}
                >
                  <Icon name="external" size={16} /> Open to test
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                {qrFirst ? (
                  <button type="button" onClick={copyLink} className={quietButton}>
                    <Icon name={copied === link.href ? 'check' : 'copy'} size={16} />
                    {copied === link.href ? 'Copied' : 'Copy link'}
                  </button>
                ) : (
                  <Link
                    href={qrStudioHref(link.href)}
                    onClick={() => rememberLink(link.href)}
                    className={quietButton}
                  >
                    <Icon name="qr" size={16} /> Make a QR code
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" disabled className={cn(inkButton, 'sm:col-span-2')}>
                  <Icon name="copy" size={17} /> Copy link
                </button>
                <button type="button" disabled className={quietButton}>
                  <Icon name="external" size={16} /> Open to test
                </button>
                <button type="button" disabled className={quietButton}>
                  <Icon name="qr" size={16} /> Make a QR code
                </button>
              </div>
            )}
            <Advice link={link} tags={tags} placeChosen={draft.place !== null} started={started} />
          </Surface>

          <Surface className="grid gap-3 !p-5 sm:!p-6">
            <Label>Where the results show up</Label>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
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
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
              <Icon name="lock" size={15} className="mt-[3px] shrink-0" />
              Hyphy doesn’t count clicks. The link goes straight to your page; the tags only label
              the visit.
            </p>
          </Surface>
        </aside>
      </div>

      {loaded && recent.length > 0 && (
        <Surface as="section" aria-labelledby={`${id}-recent`} className="grid gap-3 sm:!p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label id={`${id}-recent`}>Recent links · {recent.length}</Label>
              <p className="mt-1 text-[12.5px] text-muted">
                The last {recent.length === 1 ? 'one' : recent.length} you copied, opened or made
                into a code. Kept in this browser only.
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

/**
 * The link, readable: the page's address, then each tag on its own line, highlighted. Before
 * there's a page, the tags still show, so each answer visibly lands somewhere.
 */
function LinkPreview({ link, tags }: { link: CampaignLink | null; tags: Tags }) {
  const added = link
    ? link.tags
    : TAGS.filter((tag) => tags[tag]).map((tag) => ({
        tag,
        value: encodeURIComponent(tags[tag]),
      }));
  const query = link?.query ?? [];
  // Copying a selection gives the link without the line breaks shown here.
  const onCopy = (event: ClipboardEvent<HTMLElement>) => {
    const text = window.getSelection()?.toString() ?? '';
    if (!text) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text.replace(/\s+/g, ''));
  };
  return (
    <p
      onCopy={onCopy}
      className="mono-num rounded-[14px] bg-subtle p-4 text-[13px] leading-[1.75] break-all shadow-[inset_0_0_0_1px_var(--color-line)] lg:text-[12.5px]"
    >
      {link ? (
        <span className="text-ink">{link.base}</span>
      ) : (
        <span className="text-faint italic">your page’s address</span>
      )}
      {query.map((piece, index) => (
        <span key={`q${index}`} className="text-muted">
          {index === 0 ? '?' : '&'}
          {piece}
        </span>
      ))}
      {added.map(({ tag, value }, index) => (
        <span key={tag} className="block">
          <span className="text-faint">
            {index === 0 && query.length === 0 ? '?' : '&'}
            {tag}=
          </span>
          <span className="rounded-[5px] bg-signal-soft px-1 text-signal-ink">{value}</span>
        </span>
      ))}
      {link?.hash && <span className="block text-muted">{link.hash}</span>}
      {!link && added.length === 0 && (
        <span className="mt-1 block text-faint">+ the tags from your answers</span>
      )}
    </p>
  );
}

/** Gentle notes: what's missing, and hand-typed tags that will split your reports. */
function Advice({
  link,
  tags,
  placeChosen,
  started,
}: {
  link: CampaignLink | null;
  tags: Tags;
  placeChosen: boolean;
  started: boolean;
}) {
  const notes: string[] = [];
  if (!link) {
    notes.push(
      started
        ? 'Add the page you’re sending people to (step 1) and the link is ready.'
        : 'Start with the page you’re sending people to. The link builds as you answer.',
    );
  } else {
    const missing = missingTags(tags);
    if (missing.includes('utm_source') && missing.includes('utm_medium') && !placeChosen)
      notes.push(
        'Pick where people will see the link (step 2). It tells your analytics where visits came from.',
      );
    else {
      if (missing.includes('utm_source'))
        notes.push('The source is empty. Analytics needs it to say where visits came from.');
      if (missing.includes('utm_medium'))
        notes.push('The medium is empty. Add one under Advanced, like social or email.');
    }
    if (missing.includes('utm_campaign'))
      notes.push('Say what it’s for (step 3), so every link for this is counted together.');
  }
  for (const { tag, problem } of untidyTags(tags))
    notes.push(
      problem === 'capitals'
        ? `${TAG_HELP[tag].label} has capital letters. Reports count “Instagram” and “instagram” as two different things.`
        : `${TAG_HELP[tag].label} has spaces, which become %20 in the link. Hyphens read better.`,
    );

  // Always in the page (so changes are announced), taking no room while there's nothing to say.
  return (
    <ul aria-live="polite" className={cn('grid gap-2', notes.length === 0 && 'sr-only')}>
      {notes.map((note) => (
        <li key={note}>
          <Note tone={link ? 'caution' : 'quiet'} icon={link ? 'alert' : 'arrow-up'}>
            {note}
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
  const title = tags.utm_campaign || 'No campaign name';
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-well text-ink-2"
        >
          <Icon name={place ? PLACE_ICONS[place.id] : 'link-2'} size={17} />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[14.5px]">
            <span className="mono-num font-semibold break-all text-ink">{title}</span>
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
      <div className="flex gap-1.5 pl-12 sm:pl-0">
        <button type="button" onClick={onCopy} className={cn(quietButton, '!h-10 lg:!h-9')}>
          <Icon name={copied ? 'check' : 'copy'} size={15} />
          {copied ? 'Copied' : 'Copy'}
          <span className="sr-only"> {title}</span>
        </button>
        <button type="button" onClick={onReuse} className={cn(quietButton, '!h-10 lg:!h-9')}>
          <Icon name="pencil" size={15} /> Reuse<span className="sr-only"> {title}</span>
        </button>
        <IconButton icon="trash" tone="danger" label={`Delete ${title}`} onClick={onDelete} />
      </div>
    </li>
  );
}
