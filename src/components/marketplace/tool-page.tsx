import type { ReactNode } from 'react';
import { KeepHandy } from '@/components/home/pin';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { isReady, privacyFacts, relatedTo, type Tool } from '@/lib/catalog';
import { ToolArt } from './art';
import { ToolRow } from './cards';
import { IntentLink } from './intent-link';
import { ShareButton } from './share-button';
import { ToolMark } from './tool-mark';

/*
 * A tool page is the tool. One slim line on top (back, the tool's name, "Stays on your device ⓘ",
 * Share), then the tool straight away. How it works, where data goes and the honest limits live
 * in the info drawer (a native popover: no script, works before the page is interactive) and a
 * quiet line below the workspace; they never stand between a person and the tool.
 */

const wrap = 'mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8';
const INFO = 'tool-info';

/** The one line about privacy, and the door to everything else. */
function PrivacyChip({ tool }: { tool: Tool }) {
  const privacy = privacyFacts(tool);
  return (
    <button
      type="button"
      popoverTarget={INFO}
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink/[.05] pr-2 pl-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-ink/[.09] hover:text-ink"
    >
      <Icon name={privacy.local ? 'lock' : 'shield'} size={13} strokeWidth={2.2} />
      <span className="max-[420px]:sr-only">{privacy.short}</span>
      <span className="grid size-5 place-items-center rounded-full bg-ink/[.07] text-muted">
        <Icon name="info" size={12} strokeWidth={2.4} />
      </span>
    </button>
  );
}

export function ToolHeader({ tool }: { tool: Tool }) {
  const ready = isReady(tool);
  return (
    <section aria-labelledby="tool-title" className="relative pt-[72px] pb-3 sm:pt-[84px] sm:pb-5">
      <div className={cn(wrap, 'flex min-w-0 items-center gap-2.5 sm:gap-3.5')}>
        <nav aria-label="Breadcrumb" className="-ml-1.5 shrink-0">
          <IntentLink
            href="/tools"
            aria-label="Home"
            className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[.06] hover:text-ink"
          >
            <Icon name="chevron-left" size={20} />
          </IntentLink>
        </nav>
        <ToolMark tool={tool} size="md" className="max-sm:!size-9 max-sm:!rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1
              id="tool-title"
              className="truncate font-display text-[22px] leading-none font-bold tracking-[-0.03em] text-ink sm:text-[28px]"
              style={{ fontVariationSettings: "'wdth' 110" }}
            >
              {tool.name}
            </h1>
            {tool.status === 'beta' && (
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-ink/[.07] px-2 text-[11px] font-semibold text-ink-2">
                Beta
              </span>
            )}
          </div>
          <p className="mt-1 hidden truncate text-[14px] text-muted md:block">{tool.tagline}</p>
        </div>
        {ready && (
          <div className="-mr-1 flex shrink-0 items-center gap-1">
            <KeepHandy tool={{ id: tool.id, name: tool.name }} />
            <PrivacyChip tool={tool} />
            <ShareButton
              title={`${tool.name} · Hyphy Tools`}
              text={tool.tagline}
              compact
              className="!h-9 !bg-transparent !px-2.5 !text-[13px] !text-muted !shadow-none hover:!bg-ink/[.06] hover:!text-ink"
            />
          </div>
        )}
      </div>
      <ToolInfo tool={tool} />
    </section>
  );
}

function InfoSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: Parameters<typeof Icon>[0]['name'];
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Icon name={icon} size={16} className="text-muted" />
        {title}
      </h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/** Everything about a tool that isn't the tool: one drawer, a tap away. */
function ToolInfo({ tool }: { tool: Tool }) {
  const privacy = privacyFacts(tool);
  return (
    <div
      id={INFO}
      popover="auto"
      aria-label={`About ${tool.name}`}
      className="info-drawer bg-surface p-0 text-ink shadow-pop"
    >
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-surface px-5 pt-4 pb-3 sm:px-6 sm:pt-6">
        <ToolMark tool={tool} size="sm" />
        <p className="min-w-0 flex-1 truncate text-[16px] font-semibold">{tool.name}</p>
        <button
          type="button"
          popoverTarget={INFO}
          popoverTargetAction="hide"
          aria-label="Close"
          className="grid size-10 place-items-center rounded-full bg-ink/[.06] text-ink-2 hover:bg-ink/10"
        >
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="grid gap-5 px-5 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-6">
        <p className="text-[15px] leading-relaxed text-ink-2">{tool.description}</p>
        <InfoSection title="Where your data goes" icon={privacy.local ? 'lock' : 'shield'}>
          <ul className="grid gap-2.5 text-[14px] leading-relaxed text-ink-2">
            {privacy.lines.map((line) => (
              <li key={line} className="flex gap-2.5">
                <Icon name="check" size={15} className="mt-[3px] shrink-0 text-positive" />
                {line}
              </li>
            ))}
          </ul>
        </InfoSection>
        {tool.steps.length > 0 && (
          <InfoSection title="How it works" icon="list-ordered">
            <ol className="grid gap-3">
              {tool.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-[14px] leading-snug text-ink-2">
                  <span
                    className="mono-num grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
                    style={{ background: tool.accent, color: 'var(--on-accent, #12110d)' }}
                  >
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </InfoSection>
        )}
        {(tool.limits.length > 0 || tool.later.length > 0) && (
          <InfoSection title="Good to know" icon="alert">
            {tool.limits.length > 0 && (
              <ul className="grid gap-2.5 text-[14px] leading-relaxed text-ink-2">
                {tool.limits.map((limit) => (
                  <li key={limit} className="flex gap-2.5">
                    <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-faint" />
                    {limit}
                  </li>
                ))}
              </ul>
            )}
            {tool.later.length > 0 && (
              <div className={cn(tool.limits.length > 0 && 'mt-4')}>
                <p className="label mb-2">Coming later</p>
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
          </InfoSection>
        )}
      </div>
    </div>
  );
}

/**
 * Under the workspace, for whoever wants it: the same facts as the drawer, as one quiet line, and
 * what to open next.
 */
export function ToolFooter({ tool }: { tool: Tool }) {
  const related = relatedTo(tool, 3);
  const privacy = privacyFacts(tool);
  return (
    <section aria-label={`More about ${tool.name}`} className={cn(wrap, 'mt-16 pb-6 sm:mt-24')}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-5 text-[13.5px] text-muted">
        <button
          type="button"
          popoverTarget={INFO}
          className="inline-flex items-center gap-1.5 hover:text-ink"
        >
          <Icon name={privacy.local ? 'lock' : 'shield'} size={14} /> {privacy.label}
        </button>
        <button
          type="button"
          popoverTarget={INFO}
          className="inline-flex items-center gap-1.5 hover:text-ink"
        >
          <Icon name="info" size={14} /> How it works
        </button>
      </div>
      {related.length > 0 && (
        <div className="mt-8">
          <h2 id="related" className="text-[15px] font-semibold text-ink-2">
            Open next
          </h2>
          <div className="-mx-1 mt-2 grid sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-3">
            {related.map((item) => (
              <ToolRow key={item.id} tool={item} />
            ))}
          </div>
        </div>
      )}
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
          <span className="inline-flex h-6 items-center rounded-full bg-ink/[.07] px-2.5 text-[11.5px] font-medium text-muted">
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
