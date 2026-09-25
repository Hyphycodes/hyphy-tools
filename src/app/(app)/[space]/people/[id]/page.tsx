import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Facts, fieldRows } from '@/components/fields/field-facts';
import { EditRecordFields } from '@/components/fields/record-fields';
import { ActivityList } from '@/components/records/activity-list';
import { ApproveAll, ReviewActions } from '@/components/records/review';
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
import { currentProjectFor, thisMonth } from '@/lib/insights';
import { describeCount, tripTitle } from '@/lib/platform/approvals';
import { viewsFor } from '@/lib/files/access';
import { openPage } from '@/lib/page';
import { CreateButton } from '@/components/create/create-button';
import { formFields } from '@/lib/platform/custom-fields';
import type { FieldType } from '@/lib/platform/types';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  formatCurrency,
  formatDate,
  formatMiles,
  formatNumber,
  plural,
} from '@/lib/platform/format';
import { canManageMember, grantableRoles, roles } from '@/lib/platform/roles';
import { MemberManage } from '@/components/team/member-manage';

export async function generateMetadata({ params }: PageProps<'/[space]/people/[id]'>) {
  const { repo } = await openPage(params);
  return { title: (await repo.member((await params).id))?.person.name ?? 'Person' };
}

export default async function PersonPage({ params }: PageProps<'/[space]/people/[id]'>) {
  const { workspace, repo, base, people, tz, directory, can } = await openPage(params, 'people');
  const { id } = await params;
  const member = await repo.member(id);
  if (!member) notFound();
  const [projects, vehicles, files, activity, receipts, mileage, fields] = await Promise.all([
    repo.projects(),
    repo.vehicles(),
    repo.files({ attachedTo: { type: 'person', id } }),
    repo.activity({ actorId: id, limit: 8 }),
    repo.receipts({ createdBy: id }),
    repo.mileage({ createdBy: id }),
    repo.fields('people'),
  ]);
  const fileViews = await viewsFor(workspace, files);
  const self = id === workspace.person.id;
  const working = projects.filter(
    (project) =>
      project.status !== 'done' &&
      (project.teamIds.includes(id) || member.projectIds?.includes(project.id)),
  );
  const vehicle = vehicles.find((item) => item.assignedTo === id);
  const current = currentProjectFor(id, projects, activity) ?? working[0];
  const seeMoney = can('expenses.view_all') || self;
  const lookup = (type: FieldType, value: string) =>
    type === 'person'
      ? people.get(value)?.name
      : type === 'project'
        ? projects.find((project) => project.id === value)?.name
        : type === 'vehicle'
          ? vehicles.find((item) => item.id === value)?.name
          : undefined;
  const details = fieldRows(fields, 'people', member.custom, lookup, tz);
  const editable =
    can('people.manage') && member.status !== 'removed'
      ? formFields(fields, 'people', workspace.space.modules)
      : [];
  // A manager's operational read on this person: what's waiting on them, and this month's totals.
  const approver = can('expenses.approve') && !self;
  const waitingReceipts = receipts.filter((item) => item.status === 'submitted');
  const waitingTrips = mileage.filter((item) => item.status === 'submitted');
  const waiting = waitingReceipts.length + waitingTrips.length;
  const returned = [...receipts, ...mileage].filter((item) => item.status === 'returned');
  const counted = (item: { status: string }) =>
    item.status === 'approved' || item.status === 'submitted';
  const monthReceipts = thisMonth(receipts, tz).filter(counted);
  const monthTrips = thisMonth(mileage, tz).filter(counted);
  const monthSpend = monthReceipts.reduce((sum, item) => sum + item.total, 0);
  const monthMiles = Math.round(monthTrips.reduce((sum, item) => sum + item.miles, 0) * 10) / 10;
  const role = roles[member.role];
  // Presentation only: the database decides again (set_member_role, transfer_ownership).
  const manageable =
    can('people.manage') && canManageMember(workspace.membership.role, member.role, self);
  const transferable = workspace.membership.role === 'owner' && !self && member.role !== 'guest';
  const refs = [
    ...waitingReceipts.map((item) => ({ kind: 'receipt' as const, id: item.id })),
    ...waitingTrips.map((item) => ({ kind: 'mileage' as const, id: item.id })),
  ];
  const place = (projectId?: string, vehicleId?: string, trip = false) =>
    [
      vehicles.find((vehicle) => vehicle.id === vehicleId)?.name ??
        (trip ? 'Personal vehicle' : undefined),
      projects.find((project) => project.id === projectId)?.name,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

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
            {[member.title, workspace.space.name].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-[13px] text-faint">{role.summary}</p>
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

      {workspace.space.kind === 'business' &&
        member.status === 'active' &&
        (manageable || transferable) && (
          <MemberManage
            slug={workspace.space.slug}
            spaceName={workspace.space.name}
            personId={member.personId}
            firstName={member.person.firstName}
            role={member.role}
            grantable={grantableRoles(workspace.membership.role)}
            canManage={manageable}
            canTransfer={transferable}
          />
        )}

      {/* An operational read, not an HR file: where they are, what they drive, what's moving. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel className="min-w-0 p-4">
          <p className="label mb-2">Current project</p>
          {current ? (
            <Link href={`${base}/projects/${current.id}`} className="group block min-w-0">
              <span className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: current.color }}
                  aria-hidden="true"
                />
                <span className="truncate text-[15px] font-semibold group-hover:underline">
                  {current.name}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                {current.location}
              </span>
            </Link>
          ) : (
            <p className="text-[14px] text-muted">None right now</p>
          )}
        </Panel>
        <Panel className="min-w-0 p-4">
          <p className="label mb-2">Assigned vehicle</p>
          {vehicle ? (
            <Link
              href={`${base}/vehicles/${vehicle.id}`}
              className="group flex min-w-0 items-center gap-2.5"
            >
              <VehicleSwatch vehicle={vehicle} />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold group-hover:underline">
                  {vehicle.name}
                </span>
                <span className="block truncate text-[12.5px] text-muted">
                  {formatNumber(vehicle.odometer)} mi
                </span>
              </span>
            </Link>
          ) : (
            <p className="text-[14px] text-muted">None · uses a personal vehicle</p>
          )}
        </Panel>
        {seeMoney && (
          <Panel className="min-w-0 p-4">
            <p className="label mb-2">This month</p>
            <p className="text-[20px] leading-none font-semibold tracking-[-0.02em]">
              {formatMiles(monthMiles)}
            </p>
            <p className="mt-1.5 truncate text-[12.5px] text-muted">
              {plural(monthTrips.length, 'trip')} · {formatCurrency(monthSpend, { cents: false })}{' '}
              in receipts
            </p>
          </Panel>
        )}
        {seeMoney && (
          <Panel className="min-w-0 p-4">
            <p className="label mb-2">{approver ? 'Waiting on you' : 'Waiting'}</p>
            <p
              className={cn(
                'text-[20px] leading-none font-semibold tracking-[-0.02em]',
                waiting > 0 && approver && 'text-signal-ink',
              )}
            >
              {waiting ? plural(waiting, 'item') : 'Nothing'}
            </p>
            <p className="mt-1.5 truncate text-[12.5px] text-muted">
              {returned.length
                ? `${returned.length} returned for a fix`
                : waitingReceipts.length
                  ? `${formatCurrency(waitingReceipts.reduce((sum, item) => sum + item.total, 0))} in receipts`
                  : 'All caught up'}
            </p>
          </Panel>
        )}
      </div>

      {approver && waiting > 0 && (
        <Panel
          className="mb-5 flex flex-wrap items-center gap-3 p-4"
          aria-label="Pending submissions"
        >
          <p className="min-w-0 flex-1 text-[14px]">
            <span className="font-semibold">
              {member.person.firstName} sent{' '}
              {describeCount([
                ...waitingReceipts.map(() => ({ kind: 'receipt' as const })),
                ...waitingTrips.map(() => ({ kind: 'mileage' as const })),
              ])}
            </span>{' '}
            <span className="text-muted">
              that {waiting === 1 ? 'needs' : 'need'} your decision.
            </span>
          </p>
          <Link
            href={`${base}/inbox?from=${id}`}
            className={buttonClass({ size: 'sm', variant: 'ghost' })}
          >
            View pending submissions
          </Link>
          {waiting > 1 && (
            <ApproveAll
              slug={workspace.space.slug}
              refs={refs}
              label={`Approve all ${waiting}`}
              summary={[
                waitingReceipts.length
                  ? formatCurrency(waitingReceipts.reduce((sum, item) => sum + item.total, 0))
                  : undefined,
                waitingTrips.length
                  ? formatMiles(
                      Math.round(waitingTrips.reduce((sum, item) => sum + item.miles, 0) * 10) / 10,
                    )
                  : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
              variant="primary"
            />
          )}
        </Panel>
      )}

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
              <PanelHeader title="Recent submissions" count={receipts.length + mileage.length}>
                <span className="mr-auto -ml-1 truncate text-[12.5px] text-muted">
                  {[
                    waiting ? `${waiting} waiting${approver ? ' on you' : ''}` : undefined,
                    returned.length ? `${returned.length} returned` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </PanelHeader>
              <div className="row-divide pb-1.5">
                {[
                  ...receipts.map((receipt) => ({
                    at: receipt.date,
                    waiting: receipt.status === 'submitted' || receipt.status === 'returned',
                    node: (
                      <ReceiptRow
                        key={receipt.id}
                        receipt={receipt}
                        people={people}
                        timezone={tz}
                        kind="business"
                        showPerson={false}
                        context={place(receipt.projectId, receipt.vehicleId)}
                        href={`${base}/tools/receipts?receipt=${receipt.id}`}
                        actions={
                          approver && receipt.status === 'submitted' ? (
                            <ReviewActions
                              slug={workspace.space.slug}
                              subject={{
                                kind: 'receipt',
                                id: receipt.id,
                                title: receipt.vendor,
                                amount: formatCurrency(receipt.total),
                              }}
                              from={member.person}
                            />
                          ) : undefined
                        }
                      />
                    ),
                  })),
                  ...mileage.map((entry) => ({
                    at: entry.date,
                    waiting: entry.status === 'submitted' || entry.status === 'returned',
                    node: (
                      <MileageRow
                        key={entry.id}
                        entry={entry}
                        people={people}
                        timezone={tz}
                        kind="business"
                        showPerson={false}
                        context={place(entry.projectId, entry.vehicleId, true)}
                        href={`${base}/tools/mileage?trip=${entry.id}`}
                        actions={
                          approver && entry.status === 'submitted' ? (
                            <ReviewActions
                              slug={workspace.space.slug}
                              subject={{
                                kind: 'mileage',
                                id: entry.id,
                                title: tripTitle(entry),
                                amount: formatMiles(entry.miles),
                              }}
                              from={member.person}
                            />
                          ) : undefined
                        }
                      />
                    ),
                  })),
                ]
                  // What's waiting on a decision comes first, then the newest.
                  .sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.at.localeCompare(a.at))
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
                    compact
                  />
                ))}
              </div>
            ) : (
              <p className="px-4 pb-4 text-[13px] text-muted">Not on any open projects.</p>
            )}
          </Panel>
          {can('files.view_all') && (
            <Panel>
              <PanelHeader title="Their documents" count={files.length}>
                {can('people.manage') && member.status === 'active' && (
                  <CreateButton
                    request={{ id: 'file', attachTo: { type: 'person', id: member.personId } }}
                    size="sm"
                    variant="ghost"
                    icon="upload"
                  >
                    Add
                  </CreateButton>
                )}
              </PanelHeader>
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
                      view={fileViews[file.id]}
                      compact
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
          {member.role !== 'guest' && (details.length > 0 || editable.length > 0) && (
            <Panel aria-label="Details">
              <PanelHeader title="Details">
                <EditRecordFields
                  type="people"
                  id={member.personId}
                  fields={editable}
                  values={member.custom}
                  title={member.person.name}
                />
              </PanelHeader>
              {details.length ? (
                <Facts rows={details} className="px-4 pb-2" />
              ) : (
                <p className="px-4 pb-4 text-[13px] text-muted">Nothing filled in yet.</p>
              )}
            </Panel>
          )}
        </aside>
      </div>
    </Page>
  );
}
