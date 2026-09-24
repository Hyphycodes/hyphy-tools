import Link from 'next/link';
import { ToolPreview } from '@/components/tools/previews';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import { Page, PageHeader } from '@/components/ui/page';
import { Chips } from '@/components/ui/tabs';
import { openPage } from '@/lib/page';
import {
  availability,
  availabilityNote,
  categories,
  statusLabel,
  toolName,
  tools,
  type ToolDefinition,
} from '@/lib/platform/tools';

export const metadata = { title: 'Tools' };

/**
 * The Tools library: what each tool does, whether it works here, and what you've already made
 * with it. Read straight from the registry, so a new tool appears here the moment it's added.
 */
export default async function ToolsPage({ params, searchParams }: PageProps<'/[space]/tools'>) {
  const { workspace, repo, base, can } = await openPage(params);
  const view = String((await searchParams).view ?? 'all');
  const { space, membership } = workspace;
  const [receipts, mileage, qrCodes, linkPages, files, projects, vehicles, members] =
    await Promise.all([
      repo.receipts(),
      repo.mileage(),
      repo.qrCodes(),
      repo.linkPages(),
      repo.files(),
      repo.projects(),
      repo.vehicles(),
      repo.members(),
    ]);
  const usage: Record<string, string | undefined> = {
    receipts: receipts.length ? `${receipts.length} receipts` : undefined,
    mileage: mileage.length ? `${mileage.length} trips` : undefined,
    qr: qrCodes.length ? `${qrCodes.length} saved codes` : undefined,
    links: linkPages.length
      ? `${linkPages.length} link page${linkPages.length === 1 ? '' : 's'}`
      : undefined,
    pdf: files.filter((file) => file.source === 'pdf').length
      ? `${files.filter((file) => file.source === 'pdf').length} merged PDFs`
      : undefined,
    images: files.filter((file) => file.source === 'images').length
      ? `${files.filter((file) => file.source === 'images').length} resized`
      : undefined,
    projects: projects.length
      ? `${projects.length} ${toolName(
          tools.find((tool) => tool.id === 'projects')!,
          space,
        ).toLowerCase()}`
      : undefined,
    vehicles: vehicles.length ? `${vehicles.length} vehicles` : undefined,
    people: members.length ? `${members.length} people` : undefined,
    files: files.length ? `${files.length} files` : undefined,
  };

  const states = new Map(tools.map((tool) => [tool.id, availability(tool, space, membership)]));
  const ready = (tool: ToolDefinition) => states.get(tool.id)?.state === 'ready';
  const filtered = tools.filter((tool) =>
    view === 'ready'
      ? ready(tool)
      : view === 'soon'
        ? tool.status === 'soon'
        : view === 'teams'
          ? tool.bestFor !== 'personal' && tool.spaceKinds.includes('business')
          : true,
  );
  const featured =
    tools.find(
      (tool) =>
        tool.id ===
          (space.kind === 'personal'
            ? 'pdf'
            : space.modules.includes('vehicles')
              ? 'receipts'
              : 'qr') && ready(tool),
    ) ?? tools.find((tool) => ready(tool) && tool.kind !== 'module');

  return (
    <Page wide>
      <PageHeader
        title="Tools"
        description="Small, sharp tools that each do one job — and remember what you made with them in this Space."
      />

      {featured && view === 'all' && (
        <section
          className="relative mb-8 grid overflow-hidden rounded-[26px] md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]"
          style={{ background: `color-mix(in oklab, ${featured.color} 38%, white)` }}
          aria-label={`Featured: ${featured.name}`}
        >
          <div className="relative z-10 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <ToolGlyph tool={featured} size="lg" />
              <Badge tone={featured.status === 'beta' ? 'signal' : 'positive'} dot>
                {statusLabel[featured.status]}
              </Badge>
            </div>
            <h2 className="display mt-5 text-[34px] sm:text-[44px]">{featured.tagline}</h2>
            <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-ink/70">
              {featured.description}
            </p>
            <ul className="mt-5 grid gap-2 text-[14px] text-ink/80">
              {featured.highlights.map((line) => (
                <li key={line} className="flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-ink text-white">
                    <Icon name="check" size={12} strokeWidth={2.6} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={`${base}${featured.path}`}
                className={buttonClass({ variant: 'primary', size: 'lg' })}
              >
                Open {featured.name} <Icon name="arrow-right" size={17} />
              </Link>
              {featured.privacy && (
                <span className="flex items-center gap-1.5 text-[13px] text-ink/60">
                  <Icon name="lock" size={14} /> {featured.privacy}
                </span>
              )}
            </div>
          </div>
          <div className="relative hidden min-h-[260px] md:block">
            <ToolPreview id={featured.id} />
          </div>
        </section>
      )}

      <div className="mb-6">
        <Chips
          active={view}
          items={[
            { id: 'all', label: 'All tools', href: `${base}/tools`, count: tools.length },
            {
              id: 'ready',
              label: `Ready in ${space.kind === 'personal' ? 'Personal' : space.name}`,
              href: `${base}/tools?view=ready`,
              count: tools.filter(ready).length,
            },
            ...(space.kind === 'business'
              ? [{ id: 'teams', label: 'For teams', href: `${base}/tools?view=teams` }]
              : []),
            {
              id: 'soon',
              label: 'Coming soon',
              href: `${base}/tools?view=soon`,
              count: tools.filter((tool) => tool.status === 'soon').length,
            },
          ]}
        />
      </div>

      <div className="grid gap-12">
        {categories.map((category) => {
          const list = filtered.filter((tool) => tool.category === category.id);
          if (!list.length) return null;
          return (
            <section
              key={category.id}
              aria-labelledby={`cat-${category.id}`}
              className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8"
            >
              <div className="lg:sticky lg:top-14 lg:self-start lg:pt-1">
                <h2 id={`cat-${category.id}`} className="display text-[24px]">
                  {category.name}
                </h2>
                <p className="mt-1 text-[13.5px] text-muted">{category.line}</p>
                <p className="mono-num mt-3 hidden text-[11px] text-faint lg:block">
                  {list.length} {list.length === 1 ? 'tool' : 'tools'}
                </p>
              </div>
              <div className="grid gap-3">
                {list.map((tool) => {
                  const state = states.get(tool.id)!;
                  const isReady = state.state === 'ready';
                  const canTurnOn = state.state === 'off' && can('space.manage');
                  const href =
                    isReady && tool.path
                      ? `${base}${tool.path}`
                      : canTurnOn
                        ? `${base}/settings#tools`
                        : undefined;
                  const body = (
                    <>
                      <div
                        className="relative h-[132px] shrink-0 overflow-hidden sm:h-auto sm:w-[240px]"
                        style={{
                          background: isReady
                            ? `color-mix(in oklab, ${tool.color} ${tool.ink === 'light' ? 7 : 32}%, white)`
                            : 'var(--color-subtle)',
                        }}
                      >
                        {tool.kind === 'module' || !isReady ? (
                          <div className="flex h-full flex-col justify-between p-4">
                            <ToolGlyph
                              tool={tool}
                              size="lg"
                              className={cn(!isReady && 'opacity-50 grayscale-[.4]')}
                            />
                            {isReady && usage[tool.id] && (
                              <p className="text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">
                                {usage[tool.id]!.split(' ')[0]}
                                <span className="ml-1.5 text-[12.5px] font-normal text-ink/55">
                                  {usage[tool.id]!.split(' ').slice(1).join(' ')}
                                </span>
                              </p>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="absolute inset-0 origin-center scale-[.92] transition-transform duration-500 group-hover:scale-100">
                              <ToolPreview id={tool.id} />
                            </div>
                            <ToolGlyph tool={tool} size="sm" className="absolute top-3 left-3" />
                          </>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col p-4 sm:py-4 sm:pr-5 sm:pl-5">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
                            {toolName(tool, space)}
                          </h3>
                          <Badge
                            tone={
                              tool.status === 'available'
                                ? 'positive'
                                : tool.status === 'beta'
                                  ? 'signal'
                                  : 'outline'
                            }
                            dot={tool.status !== 'soon'}
                          >
                            {statusLabel[tool.status]}
                          </Badge>
                          {href && (
                            <Icon
                              name="arrow-up-right"
                              size={18}
                              className="ml-auto text-faint transition-colors group-hover:text-ink"
                            />
                          )}
                        </div>
                        <p className="mt-0.5 text-[14px] text-ink-2">{tool.tagline}</p>
                        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-muted">
                          {tool.description}
                        </p>
                        <ul className="mt-3 flex flex-wrap gap-1.5">
                          {tool.highlights.map((line) => (
                            <li
                              key={line}
                              className="rounded-full bg-subtle px-2.5 py-1 text-[12px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
                            >
                              {line}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-[12.5px]">
                          <span
                            className={cn(
                              'flex items-center gap-1.5 font-medium',
                              isReady ? 'text-positive' : 'text-muted',
                            )}
                          >
                            <span
                              className={cn(
                                'size-1.5 rounded-full',
                                isReady ? 'bg-positive' : 'bg-faint',
                              )}
                            />
                            {canTurnOn
                              ? 'Off here — turn it on in Settings'
                              : availabilityNote(state, space)}
                          </span>
                          <span className="text-muted">
                            {tool.bestFor === 'both'
                              ? 'Personal & teams'
                              : tool.bestFor === 'teams'
                                ? 'Best for teams'
                                : 'Personal'}
                          </span>
                          {isReady && tool.kind !== 'module' && usage[tool.id] && (
                            <span className="text-muted">{usage[tool.id]} here</span>
                          )}
                          {tool.privacy && (
                            <span className="flex items-center gap-1 text-muted">
                              <Icon name="lock" size={12} /> {tool.privacy}
                            </span>
                          )}
                          {tool.origin === 'studio' && (
                            <span className="text-faint">From Hyphy Studio</span>
                          )}
                        </div>
                      </div>
                    </>
                  );
                  const card =
                    'group flex flex-col overflow-hidden rounded-[20px] bg-surface shadow-card transition-all sm:flex-row';
                  return href ? (
                    <Link
                      key={tool.id}
                      href={href}
                      className={cn(card, 'hover:-translate-y-0.5 hover:shadow-lift')}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div key={tool.id} className={card}>
                      {body}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
