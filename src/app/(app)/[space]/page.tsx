import { QuickActions } from '@/components/create/create-button';
import { Widget, type DashboardData } from '@/components/dashboard/widgets';
import { Page } from '@/components/ui/page';
import { getRepository } from '@/lib/data';
import { requireWorkspace } from '@/lib/identity';
import { currentProjectFor, monthSummary, spendBy } from '@/lib/insights';
import { dashboardFor } from '@/lib/platform/dashboard';
import {
  daysUntil,
  formatCurrency,
  formatDateLong,
  formatMiles,
  formatNumber,
  greeting,
  plural,
} from '@/lib/platform/format';

export const metadata = { title: 'Home' };

/** Home: the same widgets for everyone, composed for this person's role in this Space. */
export default async function Home({ params }: PageProps<'/[space]'>) {
  const workspace = await requireWorkspace((await params).space);
  const repo = getRepository(workspace);
  const { space, person, membership } = workspace;
  const [
    members,
    directory,
    inbox,
    activity,
    projects,
    vehicles,
    receipts,
    mileage,
    files,
    qrCodes,
    linkPages,
  ] = await Promise.all([
    repo.members(),
    repo.directory(),
    repo.inbox(),
    repo.activity({ limit: 40 }),
    repo.projects(),
    repo.vehicles(),
    repo.receipts(),
    repo.mileage(),
    repo.files(),
    repo.qrCodes(),
    repo.linkPages(),
  ]);
  const data: DashboardData = {
    workspace,
    base: `/${space.slug}`,
    people: new Map(directory.map((item) => [item.id, item])),
    directory,
    members,
    inbox,
    activity,
    projects,
    vehicles,
    receipts,
    mileage,
    files,
    qrCodes,
    linkPages,
    month: monthSummary({ receipts, mileage, files }, space.timezone),
    projectSpend: spendBy(receipts, 'projectId'),
  };
  const layout = dashboardFor(space, membership);
  const can = (permission: (typeof workspace.permissions)[number]) =>
    workspace.permissions.includes(permission);
  const urgent = inbox.find((item) => item.priority === 'high');

  // A few plain sentences about today, written for this person. Specific beats clever.
  const briefing = (() => {
    if (layout.hero === 'personal') {
      const month =
        receipts.length || mileage.length
          ? `${formatMiles(data.month.miles)} and ${formatCurrency(data.month.spend, { cents: false })} in receipts this month.`
          : 'Your own tools, and everything you make with them, in one place.';
      const next = urgent ?? inbox[0];
      return [month, next ? `${next.title}.` : undefined].filter(Boolean).join(' ');
    }
    if (layout.hero === 'operator') {
      const waiting = [...receipts, ...mileage].filter((item) => item.status === 'submitted');
      const first = can('expenses.approve')
        ? waiting.length
          ? `${plural(waiting.length, 'submission')} ${waiting.length === 1 ? 'is' : 'are'} waiting for your approval.`
          : inbox.length
            ? `Approvals are done. ${plural(inbox.length, 'other thing')} could use a look.`
            : 'Nothing is waiting on you.'
        : inbox.length
          ? `${plural(inbox.length, 'thing')} could use a look.`
          : 'Nothing is waiting on you.';
      const second = urgent
        ? `${urgent.title}${urgent.subject.type === 'vehicle' || urgent.subject.type === 'project' ? ` — ${urgent.subject.label}` : ''}.`
        : undefined;
      return [first, second].filter(Boolean).join(' ');
    }
    if (layout.hero === 'member') {
      const truck = vehicles.find((vehicle) => vehicle.assignedTo === person.id);
      const project = currentProjectFor(person.id, projects, activity);
      const service = truck?.nextServiceMiles ? truck.nextServiceMiles - truck.odometer : null;
      const pending = [...receipts, ...mileage].filter(
        (item) => item.status === 'submitted',
      ).length;
      const returned = [...receipts, ...mileage].filter(
        (item) => item.status === 'rejected',
      ).length;
      return [
        project ? `You’re on ${project.name}.` : undefined,
        returned
          ? `${plural(returned, 'submission')} came back — take a look.`
          : pending
            ? `${plural(pending, 'submission')} waiting for approval.`
            : undefined,
        truck && service !== null && service < 2500
          ? `${truck.name} is due for service in ${formatNumber(service)} miles.`
          : undefined,
      ]
        .filter(Boolean)
        .join(' ');
    }
    const next = projects
      .map((project) => project.custom?.next_inspection as string | undefined)
      .filter(Boolean)
      .sort()[0];
    return `${plural(projects.length, space.labels?.projects?.singular.toLowerCase() ?? 'project')} shared with you by ${space.name}.${
      next ? ` Next inspection in ${daysUntil(next)} days.` : ''
    }`;
  })();

  return (
    <Page wide>
      <header className="mb-6 flex flex-col gap-5 lg:mb-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="label mb-3 flex items-center gap-2">
            <span>{formatDateLong(new Date().toISOString(), space.timezone)}</span>
            <span className="text-faint">/</span>
            <span className="truncate">{space.kind === 'personal' ? 'Personal' : space.name}</span>
          </p>
          <h1 className="display text-[34px] text-ink sm:text-[42px] lg:text-[48px]">
            {layout.hero === 'personal' ? 'Welcome back' : greeting(space.timezone)},{' '}
            {person.firstName}.
          </h1>
          <p className="mt-2.5 max-w-[64ch] text-[15.5px] leading-relaxed text-ink-2/80 lg:text-[15px]">
            {briefing}
          </p>
        </div>
        {layout.hero === 'operator' && (
          <div className="hidden shrink-0 lg:block">
            <QuickActions count={3} variant="inline" />
          </div>
        )}
      </header>

      {(layout.hero === 'member' || layout.hero === 'guest') && (
        <section
          aria-label={layout.bigActions ? 'Your actions' : 'Quick actions'}
          className="mb-6 lg:mb-8"
        >
          <QuickActions big={layout.bigActions} count={4} />
        </section>
      )}

      {layout.top.length > 0 && (
        <div className="mb-5 grid gap-4 lg:mb-6 lg:gap-5">
          {layout.top.map((id) => (
            <Widget key={id} id={id} data={data} />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 content-start gap-4 lg:gap-5">
          {layout.main.map((id) => (
            <Widget key={id} id={id} data={data} />
          ))}
        </div>
        <div className="grid min-w-0 content-start gap-4 lg:gap-5">
          {layout.side.map((id) => (
            <Widget key={id} id={id} data={data} />
          ))}
        </div>
      </div>
    </Page>
  );
}
