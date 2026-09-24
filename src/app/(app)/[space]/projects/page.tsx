import Link from 'next/link';
import { CreateButton } from '@/components/create/create-button';
import { ProjectStatusBadge } from '@/components/records/status';
import { AvatarStack } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Progress } from '@/components/ui/progress';
import { Chips } from '@/components/ui/tabs';
import { spendBy } from '@/lib/insights';
import { openPage } from '@/lib/page';
import { daysUntil, formatCurrency, formatDate } from '@/lib/platform/format';
import type { Person, ProjectStatus } from '@/lib/platform/types';

export const metadata = { title: 'Projects' };

const order: ProjectStatus[] = ['active', 'planning', 'on-hold', 'done'];
const statusName: Record<ProjectStatus, string> = {
  active: 'Active',
  planning: 'Planning',
  'on-hold': 'On hold',
  done: 'Done',
};

export default async function ProjectsPage({
  params,
  searchParams,
}: PageProps<'/[space]/projects'>) {
  const { workspace, repo, base, people, tz, can } = await openPage(params, 'projects');
  const view = String((await searchParams).status ?? 'open');
  const [projects, receipts, files] = await Promise.all([
    repo.projects(),
    repo.receipts(),
    repo.files(),
  ]);
  const spend = spendBy(receipts, 'projectId');
  const labels = workspace.space.labels?.projects ?? { singular: 'Project', plural: 'Projects' };
  const events = Boolean(workspace.space.labels?.projects);
  const shown = projects
    .filter((project) =>
      view === 'open' ? project.status !== 'done' : view === 'all' ? true : project.status === view,
    )
    .sort((a, b) =>
      events
        ? a.startDate.localeCompare(b.startDate)
        : order.indexOf(a.status) - order.indexOf(b.status) || b.progress - a.progress,
    );
  const guestOrMember = !can('projects.view_all');

  return (
    <Page wide>
      <PageHeader
        title={labels.plural}
        description={
          guestOrMember
            ? `The ${labels.plural.toLowerCase()} you’re part of in ${workspace.space.name}.`
            : events
              ? 'Every event, with its guests, files, costs and crew.'
              : 'Every job with its costs, miles, files and crew — gathered as people work.'
        }
        actions={
          <CreateButton request="project" variant="primary" icon="plus">
            New {labels.singular.toLowerCase()}
          </CreateButton>
        }
      />
      <div className="mb-5">
        <Chips
          active={view}
          items={[
            {
              id: 'open',
              label: 'Open',
              href: `${base}/projects`,
              count: projects.filter((project) => project.status !== 'done').length,
            },
            ...order
              .filter((status) => projects.some((project) => project.status === status))
              .map((status) => ({
                id: status,
                label: statusName[status],
                href: `${base}/projects?status=${status}`,
                count: projects.filter((project) => project.status === status).length,
              })),
            { id: 'all', label: 'All', href: `${base}/projects?status=all` },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <Panel>
          <EmptyState icon="projects" title={`No ${labels.plural.toLowerCase()} here`}>
            {can('projects.manage')
              ? `Create one and its costs, files and people will gather in one place.`
              : `When someone adds you to a ${labels.singular.toLowerCase()}, it shows up here.`}
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((project, index) => {
            const team = project.teamIds.map((id) => people.get(id)).filter(Boolean) as Person[];
            const spent = spend.get(project.id) ?? 0;
            const photos = files.filter(
              (file) =>
                file.kind === 'image' && file.attachedTo.some((ref) => ref.id === project.id),
            );
            const fileCount = files.filter((file) =>
              file.attachedTo.some((ref) => ref.id === project.id),
            ).length;
            const date = events ? project.startDate : project.dueDate;
            const days = date ? daysUntil(date) : null;
            return (
              <Link
                key={project.id}
                href={`${base}/projects/${project.id}`}
                className="group flex min-w-0 animate-rise flex-col overflow-hidden rounded-[18px] bg-surface shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <div
                  className="relative h-24 overflow-hidden"
                  style={{ background: `color-mix(in oklab, ${project.color} 22%, white)` }}
                >
                  {photos.length > 0 ? (
                    <div className="absolute inset-0 flex gap-px">
                      {photos.slice(0, 3).map((file) => (
                        <span
                          key={file.id}
                          className="flex-1"
                          style={{ background: file.preview }}
                        />
                      ))}
                    </div>
                  ) : (
                    <span
                      className="display absolute -right-2 -bottom-5 text-[88px] leading-none opacity-[.13]"
                      style={{ color: project.color }}
                      aria-hidden="true"
                    >
                      {project.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2)}
                    </span>
                  )}
                  <span className="absolute top-3 left-3">
                    <ProjectStatusBadge status={project.status} />
                  </span>
                  {days !== null && project.status !== 'done' && (
                    <span className="absolute top-3 right-3 rounded-full bg-surface/90 px-2 py-0.5 text-[12px] font-medium text-ink backdrop-blur">
                      {events
                        ? formatDate(date!, tz)
                        : days < 0
                          ? `${-days}d late`
                          : `Due in ${days}d`}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
                    {project.name}
                  </h2>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted">
                    <Icon name="map-pin" size={13} /> {project.location}
                    {project.client && <span className="truncate">· {project.client}</span>}
                  </p>
                  <div className="mt-4 flex items-center gap-2.5">
                    <Progress
                      value={project.progress}
                      color={project.color}
                      className="flex-1"
                      label="Progress"
                    />
                    <span className="text-[12px] text-muted">{project.progress}%</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                    <AvatarStack people={team} size="sm" max={4} />
                    <span className="flex gap-3 text-[12.5px] text-muted">
                      {can('expenses.view_all') && spent > 0 && (
                        <span>{formatCurrency(spent, { cents: false })}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <Icon name="files" size={13} /> {fileCount}
                      </span>
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
