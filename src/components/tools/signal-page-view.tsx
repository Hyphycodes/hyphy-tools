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

/**
 * A Signal Page as visitors see it. Every link opens in a new tab, tells the browser not to pass
 * this page along, and shows where it really goes in small print.
 */
export function SignalPageView({
  page,
  className,
  compact = false,
  fill = false,
  footer,
}: {
  page: SignalPage;
  className?: string;
  /** Inside the editor's phone: slightly smaller type. */
  compact?: boolean;
  /** The whole screen, with the design behind everything (the published page). */
  fill?: boolean;
  footer?: React.ReactNode;
}) {
  const design = DESIGNS[page.design];
  const Heading = compact ? 'p' : 'h1';
  const links = publishedLinks(page);
  const socials = page.socials
    .map((social) => ({ ...social, href: socialHref(social.network, social.value) }))
    .filter((social): social is typeof social & { href: string } => Boolean(social.href));
  const heading: CSSProperties = {
    fontFamily: fonts[design.font],
    fontVariationSettings: design.font === 'display' ? "'wdth' 112" : undefined,
    letterSpacing:
      design.font === 'mono' ? '-0.02em' : design.font === 'display' ? '-0.03em' : '-0.01em',
    textTransform: design.font === 'mono' ? 'uppercase' : undefined,
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center px-5 text-center',
        fill ? 'min-h-dvh' : 'min-h-full',
        compact ? 'pt-12 pb-6' : 'pt-16 pb-10',
        className,
      )}
      style={{ background: design.background, color: design.fg }}
    >
      <div className="flex w-full max-w-[440px] flex-1 flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            'grid shrink-0 place-items-center font-bold',
            compact ? 'size-16 text-[24px]' : 'size-20 text-[30px]',
            design.button.radius === 0 ? 'rounded-none' : 'rounded-full',
          )}
          style={{ background: design.avatar.bg, color: design.avatar.fg, ...heading }}
        >
          {monogram(page)}
        </span>
        {/* The published page's title; inside the editor's preview it's not the page's heading. */}
        <Heading
          className={cn(
            'mt-4 max-w-full font-bold break-words',
            compact ? 'text-[19px]' : 'text-[24px]',
          )}
          style={heading}
        >
          {page.name.trim() || 'Your name'}
        </Heading>
        {page.handle.trim() && (
          <p
            className={cn('mt-0.5', compact ? 'text-[12px]' : 'text-[14px]')}
            style={{ color: design.muted }}
          >
            @{page.handle.trim().replace(/^@/, '')}
          </p>
        )}
        {page.bio.trim() && (
          <p
            className={cn(
              'mt-3 max-w-[34ch] leading-snug whitespace-pre-line',
              compact ? 'text-[13px]' : 'text-[15px]',
            )}
            style={{ color: design.muted }}
          >
            {page.bio.trim()}
          </p>
        )}
        {socials.length > 0 && (
          <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Social profiles">
            {socials.map((social) => (
              <li key={`${social.network}-${social.value}`}>
                <a
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  aria-label={NETWORKS[social.network].name}
                  className={cn(
                    'grid place-items-center transition-transform hover:-translate-y-0.5',
                    compact ? 'size-9' : 'size-11',
                    design.button.radius === 0 ? 'rounded-none' : 'rounded-full',
                  )}
                  style={{
                    background: design.button.bg,
                    color: design.button.fg,
                    boxShadow: `inset 0 0 0 1px ${design.button.border}`,
                  }}
                >
                  <Icon name={NETWORKS[social.network].icon as IconName} size={compact ? 15 : 18} />
                </a>
              </li>
            ))}
          </ul>
        )}
        <ul className={cn('flex w-full flex-col', compact ? 'mt-5 gap-2' : 'mt-7 gap-3')}>
          {links.map((link) => (
            <li key={link.id}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className={cn(
                  'flex w-full flex-col items-center justify-center px-5 transition-transform hover:-translate-y-0.5',
                  compact ? 'min-h-11 py-2' : 'min-h-14 py-3',
                )}
                style={{
                  background: design.button.bg,
                  color: design.button.fg,
                  borderRadius: design.button.radius,
                  boxShadow: `inset 0 0 0 ${design.button.radius === 0 ? 2 : 1}px ${design.button.border}`,
                }}
              >
                <span
                  className={cn('font-semibold', compact ? 'text-[13.5px]' : 'text-[15.5px]')}
                  style={design.font === 'mono' ? heading : undefined}
                >
                  {link.label.trim()}
                </span>
                <span className={cn('opacity-60', compact ? 'text-[10.5px]' : 'text-[11.5px]')}>
                  {hostOf(link.href)}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {links.length === 0 && (
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
