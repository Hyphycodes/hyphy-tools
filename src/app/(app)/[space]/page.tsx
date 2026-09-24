import { QuickActions } from '@/components/create/create-button';
import { Widget, type DashboardData } from '@/components/dashboard/widgets';
import { Page } from '@/components/ui/page';
import { getRepository } from '@/lib/data';
import { requireWorkspace } from '@/lib/identity';
import { monthSummary, spendBy } from '@/lib/insights';
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

  // One plain sentence about today, written for this person.
  const briefing = (() => {
    if (layout.hero === 'personal')
      return receipts.length || mileage.length
        ? `${formatMiles(data.month.miles)} and ${plural(data.month.receipts, 'receipt')} this month.${inbox.length ? ` ${plural(inbox.length, 'thing')} could use a look.` : ''}`
        : 'Your own tools, and everything you make with them, in one place.';
    if (layout.hero === 'operator') {
      const active = projects.filter((project) => project.status === 'active').length;
      const word = space.labels?.projects?.plural.toLowerCase() ?? 'projects';
      return [
        inbox.length
          ? `${plural(inbox.length, 'item')} need${inbox.length === 1 ? 's' : ''} you`
          : 'Nothing needs you',
        `${active} ${word} active`,
        workspace.permissions.includes('expenses.view_all') && data.month.spend
          ? `${formatCurrency(data.month.spend, { cents: false })} spent this month`
          : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (layout.hero === 'member') {
      const truck = vehicles.find((vehicle) => vehicle.assignedTo === person.id);
      const project = projects.find(
        (item) => item.status === 'active' && item.teamIds.includes(person.id),
      );
      const service = truck?.nextServiceMiles ? truck.nextServiceMiles - truck.odometer : null;
      return [
        project ? `You’re on ${project.name}` : undefined,
        truck && service !== null
          ? `${truck.name} is ${formatNumber(service)} miles from service`
          : undefined,
      ]
        .filter(Boolean)
        .join('. ')
        .concat('.');
    }
    const next = projects
      .map((project) => project.custom?.next_inspection as string | undefined)
      .find(Boolean);
    return `${plural(projects.length, space.labels?.projects?.singular.toLowerCase() ?? 'project')} shared with you by ${space.name}${
      next ? `. Next inspection in ${daysUntil(next)} days.` : '.'
    }`;
  })();

  return (
    <Page wide>
      <header className="mb-6 lg:mb-8">
        <p className="label mb-3 flex items-center gap-2">
          <span>{formatDateLong(new Date().toISOString(), space.timezone)}</span>
          <span className="text-faint">/</span>
          <span className="truncate">{space.kind === 'personal' ? 'Personal' : space.name}</span>
        </p>
        <h1 className="display text-[34px] text-ink sm:text-[42px] lg:text-[48px]">
          {layout.hero === 'personal' ? 'Welcome back' : greeting(space.timezone)},{' '}
          {person.firstName}.
        </h1>
        <p className="mt-2.5 max-w-[62ch] text-[15.5px] leading-relaxed text-muted lg:text-[15px]">
          {briefing}
        </p>
      </header>

      <section
        aria-label={layout.bigActions ? 'Your actions' : 'Quick actions'}
        className="mb-6 lg:mb-8"
      >
        {layout.bigActions && <p className="label mb-3">Your actions</p>}
        <QuickActions big={layout.bigActions} count={layout.bigActions ? 4 : 5} />
      </section>

      <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
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
