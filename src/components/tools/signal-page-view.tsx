import type { CSSProperties } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import {
  DESIGNS,
  hostOf,
  monogram,
  NETWORKS,
  publishedLinks,
  socialHref,
  type SignalPage,
} from '@/lib/tools/signal-pages';

const fonts = {
  sans: 'var(--font-mona), system-ui, sans-serif',
  display: 'var(--font-hubot), var(--font-mona), system-ui, sans-serif',
  mono: 'var(--font-martian), ui-monospace, monospace',
} as const;

/** The bio reads like a magazine standfirst: a serif italic (plain mono for the Mono design). */
const serif = "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";

type Editable = Pick<SignalPage, 'name' | 'handle' | 'bio'>;

/** Inputs that look exactly like the text they edit: tap the name on the phone and type. */
const inPlace =
  'w-full min-w-0 rounded-[10px] bg-transparent text-center outline-none transition-[background-color,box-shadow] placeholder:text-current placeholder:opacity-40 hover:bg-[color-mix(in_srgb,currentColor_6%,transparent)] focus:bg-[color-mix(in_srgb,currentColor_8%,transparent)] focus:shadow-[0_0_0_1.5px_color-mix(in_srgb,currentColor_35%,transparent)]';

/**
 * A Signal Page as visitors see it. Every link opens in a new tab, tells the browser not to pass
 * this page along, and shows where it really goes in small print. With `edit`, the name, handle
 * and bio become fields in place and the links stop being links (the editor's phone).
 */
export function SignalPageView({
  page,
  className,
  compact = false,
  fill = false,
  footer,
  edit,
}: {
  page: SignalPage;
  className?: string;
  /** Inside the editor's phone: slightly smaller type. */
  compact?: boolean;
  /** The whole screen, with the design behind everything (the published page). */
  fill?: boolean;
  footer?: React.ReactNode;
  /** Edit the words in place. `ids` let the editor focus a field. */
  edit?: {
    onChange: (patch: Partial<Editable>) => void;
    ids?: Partial<Record<keyof Editable, string>>;
  };
}) {
  const design = DESIGNS[page.design];
  const Heading = compact ? 'p' : 'h1';
  const links = publishedLinks(page);
  const socials = page.socials
    .map((social) => ({ ...social, href: socialHref(social.network, social.value) }))
    .filter((social): social is typeof social & { href: string } => Boolean(social.href));
  const mono = design.font === 'mono';
  const heading: CSSProperties = {
    fontFamily: fonts[design.font],
    fontVariationSettings: design.font === 'display' ? "'wdth' 112" : undefined,
    letterSpacing: mono ? '-0.02em' : design.font === 'display' ? '-0.035em' : '-0.02em',
    textTransform: mono ? 'uppercase' : undefined,
  };
  const bioStyle: CSSProperties = mono
    ? { color: design.muted, fontFamily: fonts.mono, letterSpacing: '-0.01em' }
    : { color: design.muted, fontFamily: serif, fontStyle: 'italic' };
  const handle = page.handle.trim().replace(/^@/, '');
  const square = design.button.radius === 0;
  const button: CSSProperties = {
    background: design.button.bg,
    color: design.button.fg,
    borderRadius: design.button.radius,
    boxShadow: `inset 0 0 0 ${square ? 2 : 1}px ${design.button.border}`,
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center px-5 text-center',
        fill ? 'min-h-dvh' : 'min-h-full',
        compact ? 'pt-12 pb-6' : 'pt-16 pb-10 sm:pt-20',
        className,
      )}
      style={{ background: design.background, color: design.fg }}
    >
      <div className="flex w-full max-w-[440px] flex-1 flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            'grid shrink-0 place-items-center font-bold',
            compact ? 'size-[68px] text-[26px]' : 'size-22 text-[34px]',
            square ? 'rounded-none' : 'rounded-full',
          )}
          style={{
            background: design.avatar.bg,
            color: design.avatar.fg,
            boxShadow: `0 0 0 ${compact ? 3 : 4}px ${design.button.border === 'transparent' ? 'rgba(255,255,255,.18)' : design.button.border}`,
            ...heading,
          }}
        >
          {monogram(page)}
        </span>

        {/* A small letter-spaced handle above the name, like a byline. */}
        {edit ? (
          <input
            id={edit.ids?.handle}
            aria-label="Handle"
            value={handle ? `@${handle}` : ''}
            maxLength={31}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder="@yourhandle"
            onChange={(event) =>
              edit.onChange({ handle: event.target.value.replace(/\s/g, '').replace(/^@+/, '') })
            }
            className={cn(inPlace, 'mt-5 h-8 text-[11px] font-semibold tracking-[.16em] uppercase')}
            style={{ color: design.muted }}
          />
        ) : (
          handle && (
            <p
              className={cn(
                'mt-5 max-w-full font-semibold tracking-[.16em] break-words uppercase',
                compact ? 'text-[10.5px]' : 'text-[11.5px]',
              )}
              style={{ color: design.muted }}
            >
              @{handle}
            </p>
          )
        )}

        {/* The published page's title; inside the editor's preview it's not the page's heading. */}
        {edit ? (
          <input
            id={edit.ids?.name}
            aria-label="Name"
            value={page.name}
            maxLength={60}
            autoComplete="name"
            enterKeyHint="next"
            placeholder="Your name"
            onChange={(event) => edit.onChange({ name: event.target.value })}
            className={cn(inPlace, 'mt-1 h-12 font-bold', compact ? 'text-[26px]' : 'text-[32px]')}
            style={heading}
          />
        ) : (
          <Heading
            className={cn(
              'max-w-full leading-[1.02] font-bold text-balance break-words',
              handle ? 'mt-1.5' : 'mt-5',
              compact ? 'text-[26px]' : 'text-[34px] sm:text-[38px]',
            )}
            style={heading}
          >
            {page.name.trim() || 'Your name'}
          </Heading>
        )}

        {(edit || page.bio.trim()) && (
          <span
            aria-hidden="true"
            className="mt-4 block h-px w-8"
            style={{ background: design.muted, opacity: 0.6 }}
          />
        )}
        {edit ? (
          <textarea
            id={edit.ids?.bio}
            aria-label="A line about you"
            rows={2}
            maxLength={160}
            value={page.bio}
            placeholder="A line about you — what you make, where to find you."
            onChange={(event) => edit.onChange({ bio: event.target.value })}
            className={cn(
              inPlace,
              'mt-3 max-w-[32ch] resize-none px-2 py-1 leading-snug [field-sizing:content]',
              compact ? 'text-[15px]' : 'text-[17px]',
            )}
            style={bioStyle}
          />
        ) : (
          page.bio.trim() && (
            <p
              className={cn(
                'mt-3 max-w-[32ch] leading-snug text-pretty whitespace-pre-line',
                compact ? 'text-[15px]' : 'text-[17px] sm:text-[18px]',
              )}
              style={bioStyle}
            >
              {page.bio.trim()}
            </p>
          )
        )}

        {socials.length > 0 && (
          <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Social profiles">
            {socials.map((social) => (
              <li key={`${social.network}-${social.value}`}>
                {edit ? (
                  <span
                    aria-label={NETWORKS[social.network].name}
                    className={cn(
                      'grid size-9 place-items-center',
                      square ? 'rounded-none' : 'rounded-full',
                    )}
                    style={button}
                  >
                    <Icon name={NETWORKS[social.network].icon as IconName} size={15} />
                  </span>
                ) : (
                  <a
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    aria-label={NETWORKS[social.network].name}
                    className={cn(
                      'grid place-items-center transition-transform hover:-translate-y-0.5',
                      compact ? 'size-9' : 'size-11',
                      square ? 'rounded-none' : 'rounded-full',
                    )}
                    style={button}
                  >
                    <Icon
                      name={NETWORKS[social.network].icon as IconName}
                      size={compact ? 15 : 18}
                    />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        <ul className={cn('flex w-full flex-col', compact ? 'mt-6 gap-2.5' : 'mt-8 gap-3')}>
          {links.map((link) => {
            const inner = (
              <>
                <span
                  className={cn('font-semibold', compact ? 'text-[14px]' : 'text-[16px]')}
                  style={mono ? heading : undefined}
                >
                  {link.label.trim()}
                </span>
                <span className={cn('opacity-55', compact ? 'text-[10.5px]' : 'text-[11.5px]')}>
                  {hostOf(link.href)}
                </span>
              </>
            );
            const shape = cn(
              'flex w-full flex-col items-center justify-center px-5',
              compact ? 'min-h-12 py-2' : 'min-h-15 py-3',
            );
            return (
              <li key={link.id}>
                {edit ? (
                  <div className={shape} style={button}>
                    {inner}
                  </div>
                ) : (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    className={cn(shape, 'transition-transform hover:-translate-y-0.5')}
                    style={button}
                  >
                    {inner}
                  </a>
                )}
              </li>
            );
          })}
          {/* The editor's phone shows where links will land, before there are any. */}
          {edit &&
            links.length === 0 &&
            ['Your first link', 'Another link'].map((label) => (
              <li key={label}>
                <div
                  className="flex min-h-12 w-full items-center justify-center px-5 text-[13.5px] font-medium opacity-45"
                  style={{
                    borderRadius: design.button.radius,
                    border: `1.5px dashed ${design.muted}`,
                  }}
                >
                  {label}
                </div>
              </li>
            ))}
        </ul>
        {!edit && links.length === 0 && (
          <p
            className={cn('mt-6', compact ? 'text-[12.5px]' : 'text-[14px]')}
            style={{ color: design.muted }}
          >
            Links you add appear here.
          </p>
        )}
      </div>
      {footer}
    </div>
  );
}
