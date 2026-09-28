import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import {
  accountLabel,
  getCategory,
  getFamily,
  inFamily,
  isReady,
  privacyFacts,
  relatedTo,
  type Tool,
} from '@/lib/catalog';
import { ToolArt } from './art';
import { AccessPill, PrivacyPill, StatusPill } from './badges';
import { ToolRow, ToolTile } from './cards';
import { ShareButton } from './share-button';
import { ToolMark } from './tool-mark';

/*
 * Every tool page has the same bones: who it is and the facts that matter (status, cost, account,
 * where data goes), then the tool itself, straight away, then how it works, its honest limits,
 * its family and what to open next. The tool is never buried under marketing.
 */

const wrap = 'mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8';

export function ToolHeader({ tool }: { tool: Tool }) {
  const family = tool.family ? getFamily(tool.family) : null;
  const category = getCategory(tool.category);
  return (
    <section
      aria-labelledby="tool-title"
      className="relative isolate overflow-hidden pt-24 pb-8 sm:pt-28 lg:pb-10"
      style={{ '--accent': tool.accent } as CSSProperties}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-[-10%] -z-10 size-[620px] rounded-full opacity-[.13] blur-[130px]"
        style={{ background: tool.accent }}
      />
      <div className={cn(wrap, 'grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_380px]')}>
        <div className="min-w-0 animate-rise">
          <nav
            aria-label="Breadcrumb"
            className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-muted"
          >
            <Link href="/tools" className="hover:text-ink">
              Tools
            </Link>
            <Icon name="chevron-right" size={13} className="text-faint" />
            {family ? (
              <Link href={`/tools#${family.id}`} className="hover:text-ink">
                {family.name}
              </Link>
            ) : tool.drop ? (
              <Link href="/tools#drops" className="hover:text-ink">
                Drops
              </Link>
            ) : (
              <Link href={`/tools?c=${category.id}`} className="hover:text-ink">
                {category.name}
              </Link>
            )}
          </nav>
          <div className="flex items-start gap-4 sm:items-center sm:gap-5">
            <ToolMark tool={tool} size="xl" className="max-sm:!size-14 max-sm:!rounded-[15px]" />
            <div className="min-w-0">
              <p className="label mb-1.5">{tool.kind}</p>
              <h1
                id="tool-title"
                className="font-display text-[38px] leading-[0.95] font-extrabold tracking-[-0.04em] text-ink sm:text-[56px]"
                style={{ fontVariationSettings: "'wdth' 112" }}
              >
                {tool.name}
              </h1>
            </div>
          </div>
          <p className="mt-5 max-w-[42ch] text-[18px] leading-snug text-ink-2 sm:text-[21px]">
            {tool.tagline}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <StatusPill tool={tool} />
            <AccessPill tool={tool} />
            <span className="inline-flex h-6 items-center rounded-full bg-white/[.07] px-2.5 text-[11.5px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]">
              {accountLabel(tool)}
            </span>
            <PrivacyPill tool={tool} />
            <ShareButton
              title={`${tool.name} · Hyphy Tools`}
              text={tool.tagline}
              className="max-sm:!h-8 max-sm:!px-3 max-sm:!text-[12.5px]"
            />
          </div>
        </div>
        {/* A tool that isn't open yet shows its art large, below. */}
        {isReady(tool) && (
          <div className="hidden animate-rise overflow-hidden rounded-[24px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] [animation-delay:80ms] lg:block">
            <ToolArt tool={tool} className="aspect-[16/11] w-full" />
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
    <div className={cn('panel p-6 sm:p-7', className)} data-reveal>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Icon name={icon} size={17} className="text-muted" />
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** How it works, honest limits, where your data goes, what's planned. */
export function ToolDetails({ tool }: { tool: Tool }) {
  const privacy = privacyFacts(tool);
  return (
    <section aria-label={`About ${tool.name}`} className={cn(wrap, 'mt-16 sm:mt-20')}>
      <div className="grid gap-5 lg:grid-cols-3">
        {tool.steps.length > 0 && (
          <InfoBlock title="How it works" icon="list-ordered">
            <ol className="grid gap-4">
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
          <p className="mb-3">
            <PrivacyPill tool={tool} />
          </p>
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
                      <span>
                        {item.label}
                        {item.pro && (
                          <span className="ml-2 rounded-full bg-[#f5c451]/15 px-2 py-0.5 text-[11px] font-semibold text-[#f5c451]">
                            Pro
                          </span>
                        )}
                      </span>
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

/** "Part of Gather": the family, contextual, with its other members one tap away. */
export function FamilyContext({ tool }: { tool: Tool }) {
  if (!tool.family) return null;
  const family = getFamily(tool.family);
  const others = inFamily(tool.family).filter((item) => item.id !== tool.id);
  if (!others.length) return null;
  return (
    <section aria-labelledby="family-context" className={cn(wrap, 'mt-5')}>
      <div
        className="panel relative grid gap-6 overflow-hidden p-6 sm:p-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]"
        data-reveal
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-24 size-[420px] rounded-full opacity-[.1] blur-[100px]"
          style={{ background: family.accent }}
        />
        <div>
          <p className="label mb-3">Part of a family</p>
          <h2 id="family-context" className="t-h3" style={{ color: family.accent }}>
            {family.name}
          </h2>
          <p className="mt-2 text-[15px] text-ink-2">{family.line}</p>
          <Link
            href={`/tools#${family.id}`}
            className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-ink hover:underline"
          >
            See all of {family.name} <Icon name="arrow-right" size={15} />
          </Link>
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          {others.map((item) => (
            <ToolRow key={item.id} tool={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function Related({ tool }: { tool: Tool }) {
  const related = relatedTo(tool, 3);
  if (!related.length) return null;
  return (
    <section aria-labelledby="related" className={cn(wrap, 'mt-20')}>
      <h2 id="related" className="t-h3" data-reveal>
        Open next
      </h2>
      <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((item, index) => (
          <ToolTile key={item.id} tool={item} order={index} context="category" />
        ))}
      </div>
    </section>
  );
}

/** A tool that isn't open yet: what it will do, honestly, and what works today instead. */
export function ComingSoon({ tool }: { tool: Tool }) {
  const alternatives = relatedTo(tool, 3).filter(isReady);
  return (
    <div className="panel relative overflow-hidden p-6 sm:p-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <StatusPill tool={tool} />
          <h2 className="t-h3 mt-4">{tool.name} isn’t open yet.</h2>
          <p className="mt-3 max-w-prose text-[15.5px] leading-relaxed text-ink-2">
            {tool.description}
          </p>
          {tool.spaces && (
            <p className="mt-3 max-w-prose text-[14px] leading-relaxed text-muted">
              It’s built and working inside Hyphy Spaces, the signed-in side of Hyphy, which opens
              to everyone with accounts.
            </p>
          )}
          {alternatives.length > 0 && (
            <div className="mt-6">
              <p className="label mb-2">Works today</p>
              <div className="-mx-3 grid">
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
