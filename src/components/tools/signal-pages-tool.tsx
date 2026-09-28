'use client';
import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { BASE_PATH } from '@/lib/base-path';
import { encodeState, newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  DESIGN_IDS,
  DESIGNS,
  NETWORK_IDS,
  NETWORKS,
  newSignalPage,
  publishedLinks,
  safeHref,
  signalPageSchema,
  socialHref,
  type NetworkId,
  type SignalPage,
} from '@/lib/tools/signal-pages';
import { IconButton, Label, Note, Surface } from './kit';
import { ShareLinkCard } from './share-link';
import { SignalPageView } from './signal-page-view';

/*
 * Signal Pages: a link-in-bio page, edited beside a live phone and published as a link that
 * carries the page itself — so Hyphy never stores it. Built from the Link Pages editor in Hyphy
 * Spaces, with more designs, socials and a public page anyone can open.
 */

/** The page's own address: /p#… (the page rides after the #). */
async function pageLink(page: SignalPage) {
  return `${window.location.origin}${BASE_PATH}/p#${await encodeState(page)}`;
}

export function SignalPagesTool() {
  const id = useId();
  const [page, setPage, { loaded, reset }] = useLocalState<SignalPage>(
    'hyphy.signal-pages.v1',
    signalPageSchema,
    newSignalPage(),
  );
  const update = (patch: Partial<SignalPage>) => setPage((current) => ({ ...current, ...patch }));
  const links = publishedLinks(page);
  const unusable = page.links.filter((link) => link.url.trim() && !safeHref(link.url));
  const ready = page.name.trim() && links.length > 0;

  const moveLink = (index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= page.links.length) return;
    const next = [...page.links];
    [next[index], next[target]] = [next[target], next[index]];
    update({ links: next });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] lg:gap-x-6">
      {/* The page, live, on a phone: after the editing on phones (so typing comes first), a
          sticky column beside it on desktops. */}
      <div className="order-last grid content-start gap-3 lg:sticky lg:top-24 lg:order-none lg:col-start-1 lg:row-span-6 lg:row-start-1 lg:self-start">
        <div className="mx-auto w-full max-w-[300px] rounded-[46px] bg-[#0c0c0b] p-2.5 shadow-pop ring-1 ring-white/10 lg:max-w-[340px]">
          <div className="relative h-[540px] overflow-hidden rounded-[38px] lg:h-[620px]">
            <span
              aria-hidden="true"
              className="absolute top-3 left-1/2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-[#0c0c0b]"
            />
            <div className="scrollbar-none h-full overflow-y-auto">
              <SignalPageView
                page={page}
                compact
                footer={<p className="mt-8 text-[10.5px] opacity-45">Made with Hyphy Signal</p>}
              />
            </div>
          </div>
        </div>
        <p className="text-center text-[12.5px] text-muted">Preview</p>
      </div>

      <Surface className="grid gap-4 lg:col-start-2">
        <Label>You</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={page.name}
              maxLength={60}
              autoComplete="name"
              enterKeyHint="next"
              placeholder="Rosa Delgado"
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field label="Handle" htmlFor={`${id}-handle`} optional>
            <Input
              id={`${id}-handle`}
              value={page.handle}
              maxLength={30}
              autoCapitalize="off"
              spellCheck={false}
              placeholder="@rosa.eats"
              onChange={(event) => update({ handle: event.target.value.replace(/\s/g, '') })}
            />
          </Field>
        </div>
        <Field
          label={
            <span className="flex w-full justify-between">
              A line about you{' '}
              <span className="mono-num text-[11px] font-normal text-muted">
                {page.bio.length}/160
              </span>
            </span>
          }
          htmlFor={`${id}-bio`}
        >
          <Textarea
            id={`${id}-bio`}
            rows={2}
            maxLength={160}
            value={page.bio}
            placeholder="Chef and owner of a small supper club. Reservations below."
            onChange={(event) => update({ bio: event.target.value })}
          />
        </Field>
      </Surface>

      <Surface className="grid gap-3 lg:col-start-2">
        <div className="flex items-center justify-between">
          <Label>Links · {page.links.length}/12</Label>
          {page.links.length < 12 && (
            <button
              type="button"
              onClick={() =>
                update({ links: [...page.links, { id: newId(6), label: '', url: '' }] })
              }
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink lg:h-9 lg:px-3 lg:text-[13px]"
            >
              <Icon name="plus" size={14} /> Add a link
            </button>
          )}
        </div>
        <ol className="grid gap-2">
          {page.links.map((link, index) => {
            const broken = link.url.trim() !== '' && !safeHref(link.url);
            return (
              <li
                key={link.id}
                className="grid gap-2 rounded-[16px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center"
              >
                <Input
                  aria-label={`Link ${index + 1} name`}
                  value={link.label}
                  maxLength={60}
                  placeholder={index === 0 ? 'Book a table' : 'Name this link'}
                  onChange={(event) =>
                    update({
                      links: page.links.map((item) =>
                        item.id === link.id ? { ...item, label: event.target.value } : item,
                      ),
                    })
                  }
                />
                <Input
                  aria-label={`Link ${index + 1} address`}
                  aria-invalid={broken}
                  value={link.url}
                  maxLength={800}
                  inputMode="url"
                  enterKeyHint="done"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="yourshop.example/book"
                  className={cn(broken && '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]')}
                  onChange={(event) =>
                    update({
                      links: page.links.map((item) =>
                        item.id === link.id ? { ...item, url: event.target.value } : item,
                      ),
                    })
                  }
                />
                <div className="flex justify-end gap-0.5">
                  <IconButton
                    icon="arrow-up"
                    label={`Move link ${index + 1} up`}
                    size="sm"
                    className="!size-11 lg:!size-8"
                    disabled={index === 0}
                    onClick={() => moveLink(index, -1)}
                  />
                  <IconButton
                    icon="arrow-down"
                    label={`Move link ${index + 1} down`}
                    size="sm"
                    className="!size-11 lg:!size-8"
                    disabled={index === page.links.length - 1}
                    onClick={() => moveLink(index, 1)}
                  />
                  <IconButton
                    icon="trash"
                    tone="danger"
                    size="sm"
                    className="!size-11 lg:!size-8"
                    label={`Remove link ${index + 1}`}
                    onClick={() =>
                      update({ links: page.links.filter((item) => item.id !== link.id) })
                    }
                  />
                </div>
              </li>
            );
          })}
        </ol>
        {unusable.length > 0 && (
          <Note icon="alert" tone="caution">
            {unusable.length === 1 ? 'One address' : `${unusable.length} addresses`} won’t open —
            use a web address (yourshop.example), an email or a phone link.
          </Note>
        )}
      </Surface>

      <Surface className="grid gap-3 lg:col-start-2">
        <div className="flex items-center justify-between">
          <Label>Socials · {page.socials.length}/8</Label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {NETWORK_IDS.filter(
            (network) => !page.socials.some((social) => social.network === network),
          ).map((network) => (
            <button
              key={network}
              type="button"
              disabled={page.socials.length >= 8}
              onClick={() => update({ socials: [...page.socials, { network, value: '' }] })}
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-well px-3 text-[13px] text-ink-2 hover:bg-ink/10 hover:text-ink disabled:opacity-40 lg:h-10"
            >
              <Icon name={NETWORKS[network].icon as IconName} size={15} /> {NETWORKS[network].name}
            </button>
          ))}
        </div>
        {page.socials.length > 0 && (
          <ul className="grid gap-2">
            {page.socials.map((social) => {
              const info = NETWORKS[social.network];
              const broken =
                social.value.trim() !== '' && !socialHref(social.network, social.value);
              return (
                <li key={social.network} className="flex items-center gap-2">
                  <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-well text-ink-2 lg:size-10">
                    <Icon name={info.icon as IconName} size={17} />
                  </span>
                  <Input
                    aria-label={`${info.name}${social.network === 'email' ? ' address' : ' handle or link'}`}
                    aria-invalid={broken}
                    value={social.value}
                    maxLength={200}
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={placeholderFor(social.network)}
                    className={cn(broken && '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]')}
                    onChange={(event) =>
                      update({
                        socials: page.socials.map((item) =>
                          item.network === social.network
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <IconButton
                    icon="x"
                    size="sm"
                    className="!size-11 lg:!size-8"
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
      </Surface>

      <Surface className="grid gap-3 lg:col-start-2">
        <Label>Design</Label>
        <div role="radiogroup" aria-label="Design" className="grid grid-cols-4 gap-2.5">
          {DESIGN_IDS.map((key) => {
            const design = DESIGNS[key];
            const on = page.design === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => update({ design: key })}
                className="group grid justify-items-center gap-1.5 text-[12px]"
              >
                <span
                  className={cn(
                    'flex h-[84px] w-full flex-col items-center gap-1.5 px-2 pt-3 transition-all',
                    on
                      ? 'ring-2 ring-signal ring-offset-2 ring-offset-[var(--color-surface)]'
                      : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/.1)] group-hover:-translate-y-0.5',
                  )}
                  style={{ background: design.background, borderRadius: 14 }}
                >
                  <span
                    className="size-3.5 rounded-full"
                    style={{ background: design.avatar.bg }}
                  />
                  {[0, 1, 2].map((bar) => (
                    <span
                      key={bar}
                      className="h-2.5 w-full"
                      style={{
                        background: design.button.bg,
                        borderRadius: Math.min(design.button.radius, 6),
                        boxShadow: `inset 0 0 0 1px ${design.button.border}`,
                      }}
                    />
                  ))}
                </span>
                <span className={on ? 'font-medium text-ink' : 'text-muted'}>{design.name}</span>
              </button>
            );
          })}
        </div>
      </Surface>

      <Surface className="order-last grid gap-4 lg:order-none lg:col-start-2">
        <Label>Share your page</Label>
        {ready ? (
          <ShareLinkCard
            title={page.name || 'My links'}
            cta="Get your page’s link"
            build={() => pageLink(page)}
          >
            <p className="text-[13.5px] leading-relaxed text-muted">
              Change something later? Get the link again and share the new one.
            </p>
          </ShareLinkCard>
        ) : (
          <p className="text-[13.5px] text-muted">
            Add your name and at least one link to get your page’s link.
          </p>
        )}
        {ready && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => window.open(await pageLink(page), '_blank', 'noopener')}
              className="inline-flex h-11 items-center gap-1.5 rounded-[11px] bg-well px-3.5 text-[13.5px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink lg:h-10"
            >
              <Icon name="external" size={15} /> Open your page
            </button>
            <QrLink page={page} />
          </div>
        )}
        {loaded && (
          <button
            type="button"
            onClick={() =>
              window.confirm('Start over? Everything on this page will be cleared.') &&
              reset(newSignalPage())
            }
            className="min-h-11 justify-self-start text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline lg:min-h-0"
          >
            Start over
          </button>
        )}
      </Surface>
    </div>
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

/** A QR code for the page, designed in QR Studio. */
function QrLink({ page }: { page: SignalPage }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () =>
        router.push(`/tools/qr#link=${encodeURIComponent(await pageLink(page))}`)
      }
      className="inline-flex h-11 items-center gap-1.5 rounded-[11px] bg-well px-3.5 text-[13.5px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink lg:h-10"
    >
      <Icon name="qr" size={15} /> Make its QR code
    </button>
  );
}
