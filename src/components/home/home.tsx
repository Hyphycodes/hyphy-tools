'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { worldCard, PosterCard, TileCard, WashCard } from '@/components/marketplace/cards';
import { HeroSearch } from '@/components/marketplace/hero-search';
import { IntentLink } from '@/components/marketplace/intent-link';
import { ToolMini } from '@/components/marketplace/minis';
import { Hero } from '@/components/marketplace/sections';
import { ToolMark } from '@/components/marketplace/tool-mark';
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
import {
  getMode,
  lineIn,
  situationsFor,
  starterTools,
  toolsForMode,
  type Lens,
  type ModeId,
} from '@/lib/catalog/modes';
import type { ActiveItem } from '@/lib/home/active';
import {
  clearHistory,
  greeting,
  isPersonal,
  localDay,
  shelf,
  whenLabel,
  type HomePrefs,
  type ShelfItem,
} from '@/lib/home/prefs';
import { ModePicker } from './mode-picker';
import { ModeSwitch } from './mode-switch';
import { Pinnable } from './pin';
import { QuickButton } from './quick';
import { SituationCard } from './situation-card';
import { updateHome, useHome } from './use-home';

/*
 * The home: a personal toolbox first, the full catalog second.
 *
 *   first visit    What are you here for? (one tap), then the classic marketplace below it
 *   a mode         the mode's hero, your tools, what you left open, what's going on (situations),
 *                  the mode's shelf, then every category one tap away
 *   everything     the classic marketplace, with your tools and open work on top
 *
 * The server sends the first-visit version (it can't know the browser's preferences); someone
 * with a mode already chosen gets it hidden for the moment until theirs renders (HOME_BOOT), so
 * nobody sees one home flash into another.
 */

const wrap = 'mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8';
const listedIds = new Set<ToolId>(listedTools.filter(isReady).map((tool) => tool.id));

const THEME: Record<Lens, string> = {
  everyday: '#f6efe3',
  create: '#0d0a14',
  work: '#0b0d10',
  all: '#0b0b0a',
};

export function Home({ classic, browse }: { classic: ReactNode; browse: ReactNode }) {
  const home = useHome();
  const router = useRouter();
  const lens = home?.lens ?? null;

  // This page is the home: the mode's colors apply (html[data-home]); the phone's browser bar
  // takes the mode's room.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.home = '';
    return () => {
      delete root.dataset.home;
    };
  }, []);
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const before = meta.content;
    meta.content = THEME[lens ?? 'all'];
    return () => {
      meta.content = before;
    };
  }, [lens]);

  // Older links filtered the marketplace (`/tools?c=money`): the filters live on All tools now.
  useEffect(() => {
    const category = new URLSearchParams(window.location.search).get('c');
    if (category) router.replace(`/tools/all?c=${encodeURIComponent(category)}`);
  }, [router]);

  if (!home)
    return (
      <div data-home-ssr="">
        <FirstVisit classic={classic} browse={browse} />
      </div>
    );
  if (!lens) return <FirstVisit classic={classic} browse={browse} />;
  return (
    <div key={lens} className="home-swap">
      {lens === 'all' ? (
        <Everything home={home} classic={classic} browse={browse} />
      ) : (
        <ModeHome mode={lens} home={home} />
      )}
    </div>
  );
}

/* ---------------- first visit ---------------- */

function FirstVisit({ classic, browse }: { classic: ReactNode; browse: ReactNode }) {
  return (
    <>
      <section
        aria-labelledby="home-title"
        className="relative isolate overflow-hidden pt-[84px] pb-4 sm:pt-32 sm:pb-8"
      >
        <Ambient lens="all" />
        <div className={wrap}>
          <p className="label animate-rise">Welcome to Hyphy Tools</p>
          <h1
            id="home-title"
            className="mt-3 animate-rise font-display text-[42px] leading-[0.95] font-extrabold tracking-[-0.045em] text-balance text-ink sm:text-[76px] lg:text-[92px]"
            style={{ fontVariationSettings: "'wdth' 114" }}
          >
            What are you here for?
          </h1>
          <p className="mt-3 max-w-[52ch] animate-rise text-[15.5px] leading-relaxed text-ink-2 sm:mt-4 sm:text-[17px]">
            Pick one and Hyphy puts the useful tools first. Switch any time; every tool stays one
            search away.
          </p>
          <div className="mt-6 sm:mt-10">
            <ModePicker />
          </div>
          <div className="mt-8 sm:mt-12">
            <HeroSearch />
          </div>
        </div>
      </section>
      <Hero level={2} title="Or jump straight in" search={false} />
      {classic}
      {browse}
    </>
  );
}

/* ---------------- everything ---------------- */

function Everything({
  home,
  classic,
  browse,
}: {
  home: HomePrefs;
  classic: ReactNode;
  browse: ReactNode;
}) {
  const now = useNow();
  const personal = isPersonal(home);
  return (
    <>
      <Hero>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 sm:mb-10">
          <ModeSwitch lens="all" />
          <QuickButton className="max-md:hidden" />
        </div>
      </Hero>
      {personal && <YourTools lens="all" home={home} now={now} />}
      <Continue lens="all" home={home} now={now} />
      <Situations lens="all" now={now} />
      {classic}
      {browse}
    </>
  );
}

/* ---------------- a mode ---------------- */

function ModeHome({ mode, home }: { mode: ModeId; home: HomePrefs }) {
  const now = useNow();
  const info = getMode(mode);
  const items = useShelf(mode, home, now);
  return (
    <>
      <section
        aria-labelledby="home-title"
        className="relative isolate overflow-hidden pt-[80px] pb-2 sm:pt-28 sm:pb-6"
      >
        <Ambient lens={mode} />
        <div className={wrap}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ModeSwitch lens={mode} />
            <QuickButton className="max-md:hidden" />
          </div>
          <p className="label mt-8 animate-rise sm:mt-12">
            {greeting(now)} · {info.line}
          </p>
          <h1
            id="home-title"
            className="mode-title mt-2 animate-rise font-display text-[44px] leading-[0.95] font-extrabold tracking-[-0.045em] text-balance text-ink sm:text-[76px] lg:text-[88px]"
          >
            {info.headline}
          </h1>
          <div className="mt-6 sm:mt-9">
            <HeroSearch compact mode={mode} examples={info.examples} label={`Search every tool`} />
          </div>
        </div>
      </section>
      <YourTools lens={mode} home={home} now={now} items={items} />
      <Continue lens={mode} home={home} now={now} />
      <Situations lens={mode} now={now} />
      <ModeShelf mode={mode} exclude={items.map((item) => item.id)} />
      <Browse />
    </>
  );
}

/* ---------------- parts ---------------- */

/** The time, once, on the client (the home only renders personal parts there). */
function useNow() {
  const [now] = useState(() => Date.now());
  return now;
}

function useShelf(lens: Lens, home: HomePrefs, now: number) {
  return useMemo(
    () =>
      shelf(home, {
        now,
        starters: starterTools(lens).map((tool) => tool.id),
        listed: listedIds,
      }),
    [home, lens, now],
  );
}

/** The mode's light behind the hero. */
function Ambient({ lens }: { lens: Lens }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div
        className="mode-ambient drift absolute -inset-x-[20%] -top-[30%] h-[130%]"
        data-lens={lens}
      />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-canvas" />
    </div>
  );
}

function SectionHead({
  id,
  title,
  lead,
  action,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="t-h3 !text-[24px] sm:!text-[30px]">
          {title}
        </h2>
        {lead && <p className="mt-1 text-[14px] text-muted">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- your tools ---------------- */

function YourTools({
  lens,
  home,
  now,
  items: given,
}: {
  lens: Lens;
  home: HomePrefs;
  now: number;
  items?: ShelfItem[];
}) {
  const computed = useShelf(lens, home, now);
  const items = given ?? computed;
  const personal = items.some((item) => item.reason !== 'starter');
  const history = Object.keys(home.uses).length > 0;
  if (!items.length) return null;
  return (
    <section aria-labelledby="your-tools" className="pt-8 sm:pt-12">
      <div className={wrap}>
        <SectionHead
          id="your-tools"
          title={personal ? 'Your tools' : 'Start with these'}
          lead={
            personal
              ? 'Kept handy and opened lately, on this device only.'
              : 'Pin any tool to keep it here.'
          }
          action={
            history ? (
              <button
                type="button"
                onClick={() => updateHome(clearHistory)}
                className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Forget recent
              </button>
            ) : null
          }
        />
      </div>
      <ul
        aria-labelledby="your-tools"
        className={cn(
          wrap,
          'scroller mt-4 flex scroll-px-4 gap-3 overflow-x-auto pb-2 sm:mt-6 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible',
          // Up to six sit in one row like a launcher; more make two even rows.
          items.length <= 6 ? 'lg:grid-cols-6' : 'lg:grid-cols-4',
        )}
      >
        {items.map((item, index) => (
          <li
            key={item.id}
            className="w-[44%] shrink-0 animate-rise sm:w-auto"
            style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
          >
            <ShelfCard tool={getTool(item.id)} item={item} lens={lens} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShelfCard({
  tool,
  item,
  lens,
  now,
}: {
  tool: Tool;
  item: ShelfItem;
  lens: Lens;
  now: number;
}) {
  const sub =
    item.reason === 'starter' || item.last === null
      ? lineIn(tool, lens)
      : whenLabel(item.last, now);
  return (
    <Pinnable tool={tool}>
      <IntentLink
        href={toolHref(tool)}
        data-tool={tool.id}
        className="shelf-card group flex min-w-0 flex-col overflow-hidden outline-offset-4 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1 active:scale-[.98]"
        style={worldCard(tool)}
      >
        <ToolMini tool={tool} className="aspect-[16/10] w-full" />
        <span className="block px-3.5 pt-1 pb-3 sm:px-4 sm:pb-3.5">
          <span className="block truncate text-[15.5px] font-semibold tracking-[-0.01em] sm:text-[16.5px]">
            {tool.name}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[12.5px] opacity-65 sm:text-[13px]">
            {item.reason === 'pinned' && <Icon name="pin" size={12} className="shrink-0" />}
            <span className="truncate">{sub}</span>
          </span>
        </span>
      </IntentLink>
    </Pinnable>
  );
}

/* ---------------- pick up where you left off ---------------- */

function useActive(home: HomePrefs, now: number) {
  const [items, setItems] = useState<ActiveItem[]>([]);
  const uses = home.uses;
  useEffect(() => {
    let alive = true;
    const read = () =>
      import('@/lib/home/active').then(({ readActive }) => {
        if (!alive) return;
        const at = Date.now();
        setItems(
          readActive({
            now: at,
            today: localDay(at),
            lastOpened: (id) => uses[id]?.last ?? 0,
          }),
        );
      });
    void read();
    // Coming back to the tab (after a drive, say) reads again.
    const onVisible = () => document.visibilityState === 'visible' && void read();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [uses, now]);
  return items;
}

function Continue({ lens, home, now }: { lens: Lens; home: HomePrefs; now: number }) {
  const all = useActive(home, now);
  // The mode's own things first; nothing someone started is ever hidden.
  const items = useMemo(() => {
    if (lens === 'all') return all;
    const inMode = (item: ActiveItem) => Boolean(getTool(item.tool).modes[lens]);
    return [...all.filter(inMode), ...all.filter((item) => !inMode(item))];
  }, [all, lens]);
  if (!items.length) return null;
  return (
    <section aria-labelledby="continue" className="pt-10 sm:pt-14">
      <div className={wrap}>
        <SectionHead id="continue" title="Pick up where you left off" />
      </div>
      <ul
        className={cn(
          wrap,
          'scroller mt-4 flex scroll-px-4 gap-3 overflow-x-auto pb-2 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible lg:grid-cols-4',
        )}
      >
        {items.map((item, index) => (
          <li
            key={item.tool}
            className="w-[76%] shrink-0 animate-rise sm:w-auto"
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <ContinueCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContinueCard({ item }: { item: ActiveItem }) {
  const tool = getTool(item.tool);
  return (
    <IntentLink
      href={toolHref(tool)}
      aria-label={`${item.title}: ${item.stat}${item.detail ? `, ${item.detail}` : ''} — open ${tool.name}`}
      className="continue-card group relative flex h-full min-h-[168px] min-w-0 flex-col justify-between gap-5 overflow-hidden p-4 outline-offset-4 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1 sm:p-5"
      style={{ '--tool': tool.accent } as React.CSSProperties}
    >
      <span className="flex items-center gap-2.5 text-[13px] font-semibold text-muted">
        <ToolMark tool={tool} size="sm" />
        <span className="truncate">{tool.name}</span>
        {item.live && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-critical-soft px-2 py-0.5 text-[11px] font-bold tracking-wide text-critical uppercase">
            <span className="size-1.5 rounded-full bg-critical" /> Live
          </span>
        )}
      </span>
      <span className="block min-w-0">
        <span className="block truncate text-[15px] font-semibold text-ink-2">{item.title}</span>
        <span
          className="mt-1 block truncate font-display text-[30px] leading-none font-bold tracking-[-0.03em] text-ink sm:text-[34px]"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          {item.stat}
        </span>
        {item.detail && (
          <span className="mt-2 block truncate text-[13px] text-muted">{item.detail}</span>
        )}
      </span>
    </IntentLink>
  );
}

/* ---------------- what's going on ---------------- */

function Situations({ lens, now }: { lens: Lens; now: number }) {
  const list = situationsFor(lens, new Date(now).getMonth() + 1);
  if (!list.length) return null;
  return (
    <section aria-labelledby="situations" className="pt-10 sm:pt-16">
      <div className={wrap}>
        <SectionHead id="situations" title="What’s going on?" />
      </div>
      {/* Phones: swipe between them, the next one peeking in. */}
      <div
        className={cn(
          wrap,
          'scroller mt-4 flex scroll-px-4 gap-3 overflow-x-auto pb-2 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible',
          list.length >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3',
        )}
      >
        {list.map((situation, index) => (
          <SituationCard
            key={situation.id}
            situation={situation}
            className="w-[84%] shrink-0 animate-rise sm:w-auto"
            style={{ animationDelay: `${index * 50}ms` }}
          />
        ))}
      </div>
    </section>
  );
}

/* ---------------- the mode's shelf ---------------- */

function ModeShelf({ mode, exclude }: { mode: ModeId; exclude: ToolId[] }) {
  const tools = toolsForMode(mode)
    .filter((tool) => !exclude.includes(tool.id))
    .slice(0, 4);
  if (tools.length < 2) return null;
  const info = getMode(mode);
  return (
    <section aria-labelledby="mode-shelf" className="pt-12 sm:pt-16">
      <div className={wrap}>
        <SectionHead id="mode-shelf" title={info.shelf} />
      </div>
      {mode === 'create' ? (
        <div
          className={cn(
            wrap,
            'scroller mt-4 flex scroll-px-4 gap-3 overflow-x-auto pb-2 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible lg:grid-cols-4',
          )}
        >
          {tools.map((tool) => (
            <Pinnable key={tool.id} tool={tool} className="w-[62%] shrink-0 sm:w-auto">
              <PosterCard tool={tool} line={lineIn(tool, mode)} className="h-full" />
            </Pinnable>
          ))}
        </div>
      ) : mode === 'everyday' ? (
        <div className={cn(wrap, 'mt-4 grid gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-5')}>
          {tools.map((tool) => (
            <Pinnable key={tool.id} tool={tool}>
              <WashCard tool={tool} line={lineIn(tool, mode)} />
            </Pinnable>
          ))}
        </div>
      ) : (
        <div className={cn(wrap, 'mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-4')}>
          {tools.map((tool) => (
            <Pinnable key={tool.id} tool={tool}>
              <TileCard tool={tool} line={lineIn(tool, mode)} className="h-full" />
            </Pinnable>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- everything else ---------------- */

/** Every category, one tap away: the whole catalog without putting it on the home. */
function Browse() {
  const open = listedTools.filter(isReady);
  const shelves = categories
    .map((category) => ({
      category,
      count: open.filter((tool) => tool.category === category.id).length,
    }))
    .filter((shelf) => shelf.count > 0);
  return (
    <section aria-labelledby="browse-all" className="pt-12 pb-4 sm:pt-16">
      <div className={wrap}>
        <SectionHead
          id="browse-all"
          title="Browse all tools"
          lead="Everything Hyphy makes, by what it helps with."
        />
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:mt-6 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {shelves.map(({ category, count }) => (
            <IntentLink
              key={category.id}
              href={`/tools/all?c=${category.id}`}
              className="browse-tile group flex min-h-[76px] items-center gap-3 p-3 transition-colors sm:p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink/[.07] text-ink-2">
                <Icon name={category.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-ink">
                  {category.name}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {count} {count === 1 ? 'tool' : 'tools'}
                </span>
              </span>
            </IntentLink>
          ))}
          <IntentLink
            href="/tools/all"
            className="browse-tile browse-all group flex min-h-[76px] items-center justify-between gap-3 p-3 sm:p-4"
          >
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">All tools</span>
              <span className="block text-[12.5px] opacity-70">{open.length} and counting</span>
            </span>
            <Icon
              name="arrow-right"
              size={18}
              className="shrink-0 transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </IntentLink>
        </div>
      </div>
    </section>
  );
}
