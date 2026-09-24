import Link from 'next/link';
import { CreateButton } from '@/components/create/create-button';
import { ActivityList } from '@/components/records/activity-list';
import { InboxList } from '@/components/records/inbox-list';
import { QrMini } from '@/components/records/qr-mini';
import { ApprovalBadge } from '@/components/records/status';
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
import { SpaceMark, ToolGlyph } from '@/components/ui/marks';
import { Panel, PanelHeader } from '@/components/ui/panel';
import type { Member } from '@/lib/data';
import type { Workspace } from '@/lib/identity/types';
import { categoryLabel, monthSummary } from '@/lib/insights';
import type { WidgetId } from '@/lib/platform/dashboard';
import {
  daysUntil,
  formatCurrency,
  formatDate,
  formatMiles,
  formatNumber,
  formatRelative,
} from '@/lib/platform/format';
import { plans } from '@/lib/platform/plans';
import { roles } from '@/lib/platform/roles';
import { availability, getTool, tools } from '@/lib/platform/tools';
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
    case 'attention':
      return <Attention data={data} />;
    case 'projects':
      return <Projects data={data} />;
    case 'month':
      return <Month data={data} />;
    case 'activity':
      return <Activity data={data} />;
    case 'team':
      return <Team data={data} />;
    case 'fleet':
      return <Fleet data={data} />;
    case 'plan':
      return <Plan data={data} />;
    case 'codes':
      return <Codes data={data} />;
    case 'recent-work':
      return <RecentWork data={data} />;
    case 'favorite-tools':
      return <FavoriteTools data={data} />;
    case 'personal-month':
      return <PersonalMonth data={data} />;
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
  }
}

/* ---------- operators ---------- */

function Attention({ data }: { data: DashboardData }) {
  const { workspace, inbox, base } = data;
  return (
    <Panel aria-label="Needs attention">
      <PanelHeader
        title="Needs attention"
        count={inbox.length}
        href={`${base}/inbox`}
        action="Open Inbox"
      />
      {inbox.length ? (
        <InboxList
          items={inbox}
          limit={workspace.space.kind === 'personal' ? 3 : 4}
          people={data.directory}
          base={base}
          slug={workspace.space.slug}
          canApprove={workspace.permissions.includes('expenses.approve')}
          timezone={workspace.space.timezone}
        />
      ) : (
        <EmptyState compact icon="check-circle" title="All clear">
          Nothing needs you right now. New approvals and documents land here first.
        </EmptyState>
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
        title={events ? `Upcoming ${label.toLowerCase()}` : `${label} in motion`}
        count={open.length}
        href={`${base}/projects`}
      />
      <div className="row-divide pb-1.5">
        {open.slice(0, 5).map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            base={base}
            people={data.people}
            timezone={workspace.space.timezone}
            spent={data.projectSpend.get(project.id)}
          />
        ))}
      </div>
    </Panel>
  );
}

function Month({ data }: { data: DashboardData }) {
  const { month, workspace } = data;
  const max = Math.max(...month.categories.map((item) => item.total), 1);
  const tiles = [
    {
      label: 'Spent',
      value: formatCurrency(month.spend, { cents: false }),
      note: `${month.receipts} receipts`,
    },
    { label: 'Waiting on approval', value: String(month.pendingReceipts), note: 'receipts' },
    ...(workspace.space.modules.includes('mileage')
      ? [
          {
            label: 'Miles logged',
            value: formatNumber(month.miles, month.miles % 1 ? 1 : 0),
            note: `${month.trips} trips`,
          },
        ]
      : []),
    { label: 'Files added', value: String(month.files), note: 'this month' },
  ];
  return (
    <Panel>
      <PanelHeader title="This month" href={`${data.base}/tools/receipts`} action="Receipts" />
      <div
        className={cn(
          'grid grid-cols-2 gap-px overflow-hidden border-y border-line bg-line',
          tiles.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
        )}
      >
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-surface px-4 py-3.5">
            <p className="text-[12.5px] text-muted">{tile.label}</p>
            <p className="mt-1 text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink">
              {tile.value}
            </p>
            <p className="mt-1 text-[12px] text-faint">{tile.note}</p>
          </div>
        ))}
      </div>
      {month.categories.length > 0 && (
        <div className="px-4 pt-3.5 pb-4">
          <p className="mb-2.5 text-[12.5px] text-muted">Where it went</p>
          <ul className="grid gap-2">
            {month.categories.map((item) => (
              <li
                key={item.category}
                className="grid grid-cols-[88px_1fr_76px] items-center gap-3 text-[13px]"
                title={`${categoryLabel[item.category]}: ${formatCurrency(item.total)}`}
              >
                <span className="text-ink-2">{categoryLabel[item.category]}</span>
                <span className="h-2 overflow-hidden rounded-full bg-well">
                  <span
                    className="block h-full rounded-full bg-ink transition-[width] duration-700"
                    style={{ width: `${Math.max(3, (item.total / max) * 100)}%` }}
                  />
                </span>
                <span className="text-right text-ink">
                  {formatCurrency(item.total, { cents: false })}
                </span>
              </li>
            ))}
          </ul>
          <p className="sr-only">Spend by category in {workspace.space.name} this month.</p>
        </div>
      )}
    </Panel>
  );
}

function Activity({ data }: { data: DashboardData }) {
  const { workspace, base } = data;
  return (
    <Panel>
      <PanelHeader
        title={workspace.membership.role === 'member' ? 'On your projects' : 'Activity'}
        href={`${base}/activity`}
        action="See all"
      />
      {data.activity.length ? (
        <div className="pb-2">
          <ActivityList
            compact
            events={data.activity.slice(0, 7)}
            people={data.directory}
            base={base}
            viewerId={workspace.person.id}
            timezone={workspace.space.timezone}
          />
        </div>
      ) : (
        <EmptyState compact icon="activity" title="Quiet so far" />
      )}
    </Panel>
  );
}

function Team({ data }: { data: DashboardData }) {
  const { members, activity, base, workspace } = data;
  const lastSeen = new Map<string, ActivityEvent>();
  for (const event of activity)
    if (!lastSeen.has(event.actorId)) lastSeen.set(event.actorId, event);
  const sorted = [...members]
    .filter((member) => member.personId !== workspace.person.id)
    .sort((a, b) =>
      (lastSeen.get(b.personId)?.at ?? '').localeCompare(lastSeen.get(a.personId)?.at ?? ''),
    );
  return (
    <Panel>
      <PanelHeader title="People" count={members.length} href={`${base}/people`} />
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
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {member.person.name}
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {member.status === 'invited'
                      ? 'Invited · hasn’t joined yet'
                      : last
                        ? `${last.verb === 'uploaded' ? 'added' : last.verb} ${last.object.label} · ${formatRelative(last.at, workspace.space.timezone)}`
                        : member.title}
                  </span>
                </span>
                <span className="text-[11.5px] text-faint">{roles[member.role].label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Fleet({ data }: { data: DashboardData }) {
  return (
    <Panel>
      <PanelHeader title="Vehicles" count={data.vehicles.length} href={`${data.base}/vehicles`} />
      <div className="pb-1.5">
        {data.vehicles.slice(0, 5).map((vehicle) => (
          <VehicleRow key={vehicle.id} vehicle={vehicle} base={data.base} people={data.people} />
        ))}
      </div>
    </Panel>
  );
}

function Plan({ data }: { data: DashboardData }) {
  const { workspace, members, base } = data;
  const plan = plans[workspace.space.plan];
  const custom = Object.values(workspace.space.customFields ?? {}).flat();
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 pt-4">
        <SpaceMark space={workspace.space} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">{workspace.space.name}</p>
          <p className="text-[12.5px] text-muted">{plan.name} plan · preview</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-px border-y border-line bg-line text-center">
        {[
          ['People', members.filter((member) => member.status === 'active').length],
          ['Tools on', workspace.space.modules.length],
          ['Custom fields', custom.length],
        ].map(([label, value]) => (
          <div key={label} className="bg-surface py-3">
            <dd className="text-[20px] font-semibold text-ink">{value}</dd>
            <dt className="text-[11.5px] text-muted">{label}</dt>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="text-[12px] leading-snug text-faint">Billing isn’t active in this preview.</p>
        <Link href={`${base}/settings`} className={buttonClass({ size: 'sm' })}>
          Settings
        </Link>
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
      <div className="grid gap-4 px-4 pt-1 pb-4 sm:grid-cols-[1fr_200px]">
        <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {qrCodes.slice(0, 4).map((code, index) => (
            <li key={code.id} className={index === 3 ? 'hidden sm:block' : undefined}>
              <Link href={`${base}/tools/qr?code=${code.id}`} className="group block">
                <span className="block rounded-[12px] bg-subtle p-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-transform group-hover:-translate-y-0.5">
                  <QrMini content={code.content} fg={code.fg} bg={code.bg} />
                </span>
                <span className="mt-1.5 block truncate text-[12.5px] font-medium text-ink">
                  {code.label}
                </span>
                <span className="block truncate text-[11.5px] text-muted">
                  {code.placement ?? 'Saved code'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {page ? (
          <Link
            href={`${base}/tools/links`}
            className="flex flex-col rounded-[16px] bg-[#2A120E] p-3 text-white shadow-card transition-transform hover:-translate-y-0.5"
          >
            <span className="label !text-white/55">Link page</span>
            <span className="mt-1 text-[14px] font-semibold">@{page.handle}</span>
            <span className="mt-2 grid gap-1">
              {page.links.slice(0, 3).map((link) => (
                <span
                  key={link.id}
                  className="truncate rounded-full bg-white/12 px-2.5 py-1 text-center text-[11.5px]"
                >
                  {link.label}
                </span>
              ))}
            </span>
            <span className="mt-2 text-[11px] text-white/50">{page.links.length} links</span>
          </Link>
        ) : null}
      </div>
    </Panel>
  );
}

/* ---------- personal ---------- */

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
            : file.folder,
      at: file.createdAt,
      href: `${base}/files?file=${file.id}`,
    })),
    ...data.qrCodes.map((code) => ({
      id: code.id,
      tool: 'qr',
      title: code.label,
      meta: 'QR code',
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
      href: `${base}/tools/receipts`,
    })),
    ...data.mileage.map((entry) => ({
      id: entry.id,
      tool: 'mileage',
      title: `${entry.to}`,
      meta: formatMiles(entry.miles),
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
                  <span className="text-[12px] text-faint">{formatRelative(item.at, tz)}</span>
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

function FavoriteTools({ data }: { data: DashboardData }) {
  const { workspace, base } = data;
  const ready = tools.filter(
    (tool) =>
      tool.kind !== 'module' &&
      tool.path &&
      availability(tool, workspace.space, workspace.membership).state === 'ready',
  );
  return (
    <Panel>
      <PanelHeader title="Your tools" href={`${base}/tools`} action="All tools" />
      <div className="grid grid-cols-2 gap-2 px-3 pt-1 pb-3 sm:grid-cols-3">
        {ready.map((tool) => (
          <Link
            key={tool.id}
            href={`${base}${tool.path}`}
            className="group relative overflow-hidden rounded-[16px] p-3.5 transition-transform hover:-translate-y-0.5"
            style={{ background: `color-mix(in oklab, ${tool.color} 26%, white)` }}
          >
            <ToolGlyph tool={tool} size="md" />
            <p className="mt-6 text-[14px] font-semibold text-ink">{tool.name}</p>
            <p className="truncate text-[12px] text-ink/60">{tool.tagline}</p>
            <Icon
              name="arrow-up-right"
              size={16}
              className="absolute top-3.5 right-3.5 text-ink/30 transition-colors group-hover:text-ink"
            />
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function PersonalMonth({ data }: { data: DashboardData }) {
  const { month } = data;
  return (
    <Panel>
      <PanelHeader title="This month" />
      <dl className="grid grid-cols-2 gap-px border-t border-line bg-line">
        {[
          [
            'Business miles',
            formatNumber(month.miles, month.miles % 1 ? 1 : 0),
            `${month.trips} trips`,
          ],
          ['Receipts', formatCurrency(month.spend, { cents: false }), `${month.receipts} saved`],
        ].map(([label, value, note]) => (
          <div
            key={label}
            className="bg-surface px-4 py-3.5 first:rounded-bl-[16px] last:rounded-br-[16px]"
          >
            <dt className="text-[12.5px] text-muted">{label}</dt>
            <dd className="mt-1 text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink">
              {value}
            </dd>
            <dd className="mt-1 text-[12px] text-faint">{note}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* ---------- members ---------- */

function currentProject(data: DashboardData) {
  const mine = data.projects.filter(
    (project) => project.status === 'active' && project.teamIds.includes(data.workspace.person.id),
  );
  const latest = data.activity.find(
    (event) => event.actorId === data.workspace.person.id && event.context?.type === 'project',
  );
  return mine.find((project) => project.id === latest?.context?.id) ?? mine[0];
}

function MyDay({ data }: { data: DashboardData }) {
  const { base, workspace } = data;
  const project = currentProject(data);
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
  const photos = data.files.filter(
    (file) => file.kind === 'image' && file.attachedTo.some((ref) => ref.id === project.id),
  );
  return (
    <Panel className="overflow-hidden">
      <div className="relative px-4 pt-4 pb-4 sm:px-5">
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: project.color }}
          aria-hidden="true"
        />
        <p className="label">Your project</p>
        <Link href={`${base}/projects/${project.id}`} className="mt-1.5 block">
          <h2 className="display text-[26px] text-ink hover:underline">{project.name}</h2>
        </Link>
        <p className="mt-1.5 flex items-center gap-1.5 text-[14px] text-muted">
          <Icon name="map-pin" size={15} /> {project.location}
        </p>
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
          <div>
            <dt className="text-[11.5px] text-muted">Photos</dt>
            <dd className="text-[13.5px] font-medium">{photos.length} so far</dd>
          </div>
        </dl>
        {photos.length > 0 && (
          <div className="mt-4 flex gap-2">
            {photos.slice(0, 4).map((file) => (
              <span
                key={file.id}
                className="h-16 flex-1 rounded-[10px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]"
                style={{ background: file.preview }}
                title={file.name}
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
          <dd className="text-[17px] font-semibold">{formatNumber(vehicle.odometer)} mi</dd>
        </div>
        <div className="bg-surface px-4 py-3">
          <dt className="text-[12px] text-muted">Service in</dt>
          <dd className="text-[17px] font-semibold">
            {toService !== null ? `${formatNumber(toService)} mi` : '—'}
          </dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="text-[12.5px] text-muted">
          Fuel card ••{vehicle.fuelCardLast4}
          {lastFuel && (
            <>
              {' '}
              · last fill {formatRelative(lastFuel.date, workspace.space.timezone).toLowerCase()}
            </>
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
  const items = [
    ...data.receipts.map((receipt) => ({
      at: receipt.createdAt,
      node: (
        <ReceiptRow
          key={receipt.id}
          receipt={receipt}
          people={data.people}
          timezone={tz}
          kind="business"
          showPerson={false}
        />
      ),
    })),
    ...data.mileage.map((entry) => ({
      at: entry.createdAt,
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
  ].sort((a, b) => b.at.localeCompare(a.at));
  const pending = [...data.receipts, ...data.mileage].filter(
    (item) => item.status === 'submitted',
  ).length;
  return (
    <Panel>
      <PanelHeader title="Your submissions" href={`${base}/tools/receipts`} action="All">
        {pending > 0 && (
          <span className="mr-auto -ml-1">
            <ApprovalBadge status="submitted" kind="business" />
          </span>
        )}
      </PanelHeader>
      {items.length ? (
        <div className="row-divide pb-1.5">{items.slice(0, 6).map((item) => item.node)}</div>
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
        />
      ) : (
        <p className="px-4 pb-4 text-[13.5px] text-muted">Nothing new for you.</p>
      )}
    </Panel>
  );
}

/* ---------- guests ---------- */

function SharedProjects({ data }: { data: DashboardData }) {
  const { projects, base, workspace, files } = data;
  const label = workspace.space.labels?.projects?.plural ?? 'Projects';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {projects.map((project) => {
        const count = files.filter((file) =>
          file.attachedTo.some((ref) => ref.id === project.id),
        ).length;
        const team = project.teamIds.map((id) => data.people.get(id)).filter(Boolean) as Person[];
        return (
          <Panel key={project.id} className="flex flex-col overflow-hidden">
            <div className="h-1.5" style={{ background: project.color }} />
            <div className="flex flex-1 flex-col p-4">
              <p className="label">Shared with you</p>
              <Link href={`${base}/projects/${project.id}`}>
                <h2 className="mt-1.5 text-[18px] font-semibold tracking-[-0.01em] hover:underline">
                  {project.name}
                </h2>
              </Link>
              <p className="mt-1 text-[13px] text-muted">{project.location}</p>
              <div className="mt-4 flex items-center justify-between">
                <AvatarStack people={team} size="sm" />
                <span className="text-[12.5px] text-muted">{count} files</span>
              </div>
              <div className="mt-4 flex gap-2">
                <CreateButton
                  request={{ id: 'file', attachTo: { type: 'project', id: project.id } }}
                  variant="primary"
                  size="sm"
                  icon="upload"
                >
                  Upload
                </CreateButton>
                <Link
                  href={`${base}/projects/${project.id}`}
                  className={buttonClass({ size: 'sm' })}
                >
                  Open
                </Link>
              </div>
            </div>
          </Panel>
        );
      })}
      {projects.length === 0 && (
        <Panel className="sm:col-span-2">
          <EmptyState icon="projects" title={`No ${label.toLowerCase()} shared yet`} />
        </Panel>
      )}
    </div>
  );
}

function SharedFiles({ data }: { data: DashboardData }) {
  const { files, base, workspace, projects } = data;
  const names = new Map(projects.map((project) => [project.id, project.name]));
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
            context={names.get(file.attachedTo.find((ref) => ref.type === 'project')?.id ?? '')}
          />
        ))}
      </div>
    </Panel>
  );
}
