import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import {
  catalogFacts,
  categories,
  drops,
  getFamily,
  getTool,
  inCategory,
  inFamily,
  isReady,
  listedTools,
  toolHref,
  type FamilyId,
  type Tool,
} from '@/lib/catalog';
import { ToolArt } from './art';
import { StatusPill } from './badges';
import { FeatureCard, ToolRow, ToolTile } from './cards';
import { HeroSearch } from './hero-search';

/*
 * The marketplace, section by section. Each one has its own composition — a hero, a gallery, a
 * family stage, a ticket for drops — and every tool in them comes from the registry.
 */

const wrap = 'mx-auto w-full max-w-[1320px]';

function SectionHead({
  id,
  eyebrow,
  title,
  lead,
  action,
  className,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-10 gap-y-5', className)}>
      <div className="max-w-2xl" data-reveal>
        <p className="label mb-4">{eyebrow}</p>
        <h2 id={id} className="t-h2">
          {title}
        </h2>
        {lead && <p className="t-lead mt-4 max-w-xl">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- hero ---------------- */

export function Hero() {
  const facts = catalogFacts();
  const peek = [getTool('qr'), getTool('when'), getTool('palette')];
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden px-4 pt-28 pb-16 sm:px-6 sm:pt-36 lg:px-8 lg:pb-24"
    >
      {/* Ambient light: three tool colors, drifting slowly. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="drift absolute -top-40 left-[8%] size-[560px] rounded-full bg-[#6a74ff] opacity-[.16] blur-[120px]" />
        <div className="drift-slow absolute top-[18%] right-[-6%] size-[520px] rounded-full bg-[#ffb35c] opacity-[.12] blur-[130px]" />
        <div className="drift absolute bottom-[-30%] left-[38%] size-[480px] rounded-full bg-[#20d392] opacity-[.08] blur-[120px]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#0b0b0a]" />
      </div>

      <div
        className={cn(
          wrap,
          'grid items-center gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]',
        )}
      >
        <div className="min-w-0">
          <p className="label flex flex-wrap items-center gap-x-3 gap-y-1" data-reveal>
            <span className="text-ink-2">Hyphy Tools</span>
            <span aria-hidden="true" className="text-faint">
              /
            </span>
            <span>{facts.open} tools</span>
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
            <span>{facts.local} run on your device</span>
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
            <span>No sign-up</span>
          </p>
          <h1
            id="hero-title"
            className="t-mega mt-6 bg-gradient-to-b from-[#f4f1ea] via-[#e6e1d6] to-[#8f8a80] bg-clip-text text-transparent"
            data-reveal
            style={{ '--reveal-order': 1 } as CSSProperties}
          >
            Tools
          </h1>
          <p
            className="mt-6 max-w-[30ch] text-[21px] leading-[1.35] text-ink-2 sm:text-[26px]"
            data-reveal
            style={{ '--reveal-order': 2 } as CSSProperties}
          >
            Useful little things. Serious systems.{' '}
            <span className="text-muted">Things you didn’t know you needed.</span>
          </p>
          <div className="mt-10" data-reveal style={{ '--reveal-order': 3 } as CSSProperties}>
            <HeroSearch />
          </div>
        </div>

        {/* A peek at the gallery: real tools, tilted like prints on a table. */}
        <div aria-hidden="true" className="relative hidden h-[520px] lg:block">
          {peek.map((tool, index) => (
            <Link
              key={tool.id}
              href={toolHref(tool)}
              tabIndex={-1}
              data-reveal
              style={
                {
                  '--reveal-order': 3 + index,
                  top: ['4%', '30%', '58%'][index],
                  left: ['14%', '-2%', '26%'][index],
                  rotate: ['6deg', '-5deg', '3deg'][index],
                  zIndex: [1, 2, 3][index],
                } as CSSProperties
              }
              className="group absolute w-[64%] overflow-hidden rounded-[22px] shadow-[0_0_0_1px_rgb(255_255_255/.09),0_40px_80px_-30px_rgb(0_0_0/.9)] transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] hover:!rotate-0 hover:scale-[1.03]"
            >
              <ToolArt tool={tool} className="aspect-[4/3] w-full" />
              <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[12.5px] font-semibold text-ink backdrop-blur">
                {tool.name}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- featured ---------------- */

export function Featured() {
  const [lead, ...rest] = listedTools.filter((tool) => tool.featured && isReady(tool));
  const second = rest.slice(0, 2);
  return (
    <section aria-labelledby="featured" className="px-4 pt-20 sm:px-6 lg:px-8 lg:pt-28">
      <div className={wrap}>
        <SectionHead
          id="featured"
          eyebrow="Start here"
          title="The ones we’d open first."
          lead="Hand-picked by the people who build them, not ranked by clicks."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {lead && (
            <FeatureCard
              tool={lead}
              kicker="Staff pick"
              className="min-h-[540px] sm:min-h-[560px]"
            />
          )}
          <div className="grid gap-5">
            {second.map((tool, index) => (
              <FeatureCard
                key={tool.id}
                tool={tool}
                size="md"
                kicker={tool.drop ? `Drop · ${tool.drop.season}` : 'Staff pick'}
                order={index + 1}
                className="min-h-[420px] sm:min-h-[270px]"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- families ---------------- */

const familyLayouts: Record<FamilyId, 'grid' | 'row' | 'mirror' | 'lab'> = {
  gather: 'grid',
  signal: 'row',
  'image-lab': 'mirror',
  'file-lab': 'lab',
};

export function FamilyStage({ id }: { id: FamilyId }) {
  const family = getFamily(id);
  const members = inFamily(id);
  const layout = familyLayouts[id];
  const style = { '--family': family.accent } as CSSProperties;

  const head = (
    <div className="min-w-0" data-reveal>
      <p className="label mb-4 flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: family.accent }} />A Hyphy family
      </p>
      <h2 id={`family-${id}`} className="t-display" style={{ color: family.accent }}>
        {family.name}
      </h2>
      <p className="mt-4 text-[20px] leading-snug font-medium text-ink sm:text-[23px]">
        {family.line}
      </p>
    </div>
  );
  const body = (
    <div className="min-w-0" data-reveal style={{ '--reveal-order': 1 } as CSSProperties}>
      <p className="t-lead max-w-md">{family.story}</p>
      <p className="mt-6 text-[13px] text-muted">
        {members.filter(isReady).length} open now
        {members.some((tool) => !isReady(tool)) &&
          ` · ${members.filter((tool) => !isReady(tool)).length} coming`}
      </p>
    </div>
  );
  const intro = (
    <div className="grid gap-4">
      {head}
      {body}
    </div>
  );

  return (
    <section
      id={id}
      aria-labelledby={`family-${id}`}
      className="relative scroll-mt-24 overflow-hidden px-4 pt-28 sm:px-6 lg:px-8 lg:pt-36"
      style={style}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-24 left-1/2 -z-10 h-[420px] w-[80%] -translate-x-1/2 rounded-full opacity-[.09] blur-[120px]"
        style={{ background: family.accent }}
      />
      <div className={wrap}>
        {layout === 'grid' && (
          <div className="grid gap-12 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <div className="lg:sticky lg:top-32 lg:self-start">{intro}</div>
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2">
              {members.map((tool, index) => (
                <ToolTile key={tool.id} tool={tool} order={index} />
              ))}
            </div>
          </div>
        )}
        {layout === 'row' && (
          <>
            <div className="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
              {head}
              {body}
            </div>
            <div className="scroller -mx-4 mt-12 flex gap-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
              {members.map((tool, index) => (
                <ToolTile
                  key={tool.id}
                  tool={tool}
                  order={index}
                  className="w-[78vw] shrink-0 sm:w-auto"
                />
              ))}
            </div>
          </>
        )}
        {layout === 'mirror' && (
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.75fr)] lg:gap-16">
            <div className="order-2 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:order-1">
              {members.map((tool, index) => (
                <ToolTile
                  key={tool.id}
                  tool={tool}
                  order={index}
                  wide={index === 0}
                  className={index === 0 ? 'sm:col-span-2' : undefined}
                />
              ))}
            </div>
            <div className="order-1 lg:order-2 lg:sticky lg:top-32 lg:self-start">{intro}</div>
          </div>
        )}
        {layout === 'lab' && (
          <div className="grid gap-12 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] lg:gap-16">
            {intro}
            <div className="grid gap-5">
              {members[0] && (
                <FeatureCard
                  tool={members[0]}
                  size="md"
                  kicker="File Lab"
                  className="min-h-[430px] sm:min-h-[320px]"
                />
              )}
              <div className="panel grid gap-0.5 p-2" data-reveal>
                {members.slice(1).map((tool) => (
                  <ToolRow key={tool.id} tool={tool} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- money ---------------- */

export function Money() {
  const money = inCategory('money');
  const [lead, ...others] = [
    getTool('subscriptions'),
    ...money.filter((tool) => tool.id !== 'subscriptions'),
  ];
  const business = inCategory('business');
  return (
    <section aria-labelledby="money" className="px-4 pt-28 sm:px-6 lg:px-8 lg:pt-36">
      <div className={wrap}>
        <SectionHead
          id="money"
          eyebrow="Money"
          title={
            <>
              Know what it costs.
              <br className="hidden sm:block" />{' '}
              <span className="text-muted">Down to the cent.</span>
            </>
          }
          lead="Checks, subscriptions and the money that leaks out every month, made plain."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {[lead, ...others].map((tool, index) => (
            <FeatureCard
              key={tool.id}
              tool={tool}
              size="md"
              kicker="Money"
              order={index}
              className="min-h-[430px] sm:min-h-[320px]"
            />
          ))}
        </div>
        {business.length > 0 && (
          <div
            className="panel mt-8 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6"
            data-reveal
          >
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">
                For teams, arriving with accounts
              </p>
              <p className="mt-1 text-[14px] text-muted">
                {business.map((tool) => tool.name).join(' and ')} keep records for a whole crew,
                with approvals. They’re working in the Hyphy Spaces preview and open to everyone
                once accounts do.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {business.map((tool) => (
                <Link
                  key={tool.id}
                  href={toolHref(tool)}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-white/[.06] px-4 text-[14px] text-ink-2 hover:bg-white/10 hover:text-ink"
                >
                  {tool.name}{' '}
                  <StatusPill tool={tool} className="!h-5 !bg-transparent !px-0 !shadow-none" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- drops ---------------- */

export function Drops() {
  if (!drops.length) return null;
  const [lead, ...rest] = [...drops].sort((a, b) => Number(isReady(b)) - Number(isReady(a)));
  return (
    <section
      id="drops"
      aria-labelledby="drops-title"
      className="scroll-mt-24 px-4 pt-28 sm:px-6 lg:px-8 lg:pt-36"
    >
      <div className={wrap}>
        <SectionHead
          id="drops-title"
          eyebrow="Drops"
          title="Small releases, right on time."
          lead="Seasonal, specific and a little bit fun. Some stay, some come back next year."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Link
            href={toolHref(lead)}
            data-reveal
            className="group relative isolate grid overflow-hidden rounded-[30px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] sm:grid-cols-[1fr_1fr]"
            style={{
              background: `radial-gradient(120% 120% at 0% 0%, color-mix(in oklab, ${lead.accent} 28%, #151513), #121211 60%)`,
            }}
          >
            <div className="relative flex flex-col justify-between gap-10 p-7 sm:p-9">
              <div>
                <p className="label !text-ink-2">Drop · {lead.drop?.season}</p>
                <h3
                  className="mt-3 font-display text-[40px] leading-[0.95] font-extrabold tracking-[-0.04em] text-ink sm:text-[52px]"
                  style={{ fontVariationSettings: "'wdth' 112" }}
                >
                  {lead.name}
                </h3>
                <p className="mt-3 max-w-[30ch] text-[16px] text-ink-2">{lead.tagline}</p>
              </div>
              <div>
                <p className="max-w-[32ch] text-[14px] text-muted italic">“{lead.drop?.line}”</p>
                <span
                  className="mt-5 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14.5px] font-semibold text-[#12110d]"
                  style={{ background: lead.accent }}
                >
                  Start a list <Icon name="arrow-right" size={16} />
                </span>
              </div>
            </div>
            <ToolArt tool={lead} className="min-h-[280px] !bg-transparent" />
            {/* The ticket's perforation. */}
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-1/2 hidden h-[80%] -translate-y-1/2 border-l-2 border-dashed border-white/10 sm:block"
            />
          </Link>
          <div className="grid content-start gap-5">
            {rest.map((tool, index) => (
              <ToolTile key={tool.id} tool={tool} order={index + 1} />
            ))}
            <p className="px-1 text-[13.5px] leading-relaxed text-muted" data-reveal>
              Drops arrive when they’re useful: before the holidays, before the big game, before the
              trip. Each one is free and works without an account.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- privacy ---------------- */

export function PrivateByDesign() {
  const facts = catalogFacts();
  const byLink = listedTools.filter(
    (tool) => isReady(tool) && tool.privacy.storage.includes('link'),
  );
  return (
    <section
      id="private"
      aria-labelledby="private-title"
      className="scroll-mt-24 px-4 pt-28 sm:px-6 lg:px-8 lg:pt-36"
    >
      <div className={cn(wrap, 'panel relative overflow-hidden p-7 sm:p-12 lg:p-16')}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -right-32 size-[460px] rounded-full bg-[#5fd394] opacity-[.08] blur-[110px]"
        />
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div data-reveal>
            <p className="label mb-4 flex items-center gap-2">
              <Icon name="lock" size={13} /> Private by design
            </p>
            <h2 id="private-title" className="t-h2">
              Your files stay yours.{' '}
              <span className="text-muted">Not a slogan: a build choice.</span>
            </h2>
            <p className="t-lead mt-5 max-w-lg">
              Most Hyphy tools do their work inside your browser, on your phone or computer. Your
              photos, PDFs and lists are never uploaded to Hyphy, because they don’t need to be.
              Every tool says exactly where your data goes, on its own page.
            </p>
          </div>
          <dl className="grid content-start gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              {
                value: facts.local,
                label: 'tools run entirely on your device',
                detail: 'Files and details are processed in your browser and never uploaded.',
              },
              {
                value: byLink.length,
                label: 'share through the link itself',
                detail:
                  'Plans and lists ride inside the link, after the #, which browsers never send to a server.',
              },
              {
                value: facts.open - facts.noAccount,
                label: 'need an account',
                detail: 'Tools that will keep data with an account say so, and say what they keep.',
              },
            ].map((fact, index) => (
              <div
                key={fact.label}
                data-reveal
                style={{ '--reveal-order': index } as CSSProperties}
                className="rounded-[18px] bg-white/[.035] p-5 shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)]"
              >
                <dt className="flex items-baseline gap-3">
                  <span className="font-display text-[44px] leading-none font-extrabold tracking-[-0.04em] text-ink">
                    {fact.value}
                  </span>
                  <span className="text-[15px] font-medium text-ink-2">{fact.label}</span>
                </dt>
                <dd className="mt-2 text-[13.5px] leading-relaxed text-muted">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/* ---------------- index ---------------- */

export function AllTools() {
  return (
    <section
      id="all"
      aria-labelledby="all-title"
      className="scroll-mt-24 px-4 pt-28 sm:px-6 lg:px-8 lg:pt-36"
    >
      <div className={wrap}>
        <SectionHead
          id="all-title"
          eyebrow="Everything"
          title="Every tool, by what it helps with."
          action={
            <p className="text-[14px] text-muted" data-reveal>
              {listedTools.length} tools · new ones arrive here first
            </p>
          }
        />
        <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category, index) => {
            const members = inCategory(category.id);
            if (!members.length) return null;
            return (
              <div
                key={category.id}
                data-reveal
                style={{ '--reveal-order': index % 3 } as CSSProperties}
              >
                <h3 className="flex items-center gap-2 border-b border-line pb-3 text-[15px] font-semibold text-ink">
                  <Icon name={category.icon} size={16} className="text-muted" />
                  {category.name}
                  <span className="mono-num ml-auto text-[11px] font-normal text-faint">
                    {members.length}
                  </span>
                </h3>
                <div className="-mx-3 mt-2 grid">
                  {members.map((tool: Tool) => (
                    <ToolRow key={tool.id} tool={tool} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
