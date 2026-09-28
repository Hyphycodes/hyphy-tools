import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import {
  categories,
  getTool,
  isReady,
  listedTools,
  toolHref,
  type Tool,
  type ToolId,
} from '@/lib/catalog';
import { ToolArt } from './art';
import { FeatureCard, ToolCard, ToolRow } from './cards';
import { HeroSearch } from './hero-search';
import { IntentLink } from './intent-link';

/*
 * The marketplace, top to bottom: say what you need (search), two featured tools, the everyday
 * ones as cards, then every tool by what it helps with, as rows you can scan in seconds. Every
 * tool comes from the registry; the picks below are editorial, never usage numbers.
 */

const wrap = 'mx-auto w-full max-w-[1320px]';

/** The two editorial moments, with the job each one does. */
const FEATURED: { id: ToolId; action: string; kicker: string }[] = [
  { id: 'split', action: 'Split a check', kicker: 'Snap the receipt' },
  { id: 'when', action: 'Find a time', kicker: 'For the group chat' },
];

/** What people reach for most days. */
const EVERYDAY: ToolId[] = ['qr', 'pdf', 'social-crop', 'resize', 'bring', 'subscriptions'];

function SectionHead({
  id,
  title,
  lead,
  className,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-8 gap-y-2', className)}>
      <h2 id={id} className="t-h3 !text-[24px] sm:!text-[30px]">
        {title}
      </h2>
      {lead && <p className="text-[14px] text-muted">{lead}</p>}
    </div>
  );
}

/* ---------------- hero ---------------- */

export function Hero() {
  const peek = [getTool('qr'), getTool('split'), getTool('palette')];
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden px-4 pt-24 pb-8 sm:px-6 sm:pt-32 sm:pb-14 lg:px-8 lg:pb-20"
    >
      {/* Ambient light: three tool colors, as gradients (no blur filters to repaint). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="drift absolute -inset-x-[20%] -top-[30%] h-[130%]"
          style={{
            background:
              'radial-gradient(38% 34% at 22% 28%, rgb(106 116 255 / .2), transparent 70%), radial-gradient(34% 30% at 86% 42%, rgb(255 179 92 / .13), transparent 70%), radial-gradient(30% 26% at 52% 92%, rgb(32 211 146 / .08), transparent 70%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[#0b0b0a]" />
      </div>

      <div
        className={cn(
          wrap,
          'grid items-center gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]',
        )}
      >
        <div className="min-w-0 animate-rise">
          <h1
            id="hero-title"
            className="t-mega !text-[clamp(64px,17vw,220px)] bg-gradient-to-b from-[#f4f1ea] via-[#e6e1d6] to-[#8f8a80] bg-clip-text text-transparent"
          >
            Tools
          </h1>
          <p className="mt-4 max-w-[30ch] text-[19px] leading-[1.35] text-ink-2 sm:mt-6 sm:text-[24px]">
            Small tools that just work.{' '}
            <span className="text-muted">Open one and get it done.</span>
          </p>
          <div className="mt-6 sm:mt-9">
            <HeroSearch />
          </div>
        </div>

        {/* A peek at the gallery: real tools, tilted like prints on a table. */}
        <div aria-hidden="true" className="relative hidden h-[480px] lg:block">
          {peek.map((tool, index) => (
            <IntentLink
              key={tool.id}
              href={toolHref(tool)}
              tabIndex={-1}
              style={
                {
                  top: ['4%', '30%', '58%'][index],
                  left: ['14%', '-2%', '26%'][index],
                  rotate: ['6deg', '-5deg', '3deg'][index],
                  zIndex: [1, 2, 3][index],
                  animationDelay: `${120 + index * 90}ms`,
                } as CSSProperties
              }
              className="group absolute w-[62%] animate-rise overflow-hidden rounded-[22px] shadow-[0_0_0_1px_rgb(255_255_255/.09),0_40px_80px_-30px_rgb(0_0_0/.9)] transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] hover:!rotate-0 hover:scale-[1.03]"
            >
              <ToolArt tool={tool} className="aspect-[4/3] w-full" />
              <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-[12.5px] font-semibold text-ink">
                {tool.name}
              </span>
            </IntentLink>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- featured ---------------- */

export function Featured() {
  return (
    <section aria-labelledby="featured" className="pt-8 sm:pt-12">
      <h2 id="featured" className="sr-only">
        Featured
      </h2>
      {/* Phones: swipe between them, the next one peeking in. */}
      <div
        className={cn(
          wrap,
          'scroller flex scroll-px-4 gap-3 overflow-x-auto px-4 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-6 lg:px-8',
        )}
      >
        {FEATURED.map(({ id, action, kicker }) => (
          <FeatureCard
            key={id}
            tool={getTool(id)}
            action={action}
            kicker={kicker}
            className="h-[360px] w-[84%] shrink-0 sm:h-[420px] sm:w-auto lg:h-[460px]"
          />
        ))}
      </div>
    </section>
  );
}

/* ---------------- everyday ---------------- */

export function Everyday() {
  const tools = EVERYDAY.map(getTool).filter(isReady);
  return (
    <section aria-labelledby="everyday" className="px-4 pt-12 sm:px-6 sm:pt-16 lg:px-8">
      <div className={wrap}>
        <SectionHead id="everyday" title="Everyday" />
        <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 sm:mt-7 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-9">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- every tool, by what it helps with ---------------- */

export function AllTools() {
  const shelves = categories
    .map((category) => ({
      category,
      tools: listedTools.filter((tool) => tool.category === category.id && isReady(tool)),
    }))
    .filter((shelf) => shelf.tools.length > 0);
  return (
    <section
      id="all"
      aria-labelledby="all-title"
      className="cv-auto scroll-mt-32 px-4 pt-14 sm:px-6 sm:pt-20 lg:px-8"
    >
      <div className={wrap}>
        <SectionHead id="all-title" title="All tools" />
        <div className="mt-4 grid gap-x-8 gap-y-7 sm:mt-7 sm:grid-cols-2 lg:grid-cols-3">
          {shelves.map(({ category, tools }) => (
            <div key={category.id} aria-labelledby={`shelf-${category.id}`} role="group">
              <h3
                id={`shelf-${category.id}`}
                className="flex items-center gap-2 border-b border-line px-1 pb-2.5 text-[14px] font-semibold text-ink-2"
              >
                <Icon name={category.icon} size={15} className="text-muted" />
                {category.name}
              </h3>
              <div className="-mx-1 mt-1.5 grid">
                {tools.map((tool: Tool) => (
                  <ToolRow key={tool.id} tool={tool} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- on the way ---------------- */

export function OnTheWay() {
  const soon = listedTools.filter((tool) => !isReady(tool));
  if (!soon.length) return null;
  return (
    <section aria-labelledby="soon-title" className="px-4 pt-14 sm:px-6 sm:pt-20 lg:px-8">
      <div className={wrap}>
        <SectionHead id="soon-title" title="On the way" />
        <div className="-mx-1 mt-4 grid sm:mt-6 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-3">
          {soon.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- privacy, in one line ---------------- */

export function PrivateByDesign() {
  return (
    <section aria-label="Privacy" className="px-4 pt-14 sm:px-6 sm:pt-20 lg:px-8">
      <div className={cn(wrap, 'panel flex items-start gap-4 p-5 sm:items-center sm:p-7')}>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-positive-soft text-positive">
          <Icon name="lock" size={18} />
        </span>
        <p className="text-[15px] leading-relaxed text-ink-2 sm:text-[16px]">
          <span className="font-semibold text-ink">Your files stay with you.</span> Most tools work
          right on your phone or computer, so your photos, PDFs and lists are never uploaded. Each
          tool says exactly where your data goes.
        </p>
      </div>
    </section>
  );
}
