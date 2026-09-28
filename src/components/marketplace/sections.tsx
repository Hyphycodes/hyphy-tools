import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { categories, getTool, isReady, listedTools, type Tool, type ToolId } from '@/lib/catalog';
import { FeatureCard, PosterCard, QuickAction, TileCard, ToolRow, WashCard } from './cards';
import { HeroSearch } from './hero-search';

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

/** Three shelves with three moods: made to look good, made for people, made to get it done. */
const CREATIVE: ToolId[] = ['social-crop', 'palette', 'qr', 'signal-pages', 'resize'];
const PEOPLE: { id: ToolId; action: string }[] = [
  { id: 'bring', action: 'Start a list' },
  { id: 'wishlist', action: 'Make a wish list' },
];
const EVERYDAY: ToolId[] = [
  'subscriptions',
  'pdf',
  'signal-links',
  'convert',
  'clean',
  'duplicates',
];

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

/** The first thing on the page: the jobs people come for, each a tiny version of its tool. */
const QUICK: { id: ToolId; label: string }[] = [
  { id: 'split', label: 'Split dinner' },
  { id: 'when', label: 'Find a time' },
  { id: 'qr', label: 'Make a QR code' },
  { id: 'resize', label: 'Shrink a photo' },
  { id: 'pdf', label: 'Merge PDFs' },
  { id: 'social-crop', label: 'Crop for Instagram' },
  { id: 'bring', label: 'Plan a potluck' },
  { id: 'clean', label: 'Tidy file names' },
];

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden px-4 pt-[84px] pb-8 sm:px-6 sm:pt-32 sm:pb-12 lg:px-8"
    >
      {/* Ambient light: a few tool colors, as gradients (no blur filters to repaint). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="drift absolute -inset-x-[20%] -top-[30%] h-[130%]"
          style={{
            background:
              'radial-gradient(34% 30% at 18% 22%, rgb(184 243 90 / .12), transparent 70%), radial-gradient(34% 30% at 84% 30%, rgb(255 179 92 / .14), transparent 70%), radial-gradient(30% 26% at 52% 90%, rgb(62 224 208 / .09), transparent 70%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[#0b0b0a]" />
      </div>

      <div className={wrap}>
        <h1
          id="hero-title"
          className="animate-rise font-display text-[40px] leading-[0.95] font-extrabold tracking-[-0.045em] text-balance text-ink sm:text-[72px] lg:text-[88px]"
          style={{ fontVariationSettings: "'wdth' 114" }}
        >
          What do you want to do?
        </h1>
        <nav
          aria-label="Quick actions"
          className="mt-5 grid grid-cols-2 gap-2.5 sm:mt-10 sm:grid-cols-4 sm:gap-4"
        >
          {QUICK.map(({ id, label }, index) => (
            <QuickAction
              key={id}
              tool={getTool(id)}
              label={label}
              className={cn('animate-rise', index >= 6 && 'max-sm:hidden')}
              style={{ animationDelay: `${60 + index * 35}ms` }}
            />
          ))}
        </nav>
        <div className="mt-5 sm:mt-10">
          <HeroSearch />
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

/* ---------------- make it look good ---------------- */

export function Creative() {
  const tools = CREATIVE.map(getTool).filter(isReady);
  return (
    <section aria-labelledby="creative" className="pt-12 sm:pt-16">
      <div className={cn(wrap, 'px-4 sm:px-6 lg:px-8')}>
        <SectionHead
          id="creative"
          title="Make it look good"
          lead="Photos, colors, codes and pages that look like you."
        />
      </div>
      {/* Phones: a row of prints to swipe through. */}
      <div
        className={cn(
          wrap,
          'scroller mt-5 flex scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mt-7 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-6 lg:grid-cols-5 lg:px-8',
        )}
      >
        {tools.map((tool) => (
          <PosterCard key={tool.id} tool={tool} className="w-[58%] shrink-0 sm:w-auto" />
        ))}
      </div>
    </section>
  );
}

/* ---------------- plans with people ---------------- */

export function People() {
  return (
    <section aria-labelledby="people" className="px-4 pt-12 sm:px-6 sm:pt-16 lg:px-8">
      <div className={wrap}>
        <SectionHead
          id="people"
          title="Plans with people"
          lead="One link for the group chat. Nobody needs an account."
        />
        <div className="mt-5 grid gap-3 sm:mt-7 sm:grid-cols-2 sm:gap-5">
          {PEOPLE.map(({ id, action }) => (
            <WashCard key={id} tool={getTool(id)} action={action} />
          ))}
        </div>
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
        <SectionHead
          id="everyday"
          title="Everyday helpers"
          lead="The small chores, done in a minute."
        />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-7 sm:grid-cols-3 sm:gap-5 xl:grid-cols-6">
          {tools.map((tool) => (
            <TileCard key={tool.id} tool={tool} />
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
