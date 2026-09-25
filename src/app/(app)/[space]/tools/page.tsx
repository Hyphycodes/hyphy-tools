import Link from 'next/link';
import { PinButton } from '@/components/records/pin-button';
import { CreateButton } from '@/components/create/create-button';
import { ToolPreview } from '@/components/tools/previews';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import { Page, PageHeader } from '@/components/ui/page';
import { openPage } from '@/lib/page';
import type { CreateActionId } from '@/lib/platform/actions';
import { formatCurrency, formatMiles, formatRelative, plural } from '@/lib/platform/format';
import {
  availability,
  availabilityNote,
  statusLabel,
  toolName,
  tools,
  type ToolDefinition,
} from '@/lib/platform/tools';

export const metadata = { title: 'Tools' };

/** What each tool's card offers as its one next step. */
const primary: Record<string, { id: CreateActionId; label: string }> = {
  receipts: { id: 'receipt', label: 'Add a receipt' },
  mileage: { id: 'mileage', label: 'Log a trip' },
  pdf: { id: 'pdf', label: 'Merge PDFs' },
  qr: { id: 'qr', label: 'New code' },
  links: { id: 'link-page', label: 'Edit page' },
  images: { id: 'images', label: 'Resize images' },
};

/**
 * The Tools library: what you can do here, what you made last, and what's coming. Read straight
 * from the registry, so a new tool appears here the moment it's added.
 */
export default async function ToolsPage({ params }: PageProps<'/[space]/tools'>) {
  const { workspace, repo, base, can, tz } = await openPage(params);
  const { space, membership } = workspace;
  const [receipts, mileage, qrCodes, linkPages, files, projects, vehicles, members, pins] =
    await Promise.all([
      repo.receipts(),
      repo.mileage(),
      repo.qrCodes(),
      repo.linkPages(),
      repo.files(),
      repo.projects(),
      repo.vehicles(),
      repo.members(),
      repo.pins(),
    ]);
  const pinned = new Set(pins.filter((pin) => pin.type === 'tool').map((pin) => pin.id));
  const made = (source: string) => files.filter((file) => file.source === source);
  const usage: Record<string, string | undefined> = {
    receipts: receipts.length ? `${plural(receipts.length, 'receipt')} here` : undefined,
    mileage: mileage.length ? `${plural(mileage.length, 'trip')} here` : undefined,
    qr: qrCodes.length ? `${plural(qrCodes.length, 'saved code')}` : undefined,
    links: linkPages[0]
      ? `@${linkPages[0].handle} · ${plural(linkPages[0].links.length, 'link')}`
      : undefined,
    pdf: made('pdf').length ? `${plural(made('pdf').length, 'merged PDF')} saved` : undefined,
    images: made('images').length ? `${plural(made('images').length, 'image')} resized` : undefined,
    projects: projects.length
      ? `${projects.length} ${toolName(
          tools.find((tool) => tool.id === 'projects')!,
          space,
        ).toLowerCase()}`
      : undefined,
    vehicles: vehicles.length ? plural(vehicles.length, 'vehicle') : undefined,
    people: members.length ? plural(members.length, 'person', 'people') : undefined,
    files: files.length ? plural(files.length, 'file') : undefined,
  };

  const states = new Map(tools.map((tool) => [tool.id, availability(tool, space, membership)]));
  const ready = (tool: ToolDefinition) => states.get(tool.id)?.state === 'ready';

  // Lead with what this kind of Space reaches for: a field team's receipts, a restaurant's codes.
  const order =
    space.kind === 'personal'
      ? ['pdf', 'qr', 'receipts', 'mileage', 'links', 'images']
      : space.modules.includes('vehicles')
        ? ['receipts', 'mileage', 'pdf', 'qr', 'links', 'images']
        : ['qr', 'links', 'receipts', 'pdf', 'images', 'mileage'];
  const utilities = tools
    .filter((tool) => tool.kind !== 'module' && tool.status !== 'soon' && ready(tool))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  // Two feature tiles, then the rest share a row evenly — whatever a Space has turned on.
  const small = Math.max(utilities.length - 2, 0);
  const spans: Record<number, string> = {
    1: 'lg:col-span-12',
    2: 'lg:col-span-6',
    3: 'lg:col-span-4',
    4: 'lg:col-span-3',
  };
  const modules = tools.filter((tool) => tool.kind === 'module' && tool.status !== 'soon');
  const unavailable = tools.filter(
    (tool) => tool.kind !== 'module' && tool.status !== 'soon' && !ready(tool),
  );
  const soon = tools.filter((tool) => tool.status === 'soon');

  // The last few things made with any tool, so coming back is one click.
  const recent = [
    ...files
      .filter((file) => file.source)
      .map((file) => ({
        id: file.id,
        tool: file.source!,
        title: file.name,
        meta: file.source === 'pdf' ? `${file.pages ?? ''} pages` : 'Resized',
        at: file.createdAt,
        href: `${base}/files?file=${file.id}`,
      })),
    ...qrCodes.map((code) => ({
      id: code.id,
      tool: 'qr',
      title: code.label,
      meta: code.placement ?? 'QR code',
      at: code.createdAt,
      href: `${base}/tools/qr?code=${code.id}`,
    })),
    ...linkPages.map((page) => ({
      id: page.id,
      tool: 'links',
      title: `@${page.handle}`,
      meta: plural(page.links.length, 'link'),
      at: page.updatedAt,
      href: `${base}/tools/links`,
    })),
    ...receipts.map((receipt) => ({
      id: receipt.id,
      tool: 'receipts',
      title: receipt.vendor,
      meta: receipt.total ? formatCurrency(receipt.total) : 'Needs a total',
      at: receipt.createdAt,
      href: `${base}/tools/receipts?receipt=${receipt.id}`,
    })),
    ...mileage.map((entry) => ({
      id: entry.id,
      tool: 'mileage',
      title: entry.to,
      meta: formatMiles(entry.miles),
      at: entry.createdAt,
      href: `${base}/tools/mileage`,
    })),
  ]
    .filter((item) => utilities.some((tool) => tool.id === item.tool))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 4);

  return (
    <Page wide>
      <PageHeader
        title="Tools"
        description={
          space.kind === 'personal'
            ? 'Small, sharp tools for everyday jobs. Everything you make is saved here, private to you.'
            : `Small, sharp tools for everyday jobs. What you make is saved to ${space.name}, where the team can find it.`
        }
      />

      {recent.length > 0 && (
        <section aria-labelledby="recent" className="mb-8">
          <h2 id="recent" className="label mb-3">
            Jump back in
          </h2>
          <ul className="scrollbar-none -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-4">
            {recent.map((item) => {
              const tool = tools.find((entry) => entry.id === item.tool)!;
              return (
                <li key={`${item.tool}-${item.id}`} className="w-[240px] shrink-0 sm:w-auto">
                  <Link
                    href={item.href}
                    className="group flex items-center gap-3 rounded-[16px] bg-surface p-2.5 pr-3.5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift"
                  >
                    <ToolGlyph tool={tool} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">
                        {item.title}
                      </span>
                      <span className="block truncate text-[12px] text-muted">
                        {item.meta} · {formatRelative(item.at, tz)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {utilities.length > 0 && (
        <section aria-label="Your tools" className="grid grid-cols-2 gap-3 lg:grid-cols-12">
          {utilities.map((tool, index) => {
            const big = index < 2;
            const action = primary[tool.id];
            // Phones: the two features run full width, the rest pair up; an odd one out spans.
            const alone = !big && small % 2 === 1 && index === utilities.length - 1;
            return (
              <article
                key={tool.id}
                className={cn(
                  'group relative flex animate-rise flex-col overflow-hidden rounded-[24px] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-lift',
                  big ? spans[Math.min(utilities.length, 2)] : spans[Math.min(small, 4)],
                  (big || alone) && 'max-sm:col-span-2',
                )}
                style={{
                  background: `color-mix(in oklab, ${tool.color} ${big ? 30 : 24}%, white)`,
                  animationDelay: `${index * 40}ms`,
                }}
              >
                <Link
                  href={`${base}${tool.path}`}
                  className="absolute inset-0 z-0 rounded-[24px]"
                  aria-label={`Open ${tool.name}`}
                />
                {/* Pinned tools lead Home and the sidebar. */}
                <PinButton
                  slug={space.slug}
                  target={{ type: 'tool', id: tool.id }}
                  pinned={pinned.has(tool.id)}
                  label={tool.name}
                  className="absolute top-2.5 right-2.5 z-10 bg-white/70 backdrop-blur"
                />
                <div
                  className={cn(
                    'pointer-events-none relative overflow-hidden',
                    big ? 'h-[200px] lg:h-[230px]' : 'h-[108px] sm:h-[150px]',
                  )}
                  aria-hidden="true"
                >
                  <div
                    className={cn(
                      'absolute inset-0 origin-center transition-transform duration-500 ease-out group-hover:scale-100',
                      big || alone ? 'scale-[.9]' : 'scale-[.7] sm:scale-[.9]',
                    )}
                  >
                    <ToolPreview id={tool.id} />
                  </div>
                </div>
                <div
                  className={cn(
                    'pointer-events-none relative flex flex-1 flex-col px-3.5 pb-3.5 sm:px-5 sm:pb-5',
                    big && 'px-4 pb-4',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <ToolGlyph tool={tool} size={big ? 'md' : 'sm'} />
                    <h3
                      className={cn(
                        'font-semibold tracking-[-0.015em] text-ink',
                        big ? 'text-[20px]' : 'text-[16px]',
                      )}
                    >
                      {tool.name}
                    </h3>
                    {tool.status === 'beta' && (
                      <Badge tone="signal" className="bg-white/70">
                        {statusLabel.beta}
                      </Badge>
                    )}
                  </div>
                  <p
                    className={cn(
                      'mt-2 text-ink/70',
                      big ? 'max-w-[46ch] text-[14.5px] leading-relaxed' : 'text-[13.5px]',
                    )}
                  >
                    {big ? tool.description : tool.tagline}
                  </p>
                  <div
                    className={cn(
                      'mt-auto flex items-end justify-between gap-3 pt-4',
                      !big &&
                        !alone &&
                        'max-sm:flex-col max-sm:items-stretch max-sm:gap-2 max-sm:pt-3',
                    )}
                  >
                    <p className="min-w-0 text-[12.5px] text-ink/55">
                      {usage[tool.id] ?? (tool.privacy && big ? tool.privacy : 'Nothing made yet')}
                    </p>
                    {action && (
                      <span className="pointer-events-auto relative z-10 shrink-0">
                        <CreateButton
                          request={action.id}
                          size="sm"
                          variant={big ? 'primary' : 'secondary'}
                          className={big ? undefined : '!bg-white/85 hover:!bg-white max-sm:w-full'}
                          fallbackHref={`${base}${tool.path}`}
                        >
                          {action.label}
                        </CreateButton>
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {modules.some(ready) && (
        <section aria-labelledby="business" className="mt-10">
          <h2 id="business" className="label mb-3">
            {space.kind === 'personal' ? 'Also in your Space' : `Running ${space.name}`}
          </h2>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {modules.filter(ready).map((tool) => (
              <Link
                key={tool.id}
                href={`${base}${tool.path}`}
                className="group flex items-center gap-3 rounded-[18px] bg-surface p-3 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift"
              >
                <ToolGlyph tool={tool} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {toolName(tool, space)}
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {usage[tool.id] ?? tool.tagline}
                  </span>
                </span>
                <Icon
                  name="arrow-right"
                  size={15}
                  className="hidden text-faint transition-transform group-hover:translate-x-0.5 sm:block"
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {space.kind === 'personal' && (
        <section
          aria-labelledby="teams"
          className="mt-10 flex flex-col gap-4 rounded-[22px] bg-subtle p-5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:flex-row sm:items-center"
        >
          <div className="flex -space-x-2">
            {modules
              .filter(
                (tool) =>
                  tool.spaceKinds.includes('business') && !tool.spaceKinds.includes('personal'),
              )
              .map((tool) => (
                <ToolGlyph key={tool.id} tool={tool} size="md" className="ring-2 ring-subtle" />
              ))}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="teams" className="text-[15px] font-semibold text-ink">
              Projects, Vehicles and People come with a business Space
            </h2>
            <p className="mt-0.5 text-[13.5px] text-muted">
              The same tools, plus a place for a team’s jobs, trucks and paperwork — with approvals
              built in.
            </p>
          </div>
        </section>
      )}

      {(unavailable.length > 0 || soon.length > 0) && (
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          {unavailable.length > 0 && (
            <section aria-labelledby="unavailable">
              <h2 id="unavailable" className="label mb-3">
                Not on here
              </h2>
              <ul className="grid gap-2">
                {unavailable.map((tool) => {
                  const state = states.get(tool.id)!;
                  const turnOn = state.state === 'off' && can('space.manage');
                  return (
                    <li key={tool.id}>
                      <div className="flex items-center gap-3 rounded-[16px] bg-surface p-3 shadow-card">
                        <ToolGlyph tool={tool} size="md" className="opacity-60 grayscale-[.5]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-medium text-ink">
                            {tool.name}
                          </span>
                          <span className="block truncate text-[12.5px] text-muted">
                            {availabilityNote(state, space)}
                          </span>
                        </span>
                        {turnOn && (
                          <Link
                            href={`${base}/settings#tools`}
                            className="text-[13px] font-medium text-signal-ink hover:underline"
                          >
                            Turn on
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {soon.length > 0 && (
            <section aria-labelledby="soon">
              <h2 id="soon" className="label mb-3">
                Coming soon
              </h2>
              <ul className="grid gap-2">
                {soon.map((tool) => (
                  <li
                    key={tool.id}
                    className="flex items-center gap-3 rounded-[16px] p-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)] [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(22_21_15/.025)_6px_7px)]"
                  >
                    <ToolGlyph tool={tool} size="md" className="opacity-70" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                        {tool.name}
                        <Badge tone="outline">{statusLabel.soon}</Badge>
                      </span>
                      <span className="block truncate text-[12.5px] text-muted">
                        {tool.tagline}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
