import { QuickActions } from '@/components/create/create-button';
import { Widget, type DashboardData } from '@/components/dashboard/widgets';
import { cn } from '@/components/ui/cn';
import { Page } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Starters } from '@/components/auth/starters';
import { BusinessStarters } from '@/components/business/starters';
import { Icon } from '@/components/ui/icon';
import Link from 'next/link';
import { getRepository } from '@/lib/data';
import { viewsFor } from '@/lib/files/access';
import { requireWorkspace } from '@/lib/identity';
import {
  currentProjectFor,
  exceptionsFor,
  monthSummary,
  projectMoney,
  toolUsage,
  weekSummary,
} from '@/lib/insights';
import { dashboardFor } from '@/lib/platform/dashboard';
import { workProfile } from '@/lib/platform/work';
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
    pins,
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
    repo.pins(),
  ]);
  const people = new Map(directory.map((item) => [item.id, item]));
  const rate = space.mileageRate;
  // Things the Inbox already shows aren't repeated as exceptions.
  const inInbox = new Set(inbox.map((item) => item.subject.id));
  const data: DashboardData = {
    workspace,
    base: `/${space.slug}`,
    people,
    directory,
    members,
    inbox,
    activity,
    projects,
    vehicles,
    receipts,
    mileage,
    files,
    // Project photos' previews, signed together (only the few the dashboard shows).
    fileViews: await viewsFor(
      workspace,
      files
        .filter(
          (file) =>
            file.kind === 'image' &&
            file.source !== 'qr' &&
            file.attachedTo.some((ref) => ref.type === 'project'),
        )
        .slice(0, 24),
    ),
    qrCodes,
    linkPages,
    month: monthSummary({ receipts, mileage, files }, space.timezone),
    // Tracked the way a project page counts it: receipts plus personal-vehicle miles.
    projectSpend: new Map(
      projects.map((project) => [
        project.id,
        projectMoney(
          project,
          receipts.filter((row) => row.projectId === project.id),
          mileage.filter((row) => row.projectId === project.id),
          rate,
        ).tracked,
      ]),
    ),
    pins,
    usage: toolUsage(person.id, { receipts, mileage, files, qrCodes, linkPages }),
    exceptions:
      space.kind === 'business' && workspace.permissions.includes('expenses.view_all')
        ? exceptionsFor(
            { receipts, mileage, files, projects, vehicles, people },
            { rate, skip: inInbox },
          )
        : [],
    week: weekSummary({ receipts, mileage, projects, activity }, rate),
  };
  const layout = dashboardFor(space, membership);
  // A Personal Space nobody has used yet — a brand-new account. Home offers first things to do
  // instead of empty lists; it fills itself as they work.
  const fresh =
    space.kind === 'personal' &&
    [activity, receipts, mileage, files, qrCodes, linkPages, projects].every(
      (rows) => !rows.length,
    );
  // A business with nothing in it yet: first steps instead of empty panels, no invented activity.
  // Only for the people who run it: members and guests always get their own role's Home.
  const freshBusiness =
    space.kind === 'business' &&
    workspace.permissions.includes('space.manage') &&
    [projects, vehicles, receipts, mileage, files, qrCodes, linkPages].every(
      (rows) => !rows.length,
    );
  const unfinishedSetup =
    space.kind === 'business' &&
    !space.setupDoneAt &&
    workspace.permissions.includes('space.manage');
  const can = (permission: (typeof workspace.permissions)[number]) =>
    workspace.permissions.includes(permission);
  const urgent = inbox.find((item) => item.priority === 'high');

  // A few plain sentences about today, written for this person. Specific beats clever.
  const briefing = (() => {
    if (fresh) return 'What would you like to do first? Everything you make here is kept for you.';
    if (freshBusiness)
      return `${space.name} is ready. Start with one of these — Home fills in as your team works.`;
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
      const back = [...receipts, ...mileage].filter(
        (item) => item.status === 'returned' && !item.returnSeenAt,
      );
      const reviewer = back[0]?.reviewedBy ? data.people.get(back[0].reviewedBy) : undefined;
      return [
        project ? `You’re on ${project.name}.` : undefined,
        back.length
          ? `${reviewer ? reviewer.firstName : 'A manager'} sent ${back.length === 1 ? 'one thing' : `${back.length} things`} back to fix.`
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
    return `${plural(projects.length, workProfile(space).singular.toLowerCase())} shared with you by ${space.name}.${
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
            {fresh
              ? 'Welcome to Hyphy'
              : layout.hero === 'personal'
                ? 'Welcome back'
                : greeting(space.timezone)}
            , {person.firstName}.
          </h1>
          <p className="mt-2.5 max-w-[64ch] text-[15.5px] leading-relaxed text-ink-2/80 lg:text-[15px]">
            {briefing}
          </p>
        </div>
        {layout.hero === 'operator' && !freshBusiness && (
          <div className="hidden shrink-0 lg:block">
            <QuickActions count={3} variant="inline" />
          </div>
        )}
      </header>

      {!freshBusiness && (layout.hero === 'member' || layout.hero === 'guest') && (
        <section
          aria-label={layout.bigActions ? 'Your actions' : 'Quick actions'}
          className="mb-6 lg:mb-8"
        >
          <QuickActions big={layout.bigActions} count={4} />
        </section>
      )}

      {fresh && (
        <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-label="Start here" className="min-w-0">
            <Starters workspace={workspace} />
          </section>
          <Panel as="aside" className="p-5">
            <h2 className="text-[15px] font-semibold">This page fills in as you go</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
              What you make — PDFs, codes, receipts, trips — shows up here as recent work, with your
              files and the tools you pin. It’s all private to your Personal Space.
            </p>
          </Panel>
        </div>
      )}

      {unfinishedSetup && (
        <Link
          href={`/${space.slug}/setup`}
          className="mb-5 flex items-center gap-3 rounded-[16px] bg-signal-soft/70 px-4 py-3 text-[14px] text-signal-ink shadow-[inset_0_0_0_1px_rgb(50_64_255/.12)] transition-colors hover:bg-signal-soft"
        >
          <Icon name="sparkles" size={17} />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Finish setting up {space.name}</span>
            <span className="text-signal-ink/80"> — choose its tools and invite your team.</span>
          </span>
          <Icon name="arrow-right" size={16} />
        </Link>
      )}

      {freshBusiness && (
        <section aria-label="Start here" className="mb-6">
          <BusinessStarters />
        </section>
      )}

      {!fresh && !freshBusiness && layout.top.length > 0 && (
        <div className="mb-5 grid gap-4 lg:mb-6 lg:gap-5">
          {layout.top.map((id) => (
            <Widget key={id} id={id} data={data} />
          ))}
        </div>
      )}

      {!fresh && !freshBusiness && (
        <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid min-w-0 content-start gap-4 lg:gap-5">
            {layout.main.map((id) => (
              <Widget key={id} id={id} data={data} />
            ))}
          </div>
          {/* A guest's side is what's asked of them and who to call: on phones it leads. */}
          <div
            className={cn(
              'grid min-w-0 content-start gap-4 lg:gap-5',
              layout.hero === 'guest' && 'max-xl:order-first',
            )}
          >
            {layout.side.map((id) => (
              <Widget key={id} id={id} data={data} />
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
