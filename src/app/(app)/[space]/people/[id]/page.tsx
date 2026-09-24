import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActivityList } from '@/components/records/activity-list';
import {
  FileRow,
  MileageRow,
  ProjectRow,
  ReceiptRow,
  VehicleSwatch,
} from '@/components/records/rows';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { formatField } from '@/lib/platform/custom-fields';
import { formatDate, formatNumber } from '@/lib/platform/format';
import { roles } from '@/lib/platform/roles';

export async function generateMetadata({ params }: PageProps<'/[space]/people/[id]'>) {
  const { repo } = await openPage(params);
  return { title: (await repo.member((await params).id))?.person.name ?? 'Person' };
}

export default async function PersonPage({ params }: PageProps<'/[space]/people/[id]'>) {
  const { workspace, repo, base, people, tz, directory, can } = await openPage(params, 'people');
  const { id } = await params;
  const member = await repo.member(id);
  if (!member) notFound();
  const [projects, vehicles, files, activity, receipts, mileage] = await Promise.all([
    repo.projects(),
    repo.vehicles(),
    repo.files({ attachedTo: { type: 'person', id } }),
    repo.activity({ actorId: id, limit: 8 }),
    repo.receipts({ createdBy: id }),
    repo.mileage({ createdBy: id }),
  ]);
  const self = id === workspace.person.id;
  const working = projects.filter(
    (project) =>
      project.status !== 'done' &&
      (project.teamIds.includes(id) || member.projectIds?.includes(project.id)),
  );
  const vehicle = vehicles.find((item) => item.assignedTo === id);
  const current = working.find((project) => project.status === 'active') ?? working[0];
  const seeMoney = can('expenses.view_all') || self;
  const fields = workspace.space.customFields?.people ?? [];
  const role = roles[member.role];

  return (
    <Page wide>
      <Link
        href={`${base}/people`}
        className="group mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <Icon
          name="arrow-left"
          size={15}
          className="transition-transform group-hover:-translate-x-0.5"
        />{' '}
        People
      </Link>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-center">
        <Avatar person={member.person} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge
              tone={
                member.role === 'guest' ? 'signal' : member.role === 'owner' ? 'ink' : 'neutral'
              }
            >
              {role.label}
            </Badge>
            {member.status === 'invited' && <Badge tone="outline">Invite sent</Badge>}
            <span className="text-[12.5px] text-faint">
              Joined {formatDate(member.joinedAt, tz, true)}
            </span>
          </div>
          <h1 className="display text-[32px] sm:text-[40px]">{member.person.name}</h1>
          <p className="text-[15px] text-muted">
            {member.title} · {workspace.space.name}
          </p>
        </div>
        {(can('people.manage') || self) && (
          <dl className="grid gap-1 text-[13px] sm:text-right">
            <dd className="flex items-center gap-1.5 sm:justify-end">
              <Icon name="message" size={14} className="text-muted" /> {member.person.email}
            </dd>
            {member.person.phone && <dd className="text-muted">{member.person.phone}</dd>}
          </dl>
        )}
      </header>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <p className="label mb-2">Role</p>
          <p className="text-[15px] font-semibold">{role.label}</p>
          <p className="mt-0.5 text-[13px] text-muted">{role.summary}</p>
        </Panel>
        <Panel className="p-4">
          <p className="label mb-2">Assigned vehicle</p>
          {vehicle ? (
            <Link href={`${base}/vehicles/${vehicle.id}`} className="flex items-center gap-3">
              <VehicleSwatch vehicle={vehicle} />
              <span>
                <span className="block text-[15px] font-semibold hover:underline">
                  {vehicle.name}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {formatNumber(vehicle.odometer)} mi
                </span>
              </span>
            </Link>
          ) : (
            <p className="text-[14px] text-muted">None</p>
          )}
        </Panel>
        <Panel className="p-4">
          <p className="label mb-2">Current project</p>
          {current ? (
            <Link href={`${base}/projects/${current.id}`} className="block">
              <span className="block text-[15px] font-semibold hover:underline">
                {current.name}
              </span>
              <span className="block truncate text-[12.5px] text-muted">{current.location}</span>
            </Link>
          ) : (
            <p className="text-[14px] text-muted">None</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-5">
          <Panel>
            <PanelHeader title="Recent activity" />
            {activity.length ? (
              <div className="pb-2">
                <ActivityList
                  compact
                  events={activity}
                  people={directory}
                  base={base}
                  viewerId={workspace.person.id}
                  timezone={tz}
                />
              </div>
            ) : (
              <EmptyState compact icon="activity" title="No activity yet" />
            )}
          </Panel>
          {seeMoney && (receipts.length > 0 || mileage.length > 0) && (
            <Panel>
              <PanelHeader title="Submissions" count={receipts.length + mileage.length} />
              <div className="row-divide pb-1.5">
                {[
                  ...receipts.map((receipt) => ({
                    at: receipt.date,
                    node: (
                      <ReceiptRow
                        key={receipt.id}
                        receipt={receipt}
                        people={people}
                        timezone={tz}
                        kind="business"
                        showPerson={false}
                      />
                    ),
                  })),
                  ...mileage.map((entry) => ({
                    at: entry.date,
                    node: (
                      <MileageRow
                        key={entry.id}
                        entry={entry}
                        people={people}
                        timezone={tz}
                        kind="business"
                        showPerson={false}
                      />
                    ),
                  })),
                ]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .slice(0, 8)
                  .map((item) => item.node)}
              </div>
            </Panel>
          )}
        </div>
        <aside className="grid content-start gap-5">
          <Panel>
            <PanelHeader title="Projects" count={working.length} />
            {working.length ? (
              <div className="pb-1.5">
                {working.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    base={base}
                    people={people}
                    timezone={tz}
                  />
                ))}
              </div>
            ) : (
              <p className="px-4 pb-4 text-[13px] text-muted">Not on any open projects.</p>
            )}
          </Panel>
          {can('files.view_all') && (
            <Panel>
              <PanelHeader title="Their documents" count={files.length} />
              {files.length ? (
                <div className="pb-1.5">
                  {files.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      base={base}
                      people={people}
                      timezone={tz}
                      context={file.folder}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-4 pb-4 text-[13px] text-muted">
                  Certificates, IDs and agreements attached to this person live here.
                </p>
              )}
            </Panel>
          )}
          {fields.length > 0 && member.role !== 'guest' && (
            <Panel>
              <PanelHeader title="Details">
                <span className="text-[11.5px] text-faint">Custom fields</span>
              </PanelHeader>
              <dl className="row-divide px-4 pb-2">
                {fields.map((field) => (
                  <div
                    key={field.id}
                    className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]"
                  >
                    <dt className="text-muted">{field.label}</dt>
                    <dd className="font-medium">
                      {formatField(field, member.custom?.[field.id] ?? null)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}
        </aside>
      </div>
    </Page>
  );
}
