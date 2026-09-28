'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { BASE_PATH } from '@/lib/base-path';
import { encodeState, newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  DESIGN_IDS,
  DESIGNS,
  hostOf,
  monogram,
  NETWORK_IDS,
  NETWORKS,
  newSignalPage,
  publishedLinks,
  safeHref,
  signalPageSchema,
  socialHref,
  type DesignId,
  type NetworkId,
  type SignalPage,
} from '@/lib/tools/signal-pages';
import {
  ActionBar,
  ActionButton,
  IconButton,
  Journey,
  Note,
  SampleButton,
  Surface,
  useCopy,
} from './kit';
import { LinkQr } from './share-link';
import { SignalPageView } from './signal-page-view';

/*
 * Signal Pages: a link-in-bio page, made in three steps — pick a look, fill in the phone, share
 * it. The page is published as a link that carries the page itself, so Hyphy never stores it.
 */

const STEPS = ['Pick a look', 'Add your links', 'Share your page'];

/** The page's own address: /p#… (the page rides after the #). */
async function pageLink(page: SignalPage) {
  return `${window.location.origin}${BASE_PATH}/p#${await encodeState(page)}`;
}

/** An invented maker, for "Try a sample". */
const SAMPLE: Omit<SignalPage, 'design'> = {
  v: 1,
  name: 'Mara Quill',
  handle: 'maraquill.studio',
  bio: 'Ceramicist. Small-batch mugs and bowls, open studio every Saturday.',
  links: [
    { id: 's1', label: 'Shop the new mugs', url: 'maraquill.example/shop' },
    { id: 's2', label: 'Book a wheel class', url: 'maraquill.example/classes' },
    { id: 's3', label: 'Studio letters', url: 'maraquill.example/letters' },
  ],
  socials: [
    { network: 'instagram', value: '@maraquill.studio' },
    { network: 'email', value: 'hello@maraquill.example' },
  ],
};

/* ---------------- a title from a pasted link ---------------- */

const KNOWN_SITES: [RegExp, string, IconName?][] = [
  [/(^|\.)instagram\.com$/, 'Instagram', 'instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok', 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube', 'youtube'],
  [/(^|\.)spotify\.com$/, 'Listen on Spotify', 'spotify'],
  [/(^|\.)music\.apple\.com$/, 'Listen on Apple Music', 'music'],
  [/(^|\.)(x|twitter)\.com$/, 'X', 'x-social'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn', 'linkedin'],
  [/(^|\.)facebook\.com$/, 'Facebook', 'facebook'],
  [/(^|\.)substack\.com$/, 'Read the newsletter', 'mail'],
  [/(^|\.)patreon\.com$/, 'Support me on Patreon', 'heart'],
  [/(^|\.)etsy\.com$/, 'Shop on Etsy', 'store'],
  [/(^|\.)calendly\.com$/, 'Book a call', 'calendar'],
  [/(^|\.)(opentable|resy)\.com$/, 'Book a table', 'utensils'],
  [/(^|\.)eventbrite\./, 'Get tickets', 'ticket'],
  [/(^|\.)(soundcloud|bandcamp)\.com$/, 'Listen', 'music'],
  [/(^|\.)twitch\.tv$/, 'Watch live', 'video'],
  [/(^|\.)github\.com$/, 'GitHub', 'braces'],
];

const KNOWN_PATHS: [RegExp, string, IconName][] = [
  [/menu/, 'See the menu', 'utensils'],
  [/reserv|table/, 'Book a table', 'utensils'],
  [/book|appoint|schedule/, 'Book now', 'calendar'],
  [/shop|store|product/, 'Shop', 'store'],
  [/ticket|event/, 'Get tickets', 'ticket'],
  [/newsletter|subscribe|letter/, 'Join the newsletter', 'mail'],
  [/class|course|workshop/, 'Classes', 'calendar'],
  [/podcast|listen/, 'Listen', 'music'],
  [/blog|journal|read/, 'Read the blog', 'file-text'],
  [/portfolio|work|gallery/, 'See my work', 'image-lucide'],
  [/tip|donate|support/, 'Leave a tip', 'heart'],
  [/contact/, 'Get in touch', 'message'],
  [/about/, 'About me', 'user'],
];

/** What a pasted link probably is: a button name and an icon. Always editable afterwards. */
function guess(url: string): { title: string; icon: IconName } {
  const href = safeHref(url);
  if (!href) return { title: '', icon: 'link-2' };
  if (href.startsWith('mailto:')) return { title: 'Email me', icon: 'mail' };
  if (href.startsWith('tel:')) return { title: 'Call me', icon: 'phone' };
  const host = hostOf(href);
  const site = KNOWN_SITES.find(([pattern]) => pattern.test(host));
  if (site) return { title: site[1], icon: site[2] ?? 'globe' };
  const path = new URL(href).pathname.toLowerCase();
  const kind = KNOWN_PATHS.find(([pattern]) => pattern.test(path));
  if (kind) return { title: kind[1], icon: kind[2] };
  // "salt-and-ember.example" → "Salt And Ember"
  const name = host.split('.')[0].replace(/[-_]+/g, ' ').trim();
  return {
    title: name ? name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : '',
    icon: 'globe',
  };
}

/* ---------------- the tool ---------------- */

export function SignalPagesTool() {
  const id = useId();
  const [page, setPage, { loaded, reset }] = useLocalState<SignalPage>(
    'hyphy.signal-pages.v1',
    signalPageSchema,
    newSignalPage(),
  );
  const update = (patch: Partial<SignalPage>) => setPage((current) => ({ ...current, ...patch }));
  const links = publishedLinks(page);
  const ready = Boolean(page.name.trim() && links.length > 0);
  const started = Boolean(page.name.trim() || page.links.some((link) => link.url.trim()));
  // Someone coming back to a page they started lands on its words; everyone else picks a look.
  const [chosenStep, setStep] = useState<number | null>(null);
  const step = chosenStep ?? (started ? 1 : 0);
  const [nudge, setNudge] = useState(false);

  const go = (next: number) => {
    setStep(next);
    setNudge(false);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(`${id}-top`)
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const toShare = () => {
    if (ready) return go(2);
    setNudge(true);
    const missing = !page.name.trim() ? `${id}-name` : `${id}-link-0`;
    document.getElementById(missing)?.focus();
  };

  return (
    <div id={`${id}-top`} className="grid scroll-mt-24 gap-5">
      <Journey
        steps={STEPS}
        current={step}
        onPick={(index) => (index === 2 ? toShare() : go(index))}
        reachable={(index) => index < 2 || ready}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:gap-8">
        {/* The page on a phone: the live preview, and on step 2 the place to type. */}
        <div
          className={cn(
            'grid content-start gap-3 lg:sticky lg:top-24 lg:self-start',
            step === 0 && 'max-lg:hidden',
            step === 2 && 'max-lg:order-last',
          )}
        >
          <Phone page={page} fixed={step !== 1}>
            <SignalPageView
              page={page}
              compact
              edit={
                step === 1
                  ? {
                      onChange: update,
                      ids: { name: `${id}-name`, handle: `${id}-handle`, bio: `${id}-bio` },
                    }
                  : undefined
              }
              footer={<p className="mt-8 text-[10.5px] opacity-45">Made with Hyphy Signal</p>}
            />
          </Phone>
          <p className="flex items-center justify-center gap-1.5 text-center text-[13px] text-muted">
            {step === 1 ? (
              <>
                <Icon name="pencil" size={13} /> Tap the page to write on it
              </>
            ) : (
              'Live preview'
            )}
          </p>
        </div>

        <div className="grid min-w-0 content-start gap-5">
          {step === 0 && (
            <PickLook
              page={page}
              onPick={(design) => update({ design })}
              onNext={() => go(1)}
              onSample={
                started
                  ? undefined
                  : () => {
                      setPage((current) => ({ ...SAMPLE, design: current.design }));
                      go(1);
                    }
              }
            />
          )}
          {step === 1 && (
            <>
              <LinksEditor id={id} page={page} update={update} />
              <SocialsEditor page={page} update={update} />
              <ActionBar className="lg:sticky lg:bottom-4">
                {nudge && !ready && (
                  <p role="status" className="mb-2 text-center text-[13.5px] text-muted">
                    {!page.name.trim()
                      ? 'Add your name at the top of the page first.'
                      : 'Add one link, with a name, to share your page.'}
                  </p>
                )}
                <ActionButton icon="arrow-right" onClick={toShare}>
                  Next: share your page
                </ActionButton>
              </ActionBar>
            </>
          )}
          {step === 2 && (
            <ShareStep
              page={page}
              onEdit={() => go(1)}
              onStartOver={
                loaded
                  ? () => {
                      if (!window.confirm('Start over? Everything on this page will be cleared.'))
                        return;
                      reset(newSignalPage());
                      go(0);
                    }
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** A phone around the page: a scrolling screen on desktops, the page's full height on phones. */
function Phone({
  page,
  fixed,
  children,
}: {
  page: SignalPage;
  fixed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mx-auto w-full max-w-[340px] rounded-[48px] bg-[#0c0c0b] p-2.5 shadow-pop ring-1 ring-white/10 lg:max-w-[350px]"
      style={{ boxShadow: `0 40px 80px -40px var(--glow, transparent)` }}
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-[40px] lg:h-[640px]',
          fixed ? 'h-[560px]' : 'min-h-[440px]',
        )}
        style={{ background: DESIGNS[page.design].background }}
      >
        <span
          aria-hidden="true"
          className="absolute top-3 left-1/2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-[#0c0c0b]"
        />
        <div className="scrollbar-none h-full overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- 1 · Pick a look ---------------- */

function PickLook({
  page,
  onPick,
  onNext,
  onSample,
}: {
  page: SignalPage;
  onPick: (design: DesignId) => void;
  onNext: () => void;
  onSample?: () => void;
}) {
  return (
    <Surface className="grid gap-5 sm:!p-6">
      <div>
        <h2
          className="font-display text-[26px] leading-[1.05] font-bold tracking-[-0.03em] text-ink sm:text-[30px]"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          Pick a look.
        </h2>
      </div>
      <div
        role="radiogroup"
        aria-label="Design"
        className="grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 sm:gap-x-3.5"
      >
        {DESIGN_IDS.map((key) => (
          <DesignThumb key={key} id={key} page={page} on={page.design === key} onPick={onPick} />
        ))}
      </div>
      <ActionBar className="!mt-1">
        <ActionButton icon="arrow-right" onClick={onNext}>
          Next: add your links
        </ActionButton>
        {onSample && (
          <SampleButton onClick={onSample} className="mt-1.5">
            Try a sample page
          </SampleButton>
        )}
      </ActionBar>
    </Surface>
  );
}

/** A design, drawn small: the name in its type, the avatar, three buttons. */
function DesignThumb({
  id,
  page,
  on,
  onPick,
}: {
  id: DesignId;
  page: SignalPage;
  on: boolean;
  onPick: (design: DesignId) => void;
}) {
  const design = DESIGNS[id];
  const square = design.button.radius === 0;
  const name = page.name.trim() || 'Your name';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => onPick(id)}
      className="group grid min-w-0 justify-items-center gap-2 text-[13px] active:scale-[.98]"
    >
      <span
        className={cn(
          'fx-move relative flex aspect-[10/16] w-full flex-col items-center overflow-hidden rounded-[18px] px-2.5 pt-4',
          on && '-translate-y-1 scale-[1.03]',
          on
            ? 'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--accent,var(--color-ink))]'
            : 'shadow-[inset_0_0_0_1px_var(--color-line)] group-hover:-translate-y-1',
        )}
        style={{ background: design.background, color: design.fg }}
      >
        <span
          className={cn(
            'grid size-7 shrink-0 place-items-center text-[12px] font-bold',
            square ? 'rounded-none' : 'rounded-full',
          )}
          style={{ background: design.avatar.bg, color: design.avatar.fg }}
        >
          {monogram(page)}
        </span>
        <span
          className="mt-2 w-full truncate text-[12px] leading-tight font-bold"
          style={{
            fontFamily:
              design.font === 'mono'
                ? 'var(--font-martian), monospace'
                : design.font === 'display'
                  ? 'var(--font-zero), var(--font-hubot), sans-serif'
                  : 'var(--font-mona), sans-serif',
            textTransform: design.font === 'mono' ? 'uppercase' : undefined,
            letterSpacing: '-0.02em',
          }}
        >
          {name}
        </span>
        <span
          className="mt-1 h-[3px] w-6 rounded-full opacity-40"
          style={{ background: design.fg }}
        />
        <span className="mt-3 grid w-full gap-1.5">
          {[0, 1, 2].map((bar) => (
            <span
              key={bar}
              className="h-4 w-full"
              style={{
                background: design.button.bg,
                borderRadius: Math.min(design.button.radius, 8),
                boxShadow: `inset 0 0 0 ${square ? 1.5 : 1}px ${design.button.border}`,
              }}
            />
          ))}
        </span>
        {on && (
          <span
            aria-hidden="true"
            className="fx-pop absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-full text-[var(--on-accent,#12110d)] shadow-card"
            style={{ background: 'var(--accent, var(--color-ink))' }}
          >
            <Icon name="check" size={13} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className={on ? 'font-semibold text-ink' : 'text-muted'}>{design.name}</span>
    </button>
  );
}

/* ---------------- 2 · Add your links ---------------- */

const fieldClass =
  'h-11 w-full min-w-0 rounded-[11px] bg-transparent px-2 text-[16px] text-ink outline-none placeholder:text-faint focus:bg-well lg:text-[15px]';

function LinksEditor({
  id,
  page,
  update,
}: {
  id: string;
  page: SignalPage;
  update: (patch: Partial<SignalPage>) => void;
}) {
  const [added, setAdded] = useState<string | null>(null);
  const canPaste = useSyncExternalStore(
    noop,
    () => typeof navigator.clipboard?.readText === 'function',
    () => false,
  );
  const unusable = page.links.filter((link) => link.url.trim() && !safeHref(link.url));

  const setLink = (linkId: string, patch: { label?: string; url?: string }) =>
    update({
      links: page.links.map((item) => {
        if (item.id !== linkId) return item;
        if (patch.url === undefined) return { ...item, ...patch };
        // A new address brings a new name, unless the name was written by hand.
        const before = guess(item.url).title;
        const handmade = item.label.trim() !== '' && item.label !== before;
        return { ...item, url: patch.url, label: handmade ? item.label : guess(patch.url).title };
      }),
    });

  const moveLink = (index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= page.links.length) return;
    const next = [...page.links];
    [next[index], next[target]] = [next[target], next[index]];
    update({ links: next });
  };

  const addLink = () => {
    const linkId = newId(6);
    setAdded(linkId);
    update({ links: [...page.links, { id: linkId, label: '', url: '' }] });
  };

  /** One tap: what's on the clipboard becomes a button, named from where it goes. */
  const pasteLink = async () => {
    let text = '';
    try {
      text = (await navigator.clipboard.readText()).trim().slice(0, 800);
    } catch {
      // Not allowed here: an empty row takes a long-press paste instead.
    }
    if (!text) return addLink();
    const slot = page.links.find((item) => !item.url.trim() && !item.label.trim());
    if (slot) {
      setAdded(null);
      return update({
        links: page.links.map((item) =>
          item.id === slot.id ? { ...item, url: text, label: guess(text).title } : item,
        ),
      });
    }
    if (page.links.length >= 12) return;
    update({ links: [...page.links, { id: newId(6), label: guess(text).title, url: text }] });
  };

  return (
    <Surface className="grid gap-4 sm:!p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-[22px] leading-tight font-bold tracking-[-0.025em] text-ink">
            Your links
          </h2>
        </div>
        <span className="mono-num shrink-0 text-[12px] text-faint">{page.links.length}/12</span>
      </div>
      {canPaste && page.links.length < 12 && (
        <button
          type="button"
          onClick={pasteLink}
          className="flex min-h-14 items-center justify-center gap-2 rounded-[18px] text-[16px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-18px_var(--accent)] transition-transform active:scale-[.97]"
          style={{ background: 'var(--accent, var(--color-ink))' }}
        >
          <Icon name="clipboard" size={18} /> Paste a link
        </button>
      )}

      <ol className="grid gap-2.5">
        {page.links.map((link, index) => {
          const broken = link.url.trim() !== '' && !safeHref(link.url);
          const { icon } = guess(link.url);
          const named = link.url.trim() !== '' || link.label.trim() !== '';
          return (
            <li
              key={link.id}
              className={cn(
                'grid animate-rise gap-0.5 rounded-[18px] bg-subtle p-1.5 shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-signal))]',
                broken && '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  key={`${icon}-${Boolean(safeHref(link.url))}`}
                  aria-hidden="true"
                  className={cn(
                    'grid size-11 shrink-0 place-items-center rounded-[13px] transition-colors',
                    safeHref(link.url)
                      ? 'fx-pop text-[var(--on-accent,#12110d)]'
                      : 'bg-well text-muted',
                  )}
                  style={
                    safeHref(link.url)
                      ? { background: 'var(--accent, var(--color-ink))' }
                      : undefined
                  }
                >
                  <Icon name={icon} size={18} />
                </span>
                <input
                  id={`${id}-link-${index}`}
                  aria-label={`Link ${index + 1} address`}
                  aria-invalid={broken}
                  value={link.url}
                  maxLength={800}
                  inputMode="url"
                  enterKeyHint="done"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="url"
                  spellCheck={false}
                  // A freshly added row is where the next paste goes.
                  autoFocus={link.id === added}
                  placeholder={index === 0 ? 'Paste a link, like yourshop.example' : 'Paste a link'}
                  onChange={(event) => setLink(link.id, { url: event.target.value })}
                  className={cn(fieldClass, 'text-[15px] text-ink-2 lg:text-[14px]')}
                />
                <IconButton
                  icon="trash"
                  tone="danger"
                  size="sm"
                  className="!size-11 lg:!size-9"
                  label={`Remove link ${index + 1}`}
                  onClick={() =>
                    update({ links: page.links.filter((item) => item.id !== link.id) })
                  }
                />
              </div>
              {named && (
                <div className="flex items-center gap-1.5 pl-[50px]">
                  <input
                    aria-label={`Link ${index + 1} name`}
                    value={link.label}
                    maxLength={60}
                    enterKeyHint="done"
                    placeholder="Name this button"
                    onChange={(event) => setLink(link.id, { label: event.target.value })}
                    className={cn(fieldClass, 'font-semibold')}
                  />
                  {page.links.length > 1 && (
                    <>
                      <IconButton
                        icon="arrow-up"
                        label={`Move link ${index + 1} up`}
                        size="sm"
                        className="!size-11 lg:!size-9"
                        disabled={index === 0}
                        onClick={() => moveLink(index, -1)}
                      />
                      <IconButton
                        icon="arrow-down"
                        label={`Move link ${index + 1} down`}
                        size="sm"
                        className="!size-11 lg:!size-9"
                        disabled={index === page.links.length - 1}
                        onClick={() => moveLink(index, 1)}
                      />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {page.links.length < 12 && (
        <button
          type="button"
          onClick={addLink}
          className="flex min-h-13 items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-line-strong text-[15px] font-medium text-ink-2 transition-colors hover:border-[var(--accent,var(--color-ink))] hover:text-ink"
        >
          <Icon name="plus" size={17} /> Add {page.links.length ? 'another' : 'a'} link
        </button>
      )}
      {unusable.length > 0 && (
        <Note icon="alert" tone="caution">
          {unusable.length === 1 ? 'One link' : `${unusable.length} links`} won’t open — use a web
          address (yourshop.example), an email or a phone link.
        </Note>
      )}
    </Surface>
  );
}

function placeholderFor(network: NetworkId) {
  switch (network) {
    case 'email':
      return 'hello@yourshop.example';
    case 'website':
      return 'yourshop.example';
    case 'spotify':
      return 'Link to your profile or playlist';
    default:
      return '@yourname';
  }
}

function SocialsEditor({
  page,
  update,
}: {
  page: SignalPage;
  update: (patch: Partial<SignalPage>) => void;
}) {
  const [added, setAdded] = useState<NetworkId | null>(null);
  const left = NETWORK_IDS.filter(
    (network) => !page.socials.some((social) => social.network === network),
  );
  return (
    <Surface className="grid gap-3.5 sm:!p-6">
      <div>
        <h2 className="font-display text-[19px] leading-tight font-bold tracking-[-0.02em] text-ink">
          Socials <span className="font-sans text-[14px] font-normal text-faint">optional</span>
        </h2>
      </div>
      {page.socials.length > 0 && (
        <ul className="grid gap-2">
          {page.socials.map((social) => {
            const info = NETWORKS[social.network];
            const broken = social.value.trim() !== '' && !socialHref(social.network, social.value);
            return (
              <li
                key={social.network}
                className={cn(
                  'flex animate-rise items-center gap-1.5 rounded-[16px] bg-subtle p-1.5 shadow-[inset_0_0_0_1px_var(--color-line)] focus-within:shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-signal))]',
                  broken && '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]',
                )}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-well text-ink-2">
                  <Icon name={info.icon as IconName} size={17} />
                </span>
                <input
                  aria-label={`${info.name}${social.network === 'email' ? ' address' : ' handle or link'}`}
                  aria-invalid={broken}
                  value={social.value}
                  maxLength={200}
                  inputMode={social.network === 'email' ? 'email' : undefined}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  autoFocus={social.network === added}
                  placeholder={placeholderFor(social.network)}
                  onChange={(event) =>
                    update({
                      socials: page.socials.map((item) =>
                        item.network === social.network
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    })
                  }
                  className={fieldClass}
                />
                <IconButton
                  icon="x"
                  size="sm"
                  className="!size-11 lg:!size-9"
                  label={`Remove ${info.name}`}
                  onClick={() =>
                    update({
                      socials: page.socials.filter((item) => item.network !== social.network),
                    })
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
      {left.length > 0 && page.socials.length < 8 && (
        <div className="scroller -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {left.map((network) => (
            <button
              key={network}
              type="button"
              onClick={() => {
                setAdded(network);
                update({ socials: [...page.socials, { network, value: '' }] });
              }}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-well pr-3.5 pl-3 text-[14px] text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink active:scale-[.97] lg:h-10"
            >
              <Icon name={NETWORKS[network].icon as IconName} size={15} />
              {NETWORKS[network].name}
            </button>
          ))}
        </div>
      )}
    </Surface>
  );
}

/* ---------------- 3 · Share your page ---------------- */

const noop = () => () => {};

const quiet =
  'inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-well px-4 text-[15px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40 lg:h-11 lg:text-[14.5px]';

function ShareStep({
  page,
  onEdit,
  onStartOver,
}: {
  page: SignalPage;
  onEdit: () => void;
  onStartOver?: () => void;
}) {
  const router = useRouter();
  const { copy, copied } = useCopy();
  const [url, setUrl] = useState('');
  const canShare = useSyncExternalStore(
    noop,
    () => 'share' in navigator,
    () => false,
  );

  // The link is the page: it's made again whenever the page changes.
  useEffect(() => {
    let alive = true;
    void pageLink(page).then((next) => alive && setUrl(next));
    return () => {
      alive = false;
    };
  }, [page]);

  const share = async () => {
    if (!url) return;
    if (!canShare) return void copy(url, 'Link copied');
    try {
      await navigator.share({ title: page.name.trim() || 'My links', url });
    } catch {
      // Cancelled, or not allowed here: Copy is right beside it.
    }
  };

  const first = page.name.trim().split(/\s+/)[0];

  return (
    <Surface className="relative isolate grid gap-5 overflow-hidden sm:!p-7">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(70% 50% at 50% 0%, color-mix(in srgb, var(--accent, transparent) 16%, transparent), transparent 70%)',
        }}
      />
      <div className="text-center">
        <p className="fx-pop inline-flex items-center gap-2 rounded-full bg-ink/[.06] px-3.5 py-1.5 text-[14px] font-semibold text-ink">
          <Icon name="check" size={15} className="text-[var(--accent-ink)]" /> Your page is ready
        </p>
        <h2
          className="fx-stamp mt-4 font-display text-[34px] leading-[1] font-bold tracking-[-0.035em] text-balance text-ink sm:text-[44px]"
          style={{ fontVariationSettings: "'wdth' 110" }}
        >
          {first ? `Go on, ${first}. Share it.` : 'Go on. Share it.'}
        </h2>
        <p className="mx-auto mt-2 max-w-[36ch] text-[15px] leading-snug text-muted">
          Your bio, a message, a table card.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ActionButton
          icon={canShare ? 'share' : copied === url && url ? 'check' : 'copy'}
          onClick={share}
          disabled={!url}
          className="sm:col-span-2"
        >
          {canShare ? 'Share your page' : copied === url && url ? 'Copied' : 'Copy your link'}
        </ActionButton>
        {canShare && (
          <button
            type="button"
            disabled={!url}
            onClick={() => copy(url, 'Link copied')}
            className={quiet}
          >
            <Icon name={copied === url && url ? 'check' : 'copy'} size={17} />
            {copied === url && url ? 'Copied' : 'Copy link'}
          </button>
        )}
        <button
          type="button"
          disabled={!url}
          onClick={() => window.open(url, '_blank', 'noopener')}
          className={cn(quiet, !canShare && 'sm:col-span-2')}
        >
          <Icon name="external" size={17} /> Open your page
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-2 rounded-[14px] bg-subtle py-2 pr-2 pl-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <Icon name="link" size={15} className="shrink-0 text-muted" />
        <span className="mono-num min-w-0 flex-1 truncate text-[12.5px] text-muted">
          {url || 'Making your link…'}
        </span>
      </div>

      {url && url.length <= 1600 && (
        <div className="grid items-center gap-4 rounded-[20px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-[148px_minmax(0,1fr)]">
          <div className="mx-auto w-[180px] rounded-[16px] bg-white p-2.5 sm:w-full">
            <LinkQr url={url} className="!rounded-none" />
          </div>
          <div className="text-center sm:text-left">
            <p className="text-[16px] font-semibold text-ink">Scan to open</p>
            <button
              type="button"
              onClick={() => router.push(`/tools/qr#link=${encodeURIComponent(url)}`)}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-signal-ink underline-offset-2 hover:underline lg:min-h-9"
            >
              <Icon name="qr" size={15} /> Style it in QR Studio
            </button>
          </div>
        </div>
      )}

      <p className="text-center text-[13px] text-muted">Changed something? Share the new link.</p>
      <div className="flex flex-wrap items-center justify-center gap-x-4">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-ink-2 hover:text-ink"
        >
          <Icon name="pencil" size={14} /> Edit the page
        </button>
        {onStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className="min-h-11 text-[13.5px] text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Start over
          </button>
        )}
      </div>
    </Surface>
  );
}
