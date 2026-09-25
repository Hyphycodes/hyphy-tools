import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreateButton } from '@/components/create/create-button';
import { Facts, fieldRows } from '@/components/fields/field-facts';
import { EditRecordFields } from '@/components/fields/record-fields';
import { ActivityList } from '@/components/records/activity-list';
import { PinButton } from '@/components/records/pin-button';
import { QrMini } from '@/components/records/qr-mini';
import { FilePicture } from '@/components/files/file-media';
import { FileRow, MileageRow, ReceiptRow, VehicleSwatch } from '@/components/records/rows';
import { viewsFor } from '@/lib/files/access';
import { ProjectStatusBadge } from '@/components/records/status';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Progress } from '@/components/ui/progress';
import { Tabs } from '@/components/ui/tabs';
import { projectMoney, vehiclesOn, type ProjectMoney } from '@/lib/insights';
import { openPage } from '@/lib/page';
import { formFields } from '@/lib/platform/custom-fields';
import {
  daysUntil,
  formatCurrency,
  formatDate,
  formatDateLong,
  formatMiles,
  formatRelative,
  formatRelativeInline,
  plural,
} from '@/lib/platform/format';
import { roles } from '@/lib/platform/roles';
import { isModuleReady } from '@/lib/platform/tools';
import type { FieldType } from '@/lib/platform/types';
import { keyDate, workProfile } from '@/lib/platform/work';

export async function generateMetadata({ params }: PageProps<'/[space]/projects/[id]'>) {
  const { repo } = await openPage(params);
  const project = await repo.project((await params).id);
  return { title: project?.name ?? 'Project' };
}

/**
 * A project is where the Space's work meets: receipts, trips, vehicles, files, photos and codes
 * made anywhere gather here because they carry this project's id. What it leads with follows the
 * Space's work style — a job's money and trucks, an event's day and its codes.
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

  const [
    receipts,
    mileage,
    files,
    activity,
    members,
    vehicles,
    allFiles,
    codes,
    pins,
    fields,
    projects,
  ] = await Promise.all([
    repo.receipts({ projectId: id }),
    repo.mileage({ projectId: id }),
    repo.files({ attachedTo: { type: 'project', id } }),
    repo.activity({ about: { type: 'project', id } }),
    repo.members(),
    repo.vehicles(),
    repo.files(),
    repo.qrCodes(),
    repo.pins(),
    repo.fields('projects'),
    repo.projects(),
  ]);
  const { space } = workspace;
  const profile = workProfile(space);
  const noun = profile.singular.toLowerCase();
  // Photos are image files people took or chose (a QR code image is a document here).
  const photos = files.filter((file) => file.kind === 'image' && file.source !== 'qr');
  const documents = files.filter((file) => !photos.includes(file));
  // Real previews for what this page shows, signed in one request.
  const fileViews = await viewsFor(
    workspace,
    tab === 'photos'
      ? photos
      : tab === 'files'
        ? documents
        : [...photos.slice(0, 3), ...documents.slice(0, 4)],
  );
  const projectCodes = codes.filter((code) => code.projectId === id);
  const team = members.filter((member) => project.teamIds.includes(member.personId));
  const guests = members.filter(
    (member) => member.role === 'guest' && member.projectIds?.includes(project.id),
  );
  const lead = people.get(project.leadId);
  const seesMoney = can('expenses.view_all');
  const submits = can('expenses.submit');
  const hasMileage = isModuleReady('mileage', space, workspace.membership);
  const hasQr = isModuleReady('qr', space, workspace.membership);
  const money = projectMoney(project, receipts, mileage, space.mileageRate);
  const onSite = profile.field ? vehiclesOn(id, vehicles, receipts, mileage) : [];
  const lookup = (type: FieldType, value: string) =>
    type === 'person'
      ? people.get(value)?.name
      : type === 'vehicle'
        ? vehicles.find((vehicle) => vehicle.id === value)?.name
        : type === 'project'
          ? projects.find((item) => item.id === value)?.name
          : type === 'file'
            ? allFiles.find((file) => file.id === value)?.name
            : undefined;
  // Hyphy's own facts and the business's, read the same way: "Customer · Harrison Family".
  const details: [string, string][] = [
    ...(project.client && profile.style !== 'events'
      ? ([[profile.client, project.client]] as [string, string][])
      : []),
    ...fieldRows(fields, 'projects', project.custom, lookup, tz),
  ];
  const editable = can('projects.manage') ? formFields(fields, 'projects', space.modules) : [];
  const tabHref = (name: string) =>
    `${base}/projects/${id}${name === 'overview' ? '' : `?tab=${name}`}`;
  const date = keyDate(project, profile);
  const pinned = pins.some((pin) => pin.type === 'project' && pin.id === id);
  const vehicleName = (vehicleId?: string) =>
    vehicles.find((vehicle) => vehicle.id === vehicleId)?.name;
  const costs = [
    ...receipts.map((receipt) => ({ at: receipt.date, receipt })),
    ...(hasMileage ? mileage.map((entry) => ({ at: entry.date, entry })) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const qrHref = `${base}/tools/qr?${new URLSearchParams({
    project: id,
    label:
      profile.style === 'events' ? `${project.name} — RSVP` : `${project.name} — job-site sign`,
    content: `https://hyphy.example/${space.slug}/projects/${id}`,
  })}`;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(seesMoney || submits
      ? [
          {
            id: 'costs',
            label: seesMoney ? (hasMileage ? 'Costs & trips' : 'Expenses') : 'Yours',
            count: costs.length,
          },
        ]
      : []),
    { id: 'files', label: 'Files', count: documents.length },
    { id: 'photos', label: 'Photos', count: photos.length },
    ...(hasQr && (profile.style === 'events' || projectCodes.length)
      ? [{ id: 'codes', label: 'QR codes', count: projectCodes.length }]
      : []),
    { id: 'team', label: 'Team', count: team.length },
    { id: 'activity', label: 'Activity' },
  ].map((item) => ({ ...item, href: tabHref(item.id) }));

  const costRows = (limit?: number) =>
    (limit ? costs.slice(0, limit) : costs).map((item) =>
      'receipt' in item ? (
        <ReceiptRow
          key={item.receipt.id}
          receipt={item.receipt}
          people={people}
          timezone={tz}
          kind={space.kind}
          context={vehicleName(item.receipt.vehicleId)}
          href={`${base}/tools/receipts?receipt=${item.receipt.id}`}
        />
      ) : (
        <MileageRow
          key={item.entry.id}
          entry={item.entry}
          people={people}
          timezone={tz}
          kind={space.kind}
          context={vehicleName(item.entry.vehicleId) ?? 'Personal vehicle'}
          href={`${base}/tools/mileage?trip=${item.entry.id}`}
        />
      ),
    );

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
        {profile.plural}
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
                  {profile.schedule === 'on'
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
          {/* What you'd do here, filed to this project without picking it again. */}
          <div className="flex flex-wrap items-center gap-2">
            <PinButton
              slug={space.slug}
              target={{ type: 'project', id }}
              pinned={pinned}
              label={project.name}
              variant="button"
            />
            <CreateButton
              request={{ id: 'receipt', attachTo: { type: 'project', id } }}
              icon="receipt"
              size="sm"
            >
              {profile.style === 'jobs' ? 'Upload receipt' : 'Add expense'}
            </CreateButton>
            {profile.field && (
              <CreateButton
                request={{ id: 'mileage', attachTo: { type: 'project', id } }}
                icon="route"
                size="sm"
              >
                Log mileage
              </CreateButton>
            )}
            {hasQr && (
              <Link href={qrHref} className={buttonClass({ size: 'sm' })}>
                <Icon name="qr" size={16} /> Create QR
              </Link>
            )}
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
              Upload file
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
              {profile.style === 'events' ? (
                <EventFacts
                  when={project.startDate}
                  tz={tz}
                  facts={[
                    ['Guests', project.custom?.guests ? String(project.custom.guests) : undefined],
                    [profile.location, project.location],
                    [profile.client, project.client],
                  ]}
                />
              ) : (
                profile.progress &&
                project.progress !== undefined && (
                  <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
                    <span className="text-[12.5px] text-muted">How far along</span>
                    <Progress
                      value={project.progress}
                      color={project.color}
                      className="flex-1"
                      label="Progress"
                    />
                    <span className="text-[13px] font-medium">{project.progress}%</span>
                  </div>
                )
              )}
            </Panel>

            {seesMoney && (money.value || money.tracked || money.allowance) ? (
              <MoneyPanel
                money={money}
                valueLabel={profile.value}
                client={project.client}
                noun={noun}
              />
            ) : null}

            {(seesMoney || submits) && (
              <Panel>
                <PanelHeader
                  title={
                    seesMoney ? (hasMileage ? 'Costs & trips' : 'Expenses') : 'Your submissions'
                  }
                  count={costs.length}
                  href={costs.length > 5 ? tabHref('costs') : undefined}
                  action="All"
                />
                {costs.length ? (
                  <div className="row-divide pb-1.5">{costRows(5)}</div>
                ) : (
                  <EmptyState compact icon="receipt" title="Nothing filed yet">
                    Receipts{hasMileage ? ' and trips' : ''} filed to this {noun} gather here.
                  </EmptyState>
                )}
              </Panel>
            )}

            {photos.length > 0 && (
              <Panel>
                <PanelHeader title="Latest photos" count={photos.length} href={tabHref('photos')} />
                <div className="grid grid-cols-3 gap-2 px-4 pb-4">
                  {photos.slice(0, 3).map((file) => (
                    <Link key={file.id} href={`${base}/files?file=${file.id}`} className="group">
                      <FilePicture
                        file={file}
                        view={fileViews[file.id]}
                        className="aspect-[4/3] w-full rounded-[12px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)] transition-transform group-hover:scale-[1.02]"
                      />
                      <span className="mt-1.5 block truncate text-[12px] text-muted">
                        {file.name}
                      </span>
                    </Link>
                  ))}
                </div>
              </Panel>
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
            <Panel>
              <PanelHeader title="Team" count={team.length} href={tabHref('team')} />
              <ul className="pb-2">
                {team.map((member) => (
                  <li key={member.id}>
                    <Link
                      href={can('people.view') ? `${base}/people/${member.personId}` : '#'}
                      className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-subtle"
                    >
                      <Avatar person={member.person} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {member.person.name}
                        </span>
                        <span className="block truncate text-[12px] text-muted">
                          {member.title}
                        </span>
                      </span>
                      {member.personId === project.leadId && <Badge tone="neutral">Lead</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>

            {onSite.length > 0 && (
              <Panel aria-label="Vehicles on this job">
                <PanelHeader title="Vehicles on this job" count={onSite.length} />
                <ul className="pb-2">
                  {onSite.map(({ vehicle, uses }) => {
                    const driver = vehicle.assignedTo ? people.get(vehicle.assignedTo) : undefined;
                    return (
                      <li key={vehicle.id}>
                        <Link
                          href={`${base}/vehicles/${vehicle.id}`}
                          className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-subtle"
                        >
                          <VehicleSwatch vehicle={vehicle} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-medium">
                              {vehicle.name}
                            </span>
                            <span className="block truncate text-[12px] text-muted">
                              {[
                                driver?.name ?? 'Shared',
                                uses
                                  ? `${plural(uses, 'trip or fill-up', 'trips and fill-ups')}`
                                  : 'Usually parked here',
                              ].join(' · ')}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}

            {projectCodes.length > 0 && tab === 'overview' && (
              <Panel>
                <PanelHeader title="QR codes" count={projectCodes.length} href={tabHref('codes')} />
                <CodesGrid codes={projectCodes.slice(0, 3)} base={base} />
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
                      view={fileViews[file.id]}
                      compact
                    />
                  ))}
                </div>
              ) : (
                <p className="px-4 pb-4 text-[13px] text-muted">
                  {profile.style === 'events'
                    ? 'Event orders, floor plans and menus attached here stay with the event.'
                    : 'Contracts, permits and plans attached here stay with the job.'}
                </p>
              )}
            </Panel>

            {(details.length > 0 || editable.length > 0) && (
              <Panel aria-label="Details">
                <PanelHeader title="Details">
                  <EditRecordFields
                    type="projects"
                    id={project.id}
                    fields={editable}
                    values={project.custom}
                    title={project.name}
                  />
                </PanelHeader>
                {details.length ? (
                  <Facts rows={details} className="px-4 pb-2" />
                ) : (
                  <p className="px-4 pb-4 text-[13px] text-muted">Nothing filled in yet.</p>
                )}
              </Panel>
            )}

            <Panel className="p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <Icon name="lock" size={15} className="text-muted" /> Who can access this?
              </p>
              <ul className="mt-2.5 grid gap-2 text-[13px] text-ink-2">
                <li>
                  The {noun} team:{' '}
                  {team
                    .filter((member) => member.role !== 'guest')
                    .map((member) => member.person.firstName)
                    .join(', ')}
                </li>
                <li>Owners, admins and managers of {space.name}</li>
                {guests.length > 0 && (
                  <li>
                    {guests.length === 1 ? 'Guest' : 'Guests'}:{' '}
                    {guests.map((guest) => `${guest.person.name} (${guest.title})`).join(', ')} —
                    only this {noun}, never money
                  </li>
                )}
              </ul>
            </Panel>
          </aside>
        </div>
      )}

      {tab === 'costs' && (
        <div className="grid gap-5">
          {seesMoney && (money.value || money.tracked || money.allowance) ? (
            <MoneyPanel
              money={money}
              valueLabel={profile.value}
              client={project.client}
              noun={noun}
            />
          ) : null}
          <Panel>
            <PanelHeader
              title={seesMoney ? `Filed to this ${noun}` : `Your submissions on this ${noun}`}
              count={costs.length}
            />
            {costs.length ? (
              <div className="row-divide pb-1.5">{costRows()}</div>
            ) : (
              <EmptyState
                compact
                icon="receipt"
                title="Nothing filed yet"
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
        </div>
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
                  view={fileViews[file.id]}
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
                  <FilePicture
                    file={file}
                    view={fileViews[file.id]}
                    iconSize={24}
                    className="aspect-[4/3] w-full rounded-[14px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)] transition-transform group-hover:scale-[1.02]"
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

      {tab === 'codes' && (
        <Panel>
          <PanelHeader title={`QR codes for this ${noun}`} count={projectCodes.length}>
            <Link href={qrHref} className={cn(buttonClass({ size: 'sm' }), 'ml-auto')}>
              <Icon name="plus" size={15} /> New code
            </Link>
          </PanelHeader>
          {projectCodes.length ? (
            <CodesGrid codes={projectCodes} base={base} wide />
          ) : (
            <p className="px-4 pb-4 text-[13.5px] text-muted">
              Make a code for the RSVP card or the table tent; it’s saved here, with the {noun}.
            </p>
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

/**
 * Money on a project, each figure named for what it is: what the customer pays, what's been
 * tracked here, and — only if the business set one — the allowance those costs are measured
 * against. Never a small "budget" beside a large contract with nothing to say which is which.
 */
function MoneyPanel({
  money,
  valueLabel,
  client,
  noun,
}: {
  money: ProjectMoney;
  valueLabel: string | null;
  client?: string;
  noun: string;
}) {
  const left = money.allowance ? money.allowance - money.tracked : 0;
  const used = money.allowance ? Math.min(100, (money.tracked / money.allowance) * 100) : 0;
  const waiting = money.allowance ? Math.min(used, (money.pending / money.allowance) * 100) : 0;
  const figures: { label: string; value: string; note: string; tone?: 'critical' }[] = [
    ...(money.value && valueLabel
      ? [
          {
            label: valueLabel,
            value: formatCurrency(money.value, { cents: false }),
            note: client
              ? `${valueLabel === 'Booking' ? 'Booked by' : 'Signed with'} ${client}`
              : 'What the customer pays',
          },
        ]
      : []),
    {
      label: 'Tracked costs',
      value: formatCurrency(money.tracked),
      note: money.lines.length
        ? money.lines
            .slice(0, 3)
            .map((line) => line.label.toLowerCase())
            .join(', ')
        : 'Nothing recorded yet',
    },
    ...(money.allowance
      ? [
          {
            label: 'Cost allowance',
            value: formatCurrency(money.allowance, { cents: false }),
            note:
              left >= 0
                ? `${formatCurrency(left, { cents: false })} left`
                : `${formatCurrency(-left, { cents: false })} over`,
            tone: left < 0 ? ('critical' as const) : undefined,
          },
        ]
      : []),
  ];
  return (
    <Panel aria-label="Money">
      <PanelHeader title="Money" />
      <dl
        className={cn(
          'grid gap-px bg-line',
          figures.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        {figures.map((figure) => (
          <div key={figure.label} className="bg-surface px-4 py-3">
            <dt className="text-[12.5px] text-muted">{figure.label}</dt>
            <dd className="num mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-ink">
              {figure.value}
            </dd>
            <dd
              className={cn(
                'truncate text-[12px] first-letter:uppercase',
                figure.tone ? 'text-critical' : 'text-faint',
              )}
            >
              {figure.note}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-3 border-t border-line px-4 pt-3 pb-4">
        {money.allowance ? (
          <div>
            <div
              className="relative h-2 overflow-hidden rounded-full bg-well"
              role="meter"
              aria-label="Tracked costs against the cost allowance"
              aria-valuenow={Math.round(used)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  left < 0 ? 'bg-critical' : 'bg-ink',
                )}
                style={{ width: `${used}%` }}
              />
              {waiting > 0 && (
                <span
                  className="absolute inset-y-0 rounded-r-full bg-signal/70"
                  style={{ left: `${used - waiting}%`, width: `${waiting}%` }}
                />
              )}
            </div>
            <p className="mt-1.5 text-[12px] text-muted">
              {Math.round(used)}% of the allowance
              {money.pending > 0 && (
                <>
                  {' · '}
                  <span className="text-signal-ink">
                    {formatCurrency(money.pending)} still waiting for approval
                  </span>
                </>
              )}
            </p>
          </div>
        ) : (
          money.pending > 0 && (
            <p className="text-[12px] text-signal-ink">
              {formatCurrency(money.pending)} of it is still waiting for approval
            </p>
          )
        )}
        {money.lines.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            {money.lines.map((line) => (
              <li key={line.label} className="text-muted">
                {line.label}{' '}
                <span className="num font-medium text-ink">{formatCurrency(line.total)}</span>
                {line.label === 'Mileage paid back' && money.rate
                  ? ` (${formatMiles(money.reimbursedMiles)} × ${formatCurrency(money.rate)})`
                  : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] leading-snug text-faint">
          Tracked costs are what the team recorded in Hyphy — fuel, purchases and personal-vehicle
          miles. Labor and subcontracts aren’t here, so this isn’t the {noun}’s full cost.
        </p>
      </div>
    </Panel>
  );
}

function EventFacts({
  when,
  tz,
  facts,
}: {
  when: string;
  tz: string;
  facts: [string, string | undefined][];
}) {
  const days = daysUntil(when);
  return (
    <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
      <div>
        <dt className="text-[12.5px] text-muted">When</dt>
        <dd className="mt-0.5 text-[15px] font-semibold text-ink">{formatDateLong(when, tz)}</dd>
        <dd className="text-[12px] text-faint">
          {days > 0 ? `in ${days} days` : days === 0 ? 'today' : formatRelativeInline(when, tz)}
        </dd>
      </div>
      {facts
        .filter((fact): fact is [string, string] => Boolean(fact[1]))
        .map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[12.5px] text-muted">{label}</dt>
            <dd className="mt-0.5 truncate text-[15px] font-semibold text-ink">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function CodesGrid({
  codes,
  base,
  wide = false,
}: {
  codes: {
    id: string;
    label: string;
    content: string;
    fg: string;
    bg: string;
    placement?: string;
  }[];
  base: string;
  wide?: boolean;
}) {
  return (
    <ul
      className={cn('grid grid-cols-3 gap-2.5 px-4 pb-4', wide && 'sm:grid-cols-4 lg:grid-cols-6')}
    >
      {codes.map((code) => (
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
  );
}
