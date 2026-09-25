import Link from 'next/link';
import type { ReactNode } from 'react';
import { CreateButton } from '@/components/create/create-button';
import { ActivityList } from '@/components/records/activity-list';
import { InboxList } from '@/components/records/inbox-list';
import { QrMini } from '@/components/records/qr-mini';
import {
  FileRow,
  MileageRow,
  ProjectRow,
  ReceiptRow,
  VehicleRow,
  VehicleSwatch,
} from '@/components/records/rows';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import { Panel, PanelHeader } from '@/components/ui/panel';
import type { Member } from '@/lib/data';
import type { Workspace } from '@/lib/identity/types';
import { categoryLabel, currentProjectFor, monthSummary } from '@/lib/insights';
import type { CreateActionId } from '@/lib/platform/actions';
import type { WidgetId } from '@/lib/platform/dashboard';
import {
  daysUntil,
  formatCurrency,
  formatDate,
  formatMiles,
  formatNumber,
  formatRelative,
  formatRelativeInline,
  plural,
} from '@/lib/platform/format';
import { roles } from '@/lib/platform/roles';
import { availability, getTool, tools, type ToolDefinition } from '@/lib/platform/tools';
import type {
  ActivityEvent,
  FileRecord,
  InboxItem,
  LinkPage,
  MileageEntry,
  Person,
  Project,
  QrCode,
  Receipt,
  Vehicle,
} from '@/lib/platform/types';

export type DashboardData = {
  workspace: Workspace;
  base: string;
  people: Map<string, Person>;
  directory: Person[];
  members: Member[];
  inbox: InboxItem[];
  activity: ActivityEvent[];
  projects: Project[];
  vehicles: Vehicle[];
  receipts: Receipt[];
  mileage: MileageEntry[];
  files: FileRecord[];
  qrCodes: QrCode[];
  linkPages: LinkPage[];
  month: ReturnType<typeof monthSummary>;
  projectSpend: Map<string, number>;
};

export function Widget({ id, data }: { id: WidgetId; data: DashboardData }) {
  switch (id) {
    case 'pulse':
      return <Pulse data={data} />;
    case 'attention':
      return <Attention data={data} />;
    case 'projects':
      return <Projects data={data} />;
    case 'activity':
      return <Activity data={data} />;
    case 'team':
      return <Team data={data} />;
    case 'money':
      return <Money data={data} />;
    case 'fleet':
      return <Fleet data={data} />;
    case 'codes':
      return <Codes data={data} />;
    case 'launcher':
      return <Launcher data={data} />;
    case 'recent-work':
      return <RecentWork data={data} />;
    case 'recent-files':
      return <RecentFiles data={data} />;
    case 'my-day':
      return <MyDay data={data} />;
    case 'my-vehicle':
      return <MyVehicle data={data} />;
    case 'my-submissions':
      return <MySubmissions data={data} />;
    case 'notices':
      return <Notices data={data} />;
    case 'shared-projects':
      return <SharedProjects data={data} />;
    case 'shared-files':
      return <SharedFiles data={data} />;
    case 'guest-access':
      return <GuestAccess data={data} />;
  }
}

/** Sent in the last couple of minutes: shown arriving, so a submission visibly lands. */
function isFresh(at: string) {
  return Date.now() - new Date(at).getTime() < 120_000;
}

/** Who did something in the last day, most recent first. */
function activeToday(data: DashboardData) {
  const since = Date.now() - 24 * 3600_000;
  const seen = new Set<string>();
  for (const event of data.activity)
    if (new Date(event.at).getTime() >= since && event.actorId !== data.workspace.person.id)
      seen.add(event.actorId);
  return [...seen].map((id) => data.people.get(id)).filter(Boolean) as Person[];
}

/* ---------- operators ---------- */

/** The owner's first glance: what's waiting, what it cost, what's moving, who's working. */
function Pulse({ data }: { data: DashboardData }) {
  const { workspace, base, receipts, mileage, projects, month, inbox, members } = data;
  const can = (permission: (typeof workspace.permissions)[number]) =>
    workspace.permissions.includes(permission);
  const modules = workspace.space.modules;
  const waitingReceipts = receipts.filter((receipt) => receipt.status === 'submitted');
  const waitingTrips = mileage.filter((entry) => entry.status === 'submitted');
  const waiting = waitingReceipts.length + waitingTrips.length;
  const active = projects.filter((project) => project.status === 'active');
  const nextDue = [...active]
    .filter((project) => project.dueDate || project.startDate)
    .sort((a, b) => (a.dueDate ?? a.startDate).localeCompare(b.dueDate ?? b.startDate))[0];
  const word = workspace.space.labels?.projects?.plural ?? 'Projects';
  const events = Boolean(workspace.space.labels?.projects);
  const today = activeToday(data);
  const others = members.filter(
    (member) => member.status === 'active' && member.personId !== workspace.person.id,
  );

  const tiles: {
    label: string;
    value: ReactNode;
    note: string;
    href: string;
    tone?: 'signal' | 'positive';
  }[] = [];
  if (can('expenses.approve'))
    tiles.push({
      label: 'Waiting on approval',
      value: waiting ? String(waiting) : 'None',
      note: waiting
        ? [
            waitingReceipts.length
              ? `${formatCurrency(
                  waitingReceipts.reduce((sum, receipt) => sum + receipt.total, 0),
                )} in receipts`
              : undefined,
            waitingTrips.length ? plural(waitingTrips.length, 'trip') : undefined,
          ]
            .filter(Boolean)
            .join(' · ')
        : 'You’re all caught up',
      href: `${base}/inbox?view=approvals`,
      tone: waiting ? 'signal' : 'positive',
    });
  else
    tiles.push({
      label: 'Needs you',
      value: String(inbox.length),
      note: inbox.length ? 'in your Inbox' : 'You’re all caught up',
      href: `${base}/inbox`,
      tone: inbox.length ? 'signal' : 'positive',
    });
  if (can('expenses.view_all') && modules.includes('receipts'))
    tiles.push({
      label: 'Spent this month',
      value: formatCurrency(month.spend, { cents: false }),
      note: month.categories[0]
        ? `${plural(month.receipts, 'receipt')} · mostly ${categoryLabel[month.categories[0].category].toLowerCase()}`
        : plural(month.receipts, 'receipt'),
      href: `${base}/tools/receipts`,
    });
  if (modules.includes('projects'))
    tiles.push({
      label: events ? `${word} coming up` : `Active ${word.toLowerCase()}`,
      value: String(events ? projects.filter((p) => p.status !== 'done').length : active.length),
      note: nextDue
        ? `${events ? 'Next' : 'Next due'}: ${nextDue.name} · ${daysUntil(nextDue.dueDate ?? nextDue.startDate)}d`
        : 'Nothing scheduled',
      href: `${base}/projects`,
    });
  tiles.push({
    label: 'Team today',
    value: today.length ? (
      <span className="flex items-center gap-2.5">
        <AvatarStack people={today} max={4} size="sm" />
        <span>{today.length}</span>
      </span>
    ) : (
      'Quiet'
    ),
    note: today.length
      ? `of ${others.length} active today`
      : `${plural(others.length, 'person', 'people')}, no activity today`,
    href: `${base}/activity`,
  });

  return (
    <section aria-label="At a glance" className="animate-rise">
      <div
        className={cn(
          'grid grid-cols-2 gap-px overflow-hidden rounded-[18px] bg-line shadow-card',
          tiles.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
        )}
      >
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="group relative flex min-h-[112px] flex-col bg-surface px-4 py-3.5 transition-colors hover:bg-subtle sm:px-5 sm:py-4"
          >
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              {tile.tone === 'signal' && (
                <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
              )}
              {tile.label}
              <Icon
                name="arrow-up-right"
                size={13}
                className="ml-auto text-faint opacity-0 transition-opacity group-hover:opacity-100"
              />
            </span>
            <span
              className={cn(
                'mt-2 text-[28px] leading-none font-semibold tracking-[-0.025em] sm:text-[30px]',
                tile.tone === 'signal' ? 'text-signal-ink' : 'text-ink',
                tile.tone === 'positive' && 'text-[22px] sm:text-[24px]',
              )}
            >
              {tile.value}
            </span>
            <span className="mt-auto line-clamp-2 pt-2 text-[12px] leading-snug text-muted sm:truncate">
              {tile.note}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Attention({ data }: { data: DashboardData }) {
  const { workspace, inbox, base } = data;
  const personal = workspace.space.kind === 'personal';
  return (
    <Panel aria-label="Needs attention">
      <PanelHeader
        title="Needs attention"
        count={inbox.length}
        href={`${base}/inbox`}
        action={personal ? 'Inbox' : 'Open Inbox'}
      />
      {inbox.length ? (
        <InboxList
          items={inbox}
          limit={personal ? 3 : 5}
          people={data.directory}
          base={base}
          slug={workspace.space.slug}
          canApprove={workspace.permissions.includes('expenses.approve')}
          timezone={workspace.space.timezone}
          stacked={personal}
        />
      ) : (
        <EmptyState compact icon="check-circle" title="All clear">
          Nothing needs you right now. Approvals and new documents land here first.
        </EmptyState>
      )}
      {inbox.length > (personal ? 3 : 5) && (
        <Link
          href={`${base}/inbox`}
          className="block border-t border-line px-4 py-2.5 text-center text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
        >
          {plural(inbox.length - (personal ? 3 : 5), 'more item')} in your Inbox
        </Link>
      )}
    </Panel>
  );
}

function Projects({ data }: { data: DashboardData }) {
  const { workspace, projects, base } = data;
  const label = workspace.space.labels?.projects?.plural ?? 'Projects';
  const events = Boolean(workspace.space.labels?.projects);
  const open = projects
    .filter((project) => project.status !== 'done')
    .sort((a, b) =>
      events
        ? a.startDate.localeCompare(b.startDate)
        : Number(b.status === 'active') - Number(a.status === 'active') || b.progress - a.progress,
    );
  return (
    <Panel>
      <PanelHeader
        title={events ? `Upcoming ${label.toLowerCase()}` : `Open ${label.toLowerCase()}`}
        count={open.length}
        href={`${base}/projects`}
      />
      {open.length ? (
        <div className="row-divide pb-1.5">
          {open.slice(0, 5).map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              base={base}
              people={data.people}
              timezone={workspace.space.timezone}
              spent={
                workspace.permissions.includes('expenses.view_all')
                  ? data.projectSpend.get(project.id)
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          icon="projects"
          title={`No open ${label.toLowerCase()}`}
          action={
            <CreateButton request="project" variant="primary" size="sm">
              Create one
            </CreateButton>
          }
        />
      )}
    </Panel>
  );
}

function Activity({ data }: { data: DashboardData }) {
  const { workspace, base } = data;
  const member = workspace.membership.role === 'member';
  return (
    <Panel>
      <PanelHeader
        title={member ? 'On your projects' : 'What happened'}
        href={`${base}/activity`}
        action="All activity"
      />
      {data.activity.length ? (
        <div className="pb-2">
          <ActivityList
            compact
            events={data.activity.slice(0, member ? 5 : 6)}
            people={data.directory}
            base={base}
            viewerId={workspace.person.id}
            timezone={workspace.space.timezone}
          />
        </div>
      ) : (
        <EmptyState compact icon="activity" title="Quiet so far">
          Receipts, trips, files and changes show up here as people work.
        </EmptyState>
      )}
    </Panel>
  );
}

/** What each person has been doing, freshest first. */
function Team({ data }: { data: DashboardData }) {
  const { members, activity, base, workspace } = data;
  const lastSeen = new Map<string, ActivityEvent>();
  for (const event of activity)
    if (!lastSeen.has(event.actorId)) lastSeen.set(event.actorId, event);
  const others = members.filter((member) => member.personId !== workspace.person.id);
  const sorted = [...others].sort(
    (a, b) =>
      Number(a.status === 'invited') - Number(b.status === 'invited') ||
      (lastSeen.get(b.personId)?.at ?? '').localeCompare(lastSeen.get(a.personId)?.at ?? ''),
  );
  const active = members.filter((member) => member.status === 'active').length;
  return (
    <Panel>
      <PanelHeader title="Team" count={active} href={`${base}/people`} />
      <ul className="pb-2">
        {sorted.slice(0, 5).map((member) => {
          const last = lastSeen.get(member.personId);
          return (
            <li key={member.id}>
              <Link
                href={`${base}/people/${member.personId}`}
                className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-subtle"
              >
                <Avatar person={member.person} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[13.5px] font-medium text-ink">
                      {member.person.name}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-faint">
                      {roles[member.role].label}
                    </span>
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {member.status === 'invited'
                      ? 'Invited · hasn’t joined yet'
                      : last
                        ? `${last.verb === 'uploaded' ? 'Added' : last.verb === 'rejected' ? 'Returned' : last.verb[0].toUpperCase() + last.verb.slice(1)} ${last.object.label} · ${formatRelative(last.at, workspace.space.timezone)}`
                        : member.title}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Where this month's money went, by kind and by job. */
function Money({ data }: { data: DashboardData }) {
  const { month, workspace, base, projects, projectSpend } = data;
  const max = Math.max(...month.categories.map((item) => item.total), 1);
  const top = month.projects
    .slice(0, 3)
    .map(({ projectId, total }) => ({
      project: projects.find((item) => item.id === projectId),
      total,
    }))
    .filter((item) => item.project);
  const word = workspace.space.labels?.projects?.plural.toLowerCase() ?? 'projects';
  const budgeted = top.some(({ project }) => project!.budget);
  return (
    <Panel>
      <PanelHeader title="Where the money went" href={`${base}/tools/receipts`} action="Receipts" />
      <div className="px-4 pb-4">
        <p className="flex items-baseline gap-2">
          <span className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink">
            {formatCurrency(month.spend, { cents: false })}
          </span>
          <span className="text-[12.5px] text-muted">this month</span>
        </p>
        {month.categories.length > 0 ? (
          <ul className="mt-4 grid gap-2">
            {month.categories.map((item) => (
              <li
                key={item.category}
                className="grid grid-cols-[76px_1fr_60px] items-center gap-3 text-[12.5px]"
                title={`${categoryLabel[item.category]}: ${formatCurrency(item.total)}`}
              >
                <span className="text-ink-2">{categoryLabel[item.category]}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-well">
                  <span
                    className="block h-full rounded-full bg-ink transition-[width] duration-700"
                    style={{ width: `${Math.max(3, (item.total / max) * 100)}%` }}
                  />
                </span>
                <span className="num text-right text-ink">
                  {formatCurrency(item.total, { cents: false })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-muted">No receipts yet this month.</p>
        )}
        {top.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px] text-muted">
              <span>Top {word} this month</span>
              {budgeted && (
                <span
                  className="text-[11px] text-faint"
                  title="Everything spent so far, against its budget"
                >
                  Budget used
                </span>
              )}
            </p>
            <ul className="grid gap-0.5">
              {top.map(({ project, total }) => (
                <li key={project!.id}>
                  <Link
                    href={`${base}/projects/${project!.id}`}
                    className="-mx-2 flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-[13px] transition-colors hover:bg-subtle"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: project!.color }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink-2">{project!.name}</span>
                    <span className="num text-ink">{formatCurrency(total, { cents: false })}</span>
                    {project!.budget ? (
                      <span className="mono-num w-10 shrink-0 text-right text-[11px] text-faint">
                        {Math.round(((projectSpend.get(project!.id) ?? 0) / project!.budget) * 100)}
                        %
                      </span>
                    ) : budgeted ? (
                      <span className="w-10 shrink-0" aria-hidden="true" />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Fleet({ data }: { data: DashboardData }) {
  // Vehicles that need something come first.
  const attention = (vehicle: Vehicle) =>
    vehicle.status === 'in-shop' ||
    (vehicle.nextServiceMiles !== undefined && vehicle.nextServiceMiles - vehicle.odometer < 1000)
      ? 0
      : vehicle.status === 'available'
        ? 2
        : 1;
  const sorted = [...data.vehicles].sort((a, b) => attention(a) - attention(b));
  return (
    <Panel>
      <PanelHeader title="Vehicles" count={data.vehicles.length} href={`${data.base}/vehicles`} />
      <div className="pb-1.5">
        {sorted.slice(0, 5).map((vehicle) => (
          <VehicleRow key={vehicle.id} vehicle={vehicle} base={data.base} people={data.people} />
        ))}
      </div>
    </Panel>
  );
}

function Codes({ data }: { data: DashboardData }) {
  const { qrCodes, linkPages, base } = data;
  const page = linkPages[0];
  return (
    <Panel>
      <PanelHeader
        title="Codes & link page"
        count={qrCodes.length}
        href={`${base}/tools/qr`}
        action="QR Codes"
      />
      <ul className="grid grid-cols-3 gap-2.5 px-4 pt-1">
        {qrCodes.slice(0, 3).map((code) => (
          <li key={code.id}>
            <Link href={`${base}/tools/qr?code=${code.id}`} className="group block">
              <span className="block rounded-[12px] bg-subtle p-1.5 shadow-[inset_0_0_0_1px_var(--color-line)] transition-transform group-hover:-translate-y-0.5">
                <QrMini content={code.content} fg={code.fg} bg={code.bg} />
              </span>
              <span className="mt-1.5 block truncate text-[12px] font-medium text-ink">
                {code.label}
              </span>
              <span className="block truncate text-[11px] text-muted">
                {code.placement ?? 'Saved code'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {page ? (
        <Link
          href={`${base}/tools/links`}
          className="m-3 mt-3.5 flex items-center gap-3 rounded-[14px] bg-[#2A120E] p-3 text-white transition-transform hover:-translate-y-0.5"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#E0492F] text-[13px] font-semibold">
            {page.title.slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold">@{page.handle}</span>
            <span className="block truncate text-[11.5px] text-white/55">
              {page.links.map((link) => link.label).join(' · ')}
            </span>
          </span>
          <Icon name="arrow-right" size={15} className="text-white/50" />
        </Link>
      ) : (
        <div className="pb-3" />
      )}
    </Panel>
  );
}

/* ---------- personal ---------- */

type LauncherTile = {
  tool: ToolDefinition;
  value: string;
  caption: string;
  latest?: string;
  action: { id: CreateActionId; label: string };
  peek?: ReactNode;
};

/** Every tool you have, with what's in it and the one thing you'd do next. */
function Launcher({ data }: { data: DashboardData }) {
  const { workspace, base, month, receipts, mileage, files, qrCodes, linkPages } = data;
  const tz = workspace.space.timezone;
  const ready = tools.filter(
    (tool) =>
      tool.kind !== 'module' &&
      tool.path &&
      availability(tool, workspace.space, workspace.membership).state === 'ready',
  );
  const latestReceipt = [...receipts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const latestTrip = [...mileage].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const made = (source: string) =>
    files
      .filter((file) => file.source === source)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pdfs = made('pdf');
  const images = made('images');
  const code = [...qrCodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const page = linkPages[0];

  const tile = (tool: ToolDefinition): LauncherTile | null => {
    switch (tool.id) {
      case 'receipts':
        return {
          tool,
          value: formatCurrency(month.spend, { cents: false }),
          caption: `this month · ${plural(month.receipts, 'receipt')}`,
          latest: latestReceipt
            ? `${latestReceipt.vendor} · ${latestReceipt.total ? formatCurrency(latestReceipt.total) : 'needs a total'}`
            : undefined,
          action: { id: 'receipt', label: 'Scan' },
        };
      case 'mileage':
        return {
          tool,
          value: formatMiles(month.miles),
          caption: `this month · ${plural(month.trips, 'trip')}`,
          latest: latestTrip ? `${latestTrip.to} · ${formatMiles(latestTrip.miles)}` : undefined,
          action: { id: 'mileage', label: 'Log trip' },
        };
      case 'pdf':
        return {
          tool,
          value: pdfs.length ? plural(pdfs.length, 'file') : 'Merge',
          caption: pdfs.length ? 'made with PDF' : 'or split, in seconds',
          latest: pdfs[0]
            ? `${pdfs[0].name} · ${formatRelativeInline(pdfs[0].createdAt, tz)}`
            : undefined,
          action: { id: 'pdf', label: 'Merge' },
        };
      case 'qr':
        return {
          tool,
          value: qrCodes.length ? plural(qrCodes.length, 'code') : 'New',
          caption: qrCodes.length ? 'saved here' : 'for any link',
          latest: code ? code.label : undefined,
          action: { id: 'qr', label: 'New code' },
          peek: code ? (
            <span className="block w-[58px] rotate-[4deg] rounded-[10px] bg-white p-1.5 shadow-lift transition-transform duration-300 group-hover:rotate-0">
              <QrMini content={code.content} fg={code.fg} bg={code.bg} className="!rounded-[4px]" />
            </span>
          ) : undefined,
        };
      case 'links':
        return {
          tool,
          value: page ? `@${page.handle}` : 'New',
          caption: page ? plural(page.links.length, 'link') : 'one link for everything',
          latest: page ? `Edited ${formatRelativeInline(page.updatedAt, tz)}` : undefined,
          action: { id: 'link-page', label: 'Edit' },
        };
      case 'images':
        return {
          tool,
          value: images.length ? plural(images.length, 'image') : 'Resize',
          caption: images.length ? 'resized and saved' : 'or convert to WebP',
          latest: images[0] ? images[0].name : undefined,
          action: { id: 'images', label: 'Resize' },
        };
      default:
        return null;
    }
  };
  const tiles = ready.map(tile).filter(Boolean) as LauncherTile[];
  if (!tiles.length) return null;

  return (
    <section aria-label="Your tools">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="label">Your tools</h2>
        <Link
          href={`${base}/tools`}
          className="text-[13px] text-muted transition-colors hover:text-ink"
        >
          All tools
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-3">
        {tiles.map((item, index) => (
          <div
            key={item.tool.id}
            className="group relative flex min-h-[148px] animate-rise flex-col overflow-hidden rounded-[20px] p-3.5 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lift sm:p-4 lg:min-h-[176px]"
            style={{
              background: `color-mix(in oklab, ${item.tool.color} 24%, white)`,
              animationDelay: `${index * 35}ms`,
            }}
          >
            <Link
              href={`${base}${item.tool.path}`}
              className="absolute inset-0 z-0 rounded-[20px]"
              aria-label={`Open ${item.tool.name}`}
            />
            <div className="pointer-events-none relative flex items-center gap-2.5">
              <ToolGlyph tool={item.tool} size="md" />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ink">
                {item.tool.name}
              </span>
              <Icon
                name="arrow-up-right"
                size={16}
                className="hidden text-ink/30 transition-colors group-hover:text-ink sm:block"
              />
            </div>
            <div className="pointer-events-none relative mt-4 flex flex-1 items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[22px] leading-none font-semibold tracking-[-0.025em] text-ink sm:text-[26px]">
                  {item.value}
                </p>
                <p className="mt-1.5 truncate text-[12.5px] text-ink/60">{item.caption}</p>
              </div>
              {item.peek && <span className="hidden shrink-0 sm:block">{item.peek}</span>}
            </div>
            <div className="relative mt-3 flex items-center gap-2">
              {item.latest && (
                <p className="pointer-events-none hidden min-w-0 flex-1 truncate text-[12px] text-ink/55 lg:block">
                  {item.latest}
                </p>
              )}
              <CreateButton
                request={item.action.id}
                size="sm"
                variant="secondary"
                icon="plus"
                className="relative z-10 ml-auto !bg-white/80 !shadow-[inset_0_0_0_1px_rgb(22_21_15/.08)] hover:!bg-white max-lg:w-full"
              >
                {item.action.label}
              </CreateButton>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type WorkItem = { id: string; tool: string; title: string; meta: string; at: string; href: string };

function RecentWork({ data }: { data: DashboardData }) {
  const { base, workspace } = data;
  const tz = workspace.space.timezone;
  const items: WorkItem[] = [
    ...data.files.map((file) => ({
      id: file.id,
      tool: file.source ?? 'files',
      title: file.name,
      meta:
        file.source === 'pdf'
          ? `Merged · ${file.pages} pages`
          : file.source === 'images'
            ? 'Resized'
            : `Filed in ${file.folder}`,
      at: file.createdAt,
      href: `${base}/files?file=${file.id}`,
    })),
    ...data.qrCodes.map((code) => ({
      id: code.id,
      tool: 'qr',
      title: code.label,
      meta: code.placement ? `QR code · ${code.placement}` : 'QR code',
      at: code.createdAt,
      href: `${base}/tools/qr?code=${code.id}`,
    })),
    ...data.linkPages.map((page) => ({
      id: page.id,
      tool: 'links',
      title: `@${page.handle}`,
      meta: `Link page · ${page.links.length} links`,
      at: page.updatedAt,
      href: `${base}/tools/links`,
    })),
    ...data.receipts.map((receipt) => ({
      id: receipt.id,
      tool: 'receipts',
      title: receipt.vendor,
      meta: receipt.total ? formatCurrency(receipt.total) : 'Needs a total',
      at: receipt.createdAt,
      href: `${base}/tools/receipts?receipt=${receipt.id}`,
    })),
    ...data.mileage.map((entry) => ({
      id: entry.id,
      tool: 'mileage',
      title: entry.to,
      meta: `${formatMiles(entry.miles)}${entry.roundTrip ? ' round trip' : ''} · ${entry.purpose}`,
      at: entry.createdAt,
      href: `${base}/tools/mileage`,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 7);

  return (
    <Panel>
      <PanelHeader title="Pick up where you left off" href={`${base}/activity`} action="History" />
      {items.length ? (
        <ul className="pb-2">
          {items.map((item) => {
            const tool = getTool(item.tool) ?? getTool('files')!;
            return (
              <li key={`${item.tool}-${item.id}`}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle"
                >
                  <ToolGlyph tool={tool} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">
                      {item.title}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">{item.meta}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-faint">
                    {formatRelative(item.at, tz)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact icon="sparkles" title="A fresh start">
          Everything you make with a tool lands here: merged PDFs, QR codes, receipts, trips.
        </EmptyState>
      )}
    </Panel>
  );
}

function RecentFiles({ data }: { data: DashboardData }) {
  const { base, workspace, files } = data;
  const recent = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  return (
    <Panel>
      <PanelHeader title="Files" count={files.length} href={`${base}/files`} action="All files" />
      {recent.length ? (
        <div className="pb-1.5">
          {recent.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              base={base}
              people={data.people}
              timezone={workspace.space.timezone}
              context={file.folder}
              compact
            />
          ))}
        </div>
      ) : (
        <EmptyState compact icon="files" title="Nothing saved yet">
          Merged PDFs, resized images and your own documents land here.
        </EmptyState>
      )}
    </Panel>
  );
}

/* ---------- members ---------- */

function MyDay({ data }: { data: DashboardData }) {
  const { base, workspace } = data;
  const project = currentProjectFor(workspace.person.id, data.projects, data.activity);
  if (!project)
    return (
      <Panel>
        <EmptyState icon="projects" title="No project assigned yet">
          When a manager adds you to a{' '}
          {workspace.space.labels?.projects?.singular.toLowerCase() ?? 'project'}, it shows up here.
        </EmptyState>
      </Panel>
    );
  const lead = data.people.get(project.leadId);
  const inspection = project.custom?.next_inspection as string | undefined;
  const photos = data.files
    .filter((file) => file.kind === 'image' && file.attachedTo.some((ref) => ref.id === project.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const others = data.projects.filter(
    (item) =>
      item.id !== project.id &&
      item.status === 'active' &&
      item.teamIds.includes(workspace.person.id),
  );
  return (
    <Panel className="overflow-hidden">
      <div
        className="relative px-4 pt-4 pb-4 sm:px-5"
        style={{ background: `color-mix(in oklab, ${project.color} 9%, white)` }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: project.color }}
          aria-hidden="true"
        />
        <p className="label">You’re on</p>
        <Link href={`${base}/projects/${project.id}`} className="mt-1.5 block">
          <h2 className="display text-[26px] text-ink hover:underline sm:text-[30px]">
            {project.name}
          </h2>
        </Link>
        {project.location && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[14px] text-muted">
            <Icon name="map-pin" size={15} /> {project.location}
          </p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {lead && (
            <div className="flex items-center gap-2">
              <Avatar person={lead} size="sm" />
              <div className="min-w-0">
                <dt className="text-[11.5px] text-muted">Lead</dt>
                <dd className="truncate text-[13.5px] font-medium">{lead.name}</dd>
              </div>
            </div>
          )}
          {inspection && (
            <div>
              <dt className="text-[11.5px] text-muted">Next inspection</dt>
              <dd className="text-[13.5px] font-medium">
                {formatDate(inspection, workspace.space.timezone)} · in {daysUntil(inspection)} days
              </dd>
            </div>
          )}
          <div className="hidden sm:block">
            <dt className="text-[11.5px] text-muted">Photos</dt>
            <dd className="text-[13.5px] font-medium">{photos.length} so far</dd>
          </div>
        </dl>
        {photos.length > 0 && (
          <div className="mt-4 flex gap-2">
            {photos.slice(0, 4).map((file) => (
              <Link
                key={file.id}
                href={`${base}/files?file=${file.id}`}
                className="h-16 flex-1 rounded-[10px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)] transition-transform hover:scale-[1.03]"
                style={{ background: file.preview }}
                title={file.name}
                aria-label={file.name}
              />
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <CreateButton
            request={{ id: 'photos', attachTo: { type: 'project', id: project.id } }}
            variant="primary"
            icon="camera"
          >
            Add photos
          </CreateButton>
          <Link href={`${base}/projects/${project.id}`} className={buttonClass()}>
            Open project
          </Link>
        </div>
      </div>
      {others.length > 0 && (
        <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-muted sm:px-5">
          Also on{' '}
          {others.map((item, index) => (
            <span key={item.id}>
              {index > 0 && ', '}
              <Link
                href={`${base}/projects/${item.id}`}
                className="font-medium text-ink-2 hover:underline"
              >
                {item.name}
              </Link>
            </span>
          ))}
        </p>
      )}
    </Panel>
  );
}

function MyVehicle({ data }: { data: DashboardData }) {
  const { workspace, base } = data;
  const vehicle = data.vehicles.find((item) => item.assignedTo === workspace.person.id);
  if (!vehicle)
    return (
      <Panel>
        <PanelHeader title="Your vehicle" />
        <p className="px-4 pb-4 text-[13.5px] text-muted">
          No vehicle assigned. Trips in your own car still count — log them as personal vehicle.
        </p>
      </Panel>
    );
  const toService = vehicle.nextServiceMiles ? vehicle.nextServiceMiles - vehicle.odometer : null;
  const lastFuel = data.receipts.find(
    (receipt) => receipt.vehicleId === vehicle.id && receipt.category === 'fuel',
  );
  return (
    <Panel>
      <PanelHeader title="Your vehicle" href={`${base}/vehicles/${vehicle.id}`} action="Details" />
      <div className="flex items-center gap-3 px-4 pb-3">
        <VehicleSwatch vehicle={vehicle} size="lg" />
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-ink">{vehicle.name}</p>
          <p className="truncate text-[13px] text-muted">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px border-y border-line bg-line">
        <div className="bg-surface px-4 py-3">
          <dt className="text-[12px] text-muted">Odometer</dt>
          <dd className="num text-[17px] font-semibold">{formatNumber(vehicle.odometer)} mi</dd>
        </div>
        <div className="bg-surface px-4 py-3">
          <dt className="text-[12px] text-muted">Service in</dt>
          <dd
            className={cn(
              'num text-[17px] font-semibold',
              toService !== null && toService < 1000 && 'text-caution',
            )}
          >
            {toService !== null ? `${formatNumber(toService)} mi` : '—'}
          </dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="min-w-0 text-[12.5px] text-muted">
          Fuel card ••{vehicle.fuelCardLast4}
          {lastFuel && (
            <> · last fill {formatRelativeInline(lastFuel.date, workspace.space.timezone)}</>
          )}
        </p>
        <CreateButton
          request={{
            id: 'receipt',
            attachTo: { type: 'vehicle', id: vehicle.id },
            preset: { category: 'fuel' },
          }}
          size="sm"
          icon="fuel"
        >
          Log fuel
        </CreateButton>
      </div>
    </Panel>
  );
}

function MySubmissions({ data }: { data: DashboardData }) {
  const { workspace, base } = data;
  const tz = workspace.space.timezone;
  const all = [...data.receipts, ...data.mileage];
  const pending = all.filter((item) => item.status === 'submitted').length;
  const returned = all.filter((item) => item.status === 'rejected').length;
  // Returned items first — they're the only ones that need Mike again.
  const items = [
    ...data.receipts.map((receipt) => ({
      at: receipt.createdAt,
      returned: receipt.status === 'rejected',
      node: (
        <ReceiptRow
          key={receipt.id}
          receipt={receipt}
          people={data.people}
          timezone={tz}
          kind="business"
          showPerson={false}
          href={`${base}/tools/receipts?receipt=${receipt.id}`}
        />
      ),
    })),
    ...data.mileage.map((entry) => ({
      at: entry.createdAt,
      returned: entry.status === 'rejected',
      node: (
        <MileageRow
          key={entry.id}
          entry={entry}
          people={data.people}
          timezone={tz}
          kind="business"
          showPerson={false}
        />
      ),
    })),
  ].sort((a, b) => Number(b.returned) - Number(a.returned) || b.at.localeCompare(a.at));

  return (
    <Panel>
      <PanelHeader title="Your submissions" href={`${base}/tools/receipts`} action="All">
        <span className="mr-auto -ml-1 text-[12.5px] text-muted">
          {[
            pending ? `${pending} waiting` : undefined,
            returned ? `${returned} returned` : undefined,
          ]
            .filter(Boolean)
            .join(' · ') || (items.length ? 'All approved' : '')}
        </span>
      </PanelHeader>
      {items.length ? (
        <div className="row-divide pb-1.5">
          {items.slice(0, 6).map((item) => (
            <div key={item.node.key} data-fresh={isFresh(item.at) || undefined}>
              {item.node}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState compact icon="receipt" title="Nothing submitted yet">
          Receipts and trips you submit show here with their status.
        </EmptyState>
      )}
    </Panel>
  );
}

function Notices({ data }: { data: DashboardData }) {
  const { workspace, base } = data;
  return (
    <Panel>
      <PanelHeader
        title="For you"
        count={data.inbox.length}
        href={`${base}/inbox`}
        action="Inbox"
      />
      {data.inbox.length ? (
        <InboxList
          items={data.inbox}
          limit={3}
          people={data.directory}
          base={base}
          slug={workspace.space.slug}
          canApprove={false}
          timezone={workspace.space.timezone}
          stacked
        />
      ) : (
        <p className="flex items-center gap-2 px-4 pb-4 text-[13.5px] text-muted">
          <Icon name="check-circle" size={15} className="text-positive" /> Nothing new for you.
        </p>
      )}
    </Panel>
  );
}

/* ---------- guests ---------- */

function SharedProjects({ data }: { data: DashboardData }) {
  const { projects, base, workspace, files } = data;
  const tz = workspace.space.timezone;
  const label = workspace.space.labels?.projects?.plural ?? 'Projects';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {projects.map((project) => {
        const attached = files.filter((file) =>
          file.attachedTo.some((ref) => ref.id === project.id),
        );
        const photos = attached
          .filter((file) => file.kind === 'image')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const team = project.teamIds.map((id) => data.people.get(id)).filter(Boolean) as Person[];
        const lead = data.people.get(project.leadId);
        const inspection = project.custom?.next_inspection as string | undefined;
        return (
          <Panel key={project.id} className="flex animate-rise flex-col overflow-hidden">
            <Link
              href={`${base}/projects/${project.id}`}
              className="relative flex h-20 gap-px overflow-hidden"
              style={{ background: `color-mix(in oklab, ${project.color} 22%, white)` }}
              aria-label={`Open ${project.name}`}
            >
              {photos.slice(0, 3).map((file) => (
                <span key={file.id} className="flex-1" style={{ background: file.preview }} />
              ))}
              <span
                className="absolute inset-x-0 bottom-0 h-1"
                style={{ background: project.color }}
                aria-hidden="true"
              />
            </Link>
            <div className="flex flex-1 flex-col p-4">
              <Link href={`${base}/projects/${project.id}`}>
                <h2 className="text-[18px] font-semibold tracking-[-0.01em] hover:underline">
                  {project.name}
                </h2>
              </Link>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted">
                <Icon name="map-pin" size={13} /> {project.location}
              </p>
              <dl className="mt-3.5 grid grid-cols-2 gap-3 text-[13px]">
                {lead && (
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar person={lead} size="sm" />
                    <div className="min-w-0">
                      <dt className="text-[11.5px] text-muted">Lead</dt>
                      <dd className="truncate font-medium">{lead.name}</dd>
                    </div>
                  </div>
                )}
                {inspection ? (
                  <div>
                    <dt className="text-[11.5px] text-muted">Next inspection</dt>
                    <dd className="font-medium">
                      {formatDate(inspection, tz)} · {daysUntil(inspection)}d
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt className="text-[11.5px] text-muted">Files</dt>
                    <dd className="font-medium">{attached.length}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
                <AvatarStack people={team} size="sm" />
                <span className="mr-auto text-[12px] text-muted">
                  {plural(attached.length, 'file')}
                </span>
                <Link
                  href={`${base}/projects/${project.id}`}
                  className={buttonClass({ size: 'sm', variant: 'ghost' })}
                >
                  Open
                </Link>
                <CreateButton
                  request={{ id: 'file', attachTo: { type: 'project', id: project.id } }}
                  variant="primary"
                  size="sm"
                  icon="upload"
                >
                  Upload
                </CreateButton>
              </div>
            </div>
          </Panel>
        );
      })}
      {projects.length === 0 && (
        <Panel className="sm:col-span-2">
          <EmptyState icon="projects" title={`No ${label.toLowerCase()} shared yet`}>
            When {workspace.space.name} shares a{' '}
            {workspace.space.labels?.projects?.singular.toLowerCase() ?? 'project'} with you, it
            shows up here.
          </EmptyState>
        </Panel>
      )}
    </div>
  );
}

/** A guest's plain answer to “who can access this?”: what's shared, what isn't, who to call. */
function GuestAccess({ data }: { data: DashboardData }) {
  const { projects, workspace } = data;
  const word = workspace.space.labels?.projects?.plural.toLowerCase() ?? 'projects';
  const leads = [...new Set(projects.map((project) => project.leadId))]
    .map((id) => data.people.get(id))
    .filter(Boolean) as Person[];
  const lines: { yes: boolean; text: string }[] = [
    { yes: true, text: `Files and photos on the ${word} shared with you` },
    { yes: true, text: 'Adding your own — the team sees them right away' },
    { yes: true, text: 'Who’s on each one' },
    { yes: false, text: `Money, receipts and other ${word} stay private` },
  ];
  return (
    <Panel>
      <PanelHeader title="What you can see here" />
      <ul className="grid gap-2 px-4 pb-3 text-[13px]">
        {lines.map((line) => (
          <li key={line.text} className="flex items-start gap-2.5">
            <span
              className={cn(
                'mt-px grid size-[18px] shrink-0 place-items-center rounded-full',
                line.yes ? 'bg-positive-soft text-positive' : 'bg-well text-muted',
              )}
              aria-label={line.yes ? 'Yes' : 'No'}
            >
              <Icon name={line.yes ? 'check' : 'lock'} size={11} strokeWidth={2.4} />
            </span>
            <span className={line.yes ? 'text-ink-2' : 'text-muted'}>{line.text}</span>
          </li>
        ))}
      </ul>
      {leads.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-2 text-[12px] text-muted">Questions? Your contact</p>
          <ul className="grid gap-2">
            {leads.map((lead) => (
              <li key={lead.id} className="flex items-center gap-2.5">
                <Avatar person={lead} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{lead.name}</span>
                  <span className="block truncate text-[12px] text-muted">{lead.headline}</span>
                </span>
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone.replace(/[^0-9+]/g, '')}`}
                    className={buttonClass({ size: 'sm', variant: 'ghost' })}
                  >
                    {lead.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function SharedFiles({ data }: { data: DashboardData }) {
  const { files, base, workspace, projects } = data;
  return (
    <Panel>
      <PanelHeader title="Shared files" count={files.length} href={`${base}/files`} />
      <div className="pb-1.5">
        {files.slice(0, 6).map((file) => (
          <FileRow
            key={file.id}
            file={file}
            base={base}
            people={data.people}
            timezone={workspace.space.timezone}
            links={file.attachedTo
              .filter((ref) => ref.type === 'project')
              .map((ref) => ({
                type: 'project' as const,
                label: projects.find((project) => project.id === ref.id)?.name ?? '',
              }))
              .filter((ref) => ref.label)}
          />
        ))}
      </div>
    </Panel>
  );
}
