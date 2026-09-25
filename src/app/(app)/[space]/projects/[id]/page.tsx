import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreateButton } from '@/components/create/create-button';
import { ActivityList } from '@/components/records/activity-list';
import { FileRow, MileageRow, ReceiptRow } from '@/components/records/rows';
import { ProjectStatusBadge } from '@/components/records/status';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Progress } from '@/components/ui/progress';
import { Tabs } from '@/components/ui/tabs';
import { openPage } from '@/lib/page';
import { formatField } from '@/lib/platform/custom-fields';
import {
  daysUntil,
  formatCurrency,
  formatDate,
  formatMiles,
  formatRelative,
  formatRelativeInline,
  plural,
} from '@/lib/platform/format';
import { roles } from '@/lib/platform/roles';
import type { FieldType } from '@/lib/platform/types';

export async function generateMetadata({ params }: PageProps<'/[space]/projects/[id]'>) {
  const { repo } = await openPage(params);
  const project = await repo.project((await params).id);
  return { title: project?.name ?? 'Project' };
}

/**
 * A project is where tools meet business data: receipts, trips, files and photos submitted
 * anywhere in the Space gather here because they carry this project's id.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: PageProps<'/[space]/projects/[id]'>) {
  const { workspace, repo, base, people, tz, can, directory } = await openPage(params, 'projects');
  const { id } = await params;
  const tab = String((await searchParams).tab ?? 'overview');
  const project = await repo.project(id);
  if (!project) notFound();

  const [receipts, mileage, files, activity, members, vehicles, allFiles] = await Promise.all([
    repo.receipts({ projectId: id }),
    repo.mileage({ projectId: id }),
    repo.files({ attachedTo: { type: 'project', id } }),
    repo.activity({ about: { type: 'project', id } }),
    repo.members(),
    repo.vehicles(),
    repo.files(),
  ]);
  const photos = files.filter((file) => file.kind === 'image');
  const documents = files.filter((file) => file.kind !== 'image');
  const counted = receipts.filter(
    (receipt) => receipt.status === 'approved' || receipt.status === 'submitted',
  );
  const spent = counted.reduce((sum, receipt) => sum + receipt.total, 0);
  const miles = mileage
    .filter((entry) => entry.status !== 'rejected')
    .reduce((sum, entry) => sum + entry.miles, 0);
  const team = members.filter((member) => project.teamIds.includes(member.personId));
  const guests = members.filter(
    (member) => member.role === 'guest' && member.projectIds?.includes(project.id),
  );
  const lead = people.get(project.leadId);
  const labels = workspace.space.labels?.projects ?? { singular: 'Project', plural: 'Projects' };
  const money = can('expenses.submit') || can('expenses.view_all');
  const fields = workspace.space.customFields?.projects ?? [];
  const lookup = (type: FieldType, value: string) =>
    type === 'person'
      ? people.get(value)?.name
      : type === 'vehicle'
        ? vehicles.find((vehicle) => vehicle.id === value)?.name
        : type === 'file'
          ? allFiles.find((file) => file.id === value)?.name
          : undefined;
  const tabHref = (name: string) =>
    `${base}/projects/${id}${name === 'overview' ? '' : `?tab=${name}`}`;
  const date = labels.singular === 'Event' ? project.startDate : project.dueDate;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(money
      ? [
          {
            id: 'expenses',
            label: can('expenses.view_all') ? 'Expenses' : 'Your expenses',
            count: receipts.length,
          },
        ]
      : []),
    ...(money && workspace.space.modules.includes('mileage')
      ? [{ id: 'mileage', label: 'Mileage', count: mileage.length }]
      : []),
    { id: 'files', label: 'Files', count: documents.length },
    { id: 'photos', label: 'Photos', count: photos.length },
    { id: 'activity', label: 'Activity' },
    { id: 'team', label: 'Team', count: team.length },
  ].map((item) => ({ ...item, href: tabHref(item.id) }));

  return (
    <Page wide>
      <Link
        href={`${base}/projects`}
        className="group mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <Icon
          name="arrow-left"
          size={15}
          className="transition-transform group-hover:-translate-x-0.5"
        />
        {labels.plural}
      </Link>

      <header
        className="relative mb-2 overflow-hidden rounded-[22px] p-5 sm:p-7"
        style={{ background: `color-mix(in oklab, ${project.color} 16%, white)` }}
      >
        <div
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ background: project.color }}
          aria-hidden="true"
        />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <ProjectStatusBadge status={project.status} />
              {date && project.status !== 'done' && (
                <Badge tone="outline">
                  <Icon name="calendar" size={12} />
                  {labels.singular === 'Event'
                    ? formatDate(date, tz)
                    : `Due ${formatDate(date, tz)}`}{' '}
                  ·{' '}
                  {daysUntil(date) >= 0
                    ? `in ${daysUntil(date)} days`
                    : `${-daysUntil(date)} days late`}
                </Badge>
              )}
              {workspace.membership.role === 'guest' && (
                <Badge tone="signal">Shared with you</Badge>
              )}
            </div>
            <h1 className="display text-[32px] text-ink sm:text-[42px]">{project.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-2">
              {project.location && (
                <span className="flex items-center gap-1.5">
                  <Icon name="map-pin" size={15} className="text-muted" /> {project.location}
                </span>
              )}
              {project.client && <span className="text-muted">{project.client}</span>}
              {lead && (
                <span className="flex items-center gap-1.5">
                  <Avatar person={lead} size="xs" /> Led by {lead.firstName}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CreateButton
              request={{ id: 'receipt', attachTo: { type: 'project', id } }}
              icon="receipt"
              size="sm"
            >
              Add expense
            </CreateButton>
            <CreateButton
              request={{ id: 'mileage', attachTo: { type: 'project', id } }}
              icon="route"
              size="sm"
            >
              Log trip
            </CreateButton>
            <CreateButton
              request={{ id: 'photos', attachTo: { type: 'project', id } }}
              icon="camera"
              size="sm"
            >
              Photos
            </CreateButton>
            <CreateButton
              request={{ id: 'file', attachTo: { type: 'project', id } }}
              icon="upload"
              size="sm"
              variant="primary"
            >
              Upload
            </CreateButton>
          </div>
        </div>
      </header>

      <Tabs items={tabs} active={tab} className="mb-5" />

      {tab === 'overview' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 content-start gap-5">
            <Panel className="p-5">
              <p className="text-[15.5px] leading-relaxed text-ink-2">
                {project.summary || 'No summary yet.'}
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
                {[
                  ...(can('expenses.view_all')
                    ? [
                        [
                          'Expenses',
                          formatCurrency(spent, { cents: false }),
                          project.budget
                            ? `of ${formatCurrency(project.budget, { cents: false })} budgeted`
                            : plural(counted.length, 'receipt'),
                        ],
                      ]
                    : []),
                  ...(money
                    ? [
                        [
                          'Miles',
                          formatMiles(Math.round(miles * 10) / 10),
                          plural(mileage.length, 'trip'),
                        ],
                      ]
                    : []),
                  ['Files', String(documents.length), 'documents'],
                  [
                    'Photos',
                    String(photos.length),
                    photos[0]
                      ? `latest ${formatRelativeInline(photos[0].createdAt, tz)}`
                      : 'none yet',
                  ],
                ].map(([label, value, note]) => (
                  <div key={label}>
                    <dt className="text-[12.5px] text-muted">{label}</dt>
                    <dd className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-ink">
                      {value}
                    </dd>
                    <dd className="text-[12px] text-faint">{note}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 flex items-center gap-3">
                <span className="w-16 text-[12.5px] text-muted">Progress</span>
                <Progress
                  value={project.progress}
                  color={project.color}
                  className="flex-1"
                  label="Progress"
                />
                <span className="text-[13px] font-medium">{project.progress}%</span>
              </div>
              {can('expenses.view_all') && project.budget ? (
                <div className="mt-2.5 flex items-center gap-3">
                  <span className="w-16 text-[12.5px] text-muted">Budget</span>
                  <Progress
                    value={(spent / project.budget) * 100}
                    color={spent > project.budget ? 'var(--color-critical)' : 'var(--color-ink)'}
                    className="flex-1"
                    label="Expense budget used"
                  />
                  <span className="text-[13px] font-medium">
                    {spent > 0 && spent / project.budget < 0.01
                      ? '<1'
                      : Math.round((spent / project.budget) * 100)}
                    %
                  </span>
                </div>
              ) : null}
            </Panel>

            {photos.length > 0 && (
              <Panel>
                <PanelHeader title="Latest photos" count={photos.length} href={tabHref('photos')} />
                <div className="grid grid-cols-3 gap-2 px-4 pb-4">
                  {photos.slice(0, 3).map((file) => (
                    <Link key={file.id} href={`${base}/files?file=${file.id}`} className="group">
                      <span
                        className="block aspect-[4/3] rounded-[12px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)] transition-transform group-hover:scale-[1.02]"
                        style={{ background: file.preview }}
                      />
                      <span className="mt-1.5 block truncate text-[12px] text-muted">
                        {file.name}
                      </span>
                    </Link>
                  ))}
                </div>
              </Panel>
            )}

            {(money || documents.length > 0) && (
              <div className="grid gap-5 lg:grid-cols-2">
                {money && (
                  <Panel>
                    <PanelHeader
                      title="Costs"
                      href={tabHref('expenses')}
                      action={can('expenses.view_all') ? 'Expenses' : 'Yours'}
                    >
                      {receipts.length + mileage.length > 0 && (
                        <span className="mr-auto -ml-1 text-[12.5px] text-muted">
                          {[
                            receipts.length ? formatCurrency(spent) : undefined,
                            mileage.length ? formatMiles(Math.round(miles * 10) / 10) : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </PanelHeader>
                    {receipts.length + mileage.length > 0 ? (
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
                                kind={workspace.space.kind}
                                href={`${base}/tools/receipts?receipt=${receipt.id}`}
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
                                kind={workspace.space.kind}
                              />
                            ),
                          })),
                        ]
                          .sort((a, b) => b.at.localeCompare(a.at))
                          .slice(0, 4)
                          .map((item) => item.node)}
                      </div>
                    ) : (
                      <EmptyState compact icon="receipt" title="No costs yet">
                        Receipts and trips filed to this {labels.singular.toLowerCase()} add up
                        here.
                      </EmptyState>
                    )}
                  </Panel>
                )}
                <Panel>
                  <PanelHeader title="Documents" count={documents.length} href={tabHref('files')} />
                  {documents.length ? (
                    <div className="pb-1.5">
                      {documents.slice(0, 4).map((file) => (
                        <FileRow
                          key={file.id}
                          file={file}
                          base={base}
                          people={people}
                          timezone={tz}
                          context={file.folder}
                          compact
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState compact icon="files" title="No documents yet">
                      Contracts, permits and plans attached here stay with the job.
                    </EmptyState>
                  )}
                </Panel>
              </div>
            )}

            <Panel>
              <PanelHeader
                title="Recent activity"
                href={tabHref('activity')}
                action="All activity"
              />
              {activity.length ? (
                <div className="pb-2">
                  <ActivityList
                    events={activity.slice(0, 6)}
                    people={directory}
                    base={base}
                    viewerId={workspace.person.id}
                    timezone={tz}
                    compact
                  />
                </div>
              ) : (
                <EmptyState compact icon="activity" title="Nothing yet" />
              )}
            </Panel>
          </div>

          <aside className="grid content-start gap-5">
            {fields.length > 0 && (
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
                      <dd className="text-right font-medium text-ink">
                        {formatField(field, project.custom?.[field.id], lookup, tz)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            )}
            <Panel>
              <PanelHeader title="Team" count={team.length} href={tabHref('team')} />
              <ul className="pb-2">
                {team.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 px-4 py-2">
                    <Avatar person={member.person} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">
                        {member.person.name}
                      </span>
                      <span className="block truncate text-[12px] text-muted">{member.title}</span>
                    </span>
                    {member.personId === project.leadId && <Badge tone="neutral">Lead</Badge>}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel className="p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <Icon name="lock" size={15} className="text-muted" /> Who can access this?
              </p>
              <ul className="mt-2.5 grid gap-2 text-[13px] text-ink-2">
                <li>
                  The {labels.singular.toLowerCase()} team:{' '}
                  {team
                    .filter((member) => member.role !== 'guest')
                    .map((member) => member.person.firstName)
                    .join(', ')}
                </li>
                <li>Owners, admins and managers of {workspace.space.name}</li>
                {guests.length > 0 && (
                  <li>
                    {guests.length === 1 ? 'Guest' : 'Guests'}:{' '}
                    {guests.map((guest) => `${guest.person.name} (${guest.title})`).join(', ')} —
                    only this {labels.singular.toLowerCase()}, never money
                  </li>
                )}
              </ul>
            </Panel>
          </aside>
        </div>
      )}

      {tab === 'expenses' && (
        <Panel>
          <PanelHeader
            title={
              can('expenses.view_all')
                ? 'Receipts on this project'
                : 'Your receipts on this project'
            }
            count={receipts.length}
          >
            {receipts.length > 0 && (
              <span className="ml-auto text-[13px] font-medium">{formatCurrency(spent)}</span>
            )}
          </PanelHeader>
          {receipts.length ? (
            <div className="row-divide pb-1.5">
              {receipts.map((receipt) => (
                <ReceiptRow
                  key={receipt.id}
                  receipt={receipt}
                  people={people}
                  timezone={tz}
                  kind={workspace.space.kind}
                  href={`${base}/tools/receipts?receipt=${receipt.id}`}
                  context={
                    receipt.vehicleId
                      ? vehicles.find((vehicle) => vehicle.id === receipt.vehicleId)?.name
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon="receipt"
              title="No receipts yet"
              action={
                <CreateButton
                  request={{ id: 'receipt', attachTo: { type: 'project', id } }}
                  variant="primary"
                >
                  Add a receipt
                </CreateButton>
              }
            />
          )}
        </Panel>
      )}

      {tab === 'mileage' && (
        <Panel>
          <PanelHeader title="Trips for this project" count={mileage.length}>
            {mileage.length > 0 && (
              <span className="ml-auto text-[13px] font-medium">
                {formatMiles(Math.round(miles * 10) / 10)}
              </span>
            )}
          </PanelHeader>
          {mileage.length ? (
            <div className="row-divide pb-1.5">
              {mileage.map((entry) => (
                <MileageRow
                  key={entry.id}
                  entry={entry}
                  people={people}
                  timezone={tz}
                  kind={workspace.space.kind}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon="route"
              title="No trips yet"
              action={
                <CreateButton
                  request={{ id: 'mileage', attachTo: { type: 'project', id } }}
                  variant="primary"
                >
                  Log a trip
                </CreateButton>
              }
            />
          )}
        </Panel>
      )}

      {tab === 'files' && (
        <Panel>
          <PanelHeader title="Files" count={documents.length} />
          {documents.length ? (
            <div className="pb-1.5">
              {documents.map((file) => (
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
            <EmptyState
              compact
              icon="files"
              title="No files yet"
              action={
                <CreateButton
                  request={{ id: 'file', attachTo: { type: 'project', id } }}
                  variant="primary"
                >
                  Upload files
                </CreateButton>
              }
            />
          )}
        </Panel>
      )}

      {tab === 'photos' && (
        <Panel className="p-4">
          {photos.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((file) => (
                <Link key={file.id} href={`${base}/files?file=${file.id}`} className="group">
                  <span
                    className="block aspect-[4/3] rounded-[14px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)] transition-transform group-hover:scale-[1.02]"
                    style={{ background: file.preview }}
                  />
                  <span className="mt-2 block truncate text-[13px] font-medium">{file.name}</span>
                  <span className="block text-[12px] text-muted">
                    {people.get(file.createdBy)?.firstName} · {formatRelative(file.createdAt, tz)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon="camera"
              title="No photos yet"
              action={
                <CreateButton
                  request={{ id: 'photos', attachTo: { type: 'project', id } }}
                  variant="primary"
                >
                  Add photos
                </CreateButton>
              }
            />
          )}
        </Panel>
      )}

      {tab === 'activity' && (
        <Panel className="pb-2">
          {activity.length ? (
            <ActivityList
              grouped
              events={activity}
              people={directory}
              base={base}
              viewerId={workspace.person.id}
              timezone={tz}
            />
          ) : (
            <EmptyState compact icon="activity" title="Nothing yet" />
          )}
        </Panel>
      )}

      {tab === 'team' && (
        <Panel>
          <ul className="row-divide">
            {[...team, ...guests.filter((guest) => !team.includes(guest))].map((member) => (
              <li key={member.id}>
                <Link
                  href={can('people.view') ? `${base}/people/${member.personId}` : '#'}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-subtle"
                >
                  <Avatar person={member.person} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">
                      {member.person.name}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">{member.title}</span>
                  </span>
                  <Badge tone={member.role === 'guest' ? 'signal' : 'neutral'}>
                    {roles[member.role].label}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Page>
  );
}
