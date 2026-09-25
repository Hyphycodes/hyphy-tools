import { ActivityList } from '@/components/records/activity-list';
import { EmptyState } from '@/components/ui/empty';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { openPage } from '@/lib/page';
import type { ObjectRef } from '@/lib/platform/types';

export const metadata = { title: 'Activity' };

const filters: { id: string; label: string; types: ObjectRef['type'][] }[] = [
  { id: 'all', label: 'Everything', types: [] },
  { id: 'work', label: 'Projects', types: ['project'] },
  { id: 'money', label: 'Receipts & miles', types: ['receipt', 'mileage'] },
  { id: 'files', label: 'Files', types: ['file'] },
  { id: 'people', label: 'People & vehicles', types: ['person', 'vehicle'] },
  { id: 'tools', label: 'Codes & links', types: ['qr', 'link', 'space'] },
];

/** One shared activity model. Real backend events will replace the seeded ones without changing this page. */
export default async function ActivityPage({
  params,
  searchParams,
}: PageProps<'/[space]/activity'>) {
  const { workspace, repo, base, directory, can } = await openPage(params);
  const view = String((await searchParams).view ?? 'all');
  const events = await repo.activity();
  const filter = filters.find((item) => item.id === view) ?? filters[0];
  const shown = filter.types.length
    ? events.filter((event) => filter.types.includes(event.object.type))
    : events;
  const personal = workspace.space.kind === 'personal';

  return (
    <Page narrow>
      <PageHeader
        title={personal ? 'History' : 'Activity'}
        description={
          personal
            ? 'Everything you’ve made and saved, newest first.'
            : can('activity.view_all')
              ? `Everything happening in ${workspace.space.name}.`
              : 'What’s happening on your projects, plus everything you’ve done.'
        }
      />
      <div className="mb-4">
        <Chips
          active={filter.id}
          items={filters
            .filter(
              (item) =>
                !item.types.length ||
                events.some((event) => item.types.includes(event.object.type)),
            )
            .map((item) => ({
              id: item.id,
              label: item.label,
              href: item.id === 'all' ? `${base}/activity` : `${base}/activity?view=${item.id}`,
            }))}
        />
      </div>
      <Panel className="pb-2">
        {shown.length ? (
          <ActivityList
            grouped
            events={shown}
            people={directory}
            base={base}
            viewerId={workspace.person.id}
            timezone={workspace.space.timezone}
          />
        ) : (
          <EmptyState icon="activity" title="Nothing here yet">
            Use a tool or add something, and it shows up here.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
