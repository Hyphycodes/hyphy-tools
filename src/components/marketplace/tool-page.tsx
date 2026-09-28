import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { isReady, privacyFacts, relatedTo, type Tool } from '@/lib/catalog';
import { ToolArt } from './art';
import { ToolRow } from './cards';
import { IntentLink } from './intent-link';
import { ShareButton } from './share-button';
import { ToolMark } from './tool-mark';

/*
 * Every tool page has the same bones: a slim header (what it is, one quiet line about privacy),
 * the tool itself straight away, then how it works, where data goes and what to open next. The
 * tool is never buried under facts: on a phone it starts within the first screen.
 */

const wrap = 'mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8';

/**
 * The quiet privacy line under a tool's name. Tapping it opens the details (a native popover: no
 * script, works before the page is interactive).
 */
function PrivacyNote({ tool }: { tool: Tool }) {
  const privacy = privacyFacts(tool);
  return (
    <>
      <button
        type="button"
        popoverTarget="privacy-details"
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-muted transition-colors hover:bg-white/[.06] hover:text-ink-2"
      >
        <Icon name={privacy.local ? 'lock' : 'shield'} size={13} strokeWidth={2} />
        {privacy.short}
      </button>
      <div
        id="privacy-details"
        popover="auto"
        className="m-auto w-[min(92vw,420px)] rounded-[22px] bg-surface p-6 text-ink shadow-pop backdrop:bg-black/60"
      >
        <p className="flex items-center gap-2 text-[16px] font-semibold">
          <Icon name={privacy.local ? 'lock' : 'shield'} size={17} className="text-positive" />
          {privacy.short}
        </p>
        <ul className="mt-4 grid gap-2.5 text-[14.5px] leading-relaxed text-ink-2">
          {privacy.lines.map((line) => (
            <li key={line} className="flex gap-2.5">
              <Icon name="check" size={15} className="mt-[4px] shrink-0 text-positive" />
              {line}
            </li>
          ))}
        </ul>
        <button
          type="button"
          popoverTarget="privacy-details"
          popoverTargetAction="hide"
          className="mt-5 h-11 w-full rounded-full bg-white/[.08] text-[14.5px] font-semibold text-ink hover:bg-white/[.12]"
        >
          Got it
        </button>
      </div>
    </>
  );
}

export function ToolHeader({ tool }: { tool: Tool }) {
  const ready = isReady(tool);
  return (
    <section
      aria-labelledby="tool-title"
      className="relative isolate pt-[76px] pb-4 sm:pt-24 sm:pb-6 lg:pb-8"
      style={{ '--accent': tool.accent } as CSSProperties}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[340px]"
        style={{
          background: `radial-gradient(60% 100% at 85% 0%, color-mix(in oklab, ${tool.accent} 16%, transparent), transparent 70%)`,
        }}
      />
      <div className={cn(wrap, 'grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_320px]')}>
        <div className="min-w-0 animate-rise">
          <nav aria-label="Breadcrumb" className="mb-3 sm:mb-5">
            <IntentLink
              href="/tools"
              className="-ml-2 inline-flex h-9 items-center gap-1 rounded-full px-2 text-[14px] text-muted transition-colors hover:text-ink"
            >
              <Icon name="chevron-left" size={16} /> All tools
            </IntentLink>
          </nav>
          <div className="flex items-center gap-3.5 sm:gap-5">
            <ToolMark tool={tool} size="xl" className="max-sm:!size-12 max-sm:!rounded-[14px]" />
            <div className="min-w-0">
              <h1
                id="tool-title"
                className="font-display text-[34px] leading-[0.95] font-extrabold tracking-[-0.04em] text-ink sm:text-[54px]"
                style={{ fontVariationSettings: "'wdth' 112" }}
              >
                {tool.name}
              </h1>
              <p className="mt-1.5 text-[15px] leading-snug text-ink-2 sm:mt-2 sm:text-[19px]">
                {tool.tagline}
              </p>
            </div>
          </div>
          {ready && (
            <div className="mt-3 -ml-2.5 flex flex-wrap items-center gap-1 sm:mt-4">
              <PrivacyNote tool={tool} />
              {tool.status === 'beta' && (
                <span className="inline-flex h-6 items-center rounded-full bg-signal-soft px-2.5 text-[11.5px] font-semibold text-signal-ink">
                  Beta
                </span>
              )}
              <ShareButton
                title={`${tool.name} · Hyphy Tools`}
                text={tool.tagline}
                label="Share"
                className="!h-8 !bg-transparent !px-2.5 !text-[13px] !font-normal !text-muted !shadow-none hover:!bg-white/[.06] hover:!text-ink-2"
              />
            </div>
          )}
        </div>
        {/* Desktop only: the tool's picture beside its name. */}
        {ready && (
          <div className="hidden animate-rise overflow-hidden rounded-[22px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] [animation-delay:80ms] lg:block">
            <ToolArt tool={tool} className="aspect-[16/10] w-full" />
          </div>
        )}
      </div>
    </section>
  );
}

function InfoBlock({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: Parameters<typeof Icon>[0]['name'];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('panel p-5 sm:p-7', className)}>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Icon name={icon} size={17} className="text-muted" />
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** How it works, where your data goes, honest limits. Below the tool, for whoever wants it. */
export function ToolDetails({ tool }: { tool: Tool }) {
  const privacy = privacyFacts(tool);
  return (
    <section aria-label={`About ${tool.name}`} className={cn(wrap, 'mt-14 sm:mt-20')}>
      <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
        {tool.steps.length > 0 && (
          <InfoBlock title="How it works" icon="list-ordered">
            <ol className="grid gap-3.5">
              {tool.steps.map((step, index) => (
                <li key={step} className="flex gap-3.5 text-[14.5px] leading-snug text-ink-2">
                  <span
                    className="mono-num grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-[#12110d]"
                    style={{ background: tool.accent }}
                  >
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </InfoBlock>
        )}
        <InfoBlock title="Where your data goes" icon={privacy.local ? 'lock' : 'shield'}>
          <ul className="grid gap-2.5 text-[14px] leading-relaxed text-ink-2">
            {privacy.lines.map((line) => (
              <li key={line} className="flex gap-2.5">
                <Icon name="check" size={15} className="mt-[3px] shrink-0 text-positive" />
                {line}
              </li>
            ))}
          </ul>
        </InfoBlock>
        {(tool.limits.length > 0 || tool.later.length > 0) && (
          <InfoBlock title="Good to know" icon="alert">
            {tool.limits.length > 0 && (
              <ul className="grid gap-2.5 text-[14px] leading-relaxed text-ink-2">
                {tool.limits.map((limit) => (
                  <li key={limit} className="flex gap-2.5">
                    <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-muted" />
                    {limit}
                  </li>
                ))}
              </ul>
            )}
            {tool.later.length > 0 && (
              <div className={cn(tool.limits.length > 0 && 'mt-5 border-t border-line pt-4')}>
                <p className="label mb-2.5">Coming later</p>
                <ul className="grid gap-2 text-[14px] text-ink-2">
                  {tool.later.map((item) => (
                    <li key={item.label} className="flex items-start gap-2.5">
                      <Icon name="sparkles" size={15} className="mt-0.5 shrink-0 text-muted" />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </InfoBlock>
        )}
      </div>
    </section>
  );
}

export function Related({ tool }: { tool: Tool }) {
  const related = relatedTo(tool, 3);
  if (!related.length) return null;
  return (
    <section aria-labelledby="related" className={cn(wrap, 'mt-12 sm:mt-16')}>
      <h2 id="related" className="t-h3">
        Open next
      </h2>
      <div className="-mx-1 mt-4 grid sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-3">
        {related.map((item) => (
          <ToolRow key={item.id} tool={item} />
        ))}
      </div>
    </section>
  );
}

/** A tool that isn't open yet: what it will do, honestly, and what works today instead. */
export function ComingSoon({ tool }: { tool: Tool }) {
  const alternatives = relatedTo(tool, 3).filter(isReady);
  return (
    <div className="panel relative overflow-hidden p-5 sm:p-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <span className="inline-flex h-6 items-center rounded-full bg-white/[.07] px-2.5 text-[11.5px] font-medium text-muted">
            Coming soon
          </span>
          <h2 className="t-h3 mt-4">{tool.name} isn’t open yet.</h2>
          <p className="mt-3 max-w-prose text-[15.5px] leading-relaxed text-ink-2">
            {tool.description}
          </p>
          {alternatives.length > 0 && (
            <div className="mt-6">
              <p className="label mb-2">Works today</p>
              <div className="-mx-1 grid">
                {alternatives.map((item) => (
                  <ToolRow key={item.id} tool={item} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="overflow-hidden rounded-[22px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]">
          <ToolArt tool={tool} className="aspect-[4/3] w-full" />
        </div>
      </div>
    </div>
  );
}
