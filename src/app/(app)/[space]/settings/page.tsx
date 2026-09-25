import Link from 'next/link';
import type { ReactNode } from 'react';
import { ActivityList } from '@/components/records/activity-list';
import { SettingsPage } from '@/components/settings/sections';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { categoryLabel } from '@/lib/insights';
import { describeApproval, resolveSettings } from '@/lib/platform/business-settings';
import { businessTypes } from '@/lib/platform/business-types';
import { findAccent } from '@/lib/platform/brand';
import { activeFields } from '@/lib/platform/custom-fields';
import { formatCurrency, formatDate } from '@/lib/platform/format';
import { plans } from '@/lib/platform/plans';
import { ROLE_ORDER, roles } from '@/lib/platform/roles';
import { vehicleWords } from '@/lib/platform/terms';
import type { FieldDefinition, RecordType } from '@/lib/platform/types';
import { workProfile } from '@/lib/platform/work';
import { approversText, openSettings } from './load';
import { ModuleToggles } from './module-toggles';
import { toggleRowsFor } from './rows';

export const metadata = { title: 'Settings' };

/**
 * Business settings, at a glance: each part of how this business works, said as it is now
 * ("Receipts · Job required · Cost Code required · Every receipt approved"), with Customize for
 * the one thing to change. Tools switch on and off right here.
 */
export default async function SettingsPageRoute({ params }: PageProps<'/[space]/settings'>) {
  const { workspace, repo, base, tz, can, directory } = await openSettings(params);
  const { space, membership } = workspace;
  const plan = plans[space.plan];
  const personal = space.kind === 'personal';
  const rows = toggleRowsFor(space);

  if (personal)
    return (
      <Page>
        <PageHeader title="Settings" description="Your personal Space: private to you." />
        <Panel className="mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <SpaceMark space={space} size="xl" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{space.name}</h2>
            <p className="text-[13.5px] text-muted">
              {space.descriptor} · Personal Space · since {formatDate(space.createdAt, tz, true)}
            </p>
          </div>
        </Panel>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel id="tools" className="lg:col-span-2">
            <PanelHeader title="Tools in this Space" count={space.modules.length} />
            <p className="px-4 pb-2 text-[13px] text-muted">
              Turning a tool off hides it. Nothing is deleted.
            </p>
            <ModuleToggles slug={space.slug} rows={rows} enabled={space.modules} />
          </Panel>
          <PlanPanel planName={plan.name} summary={plan.summary} owner={can('space.billing')} />
        </div>
      </Page>
    );

  const [members, fields, activity] = await Promise.all([
    repo.members(),
    repo.fields(),
    repo.activity({ limit: 200 }),
  ]);
  const settings = resolveSettings(space);
  const profile = workProfile(space);
  const vehicle = vehicleWords(space);
  const on = (module: (typeof space.modules)[number]) => space.modules.includes(module);
  const asked = (type: RecordType) => activeFields(fields, type);
  const required = (value: boolean) => (value ? 'Required' : 'Optional');
  const fieldRows = (list: FieldDefinition[]): [string, string][] =>
    list.map((field) => [field.label, required(Boolean(field.required))]);
  const accent = findAccent(space.brand.color);
  const setup = activity
    .filter(
      (event) =>
        event.object.type === 'setting' ||
        (event.object.type === 'space' && event.object.label === 'the tools in this Space'),
    )
    .slice(0, 5);

  return (
    <SettingsPage
      space={space}
      active="overview"
      title="Business settings"
      description={`How ${space.name} works — for everyone in it. Hyphy supplies the structure; you decide the details.`}
      wide
    >
      <Panel className="mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <SpaceMark space={space} size="xl" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{space.name}</h2>
          <p className="text-[13.5px] text-muted">
            {space.businessType ? businessTypes[space.businessType].label : 'Business'} ·{' '}
            {roles[membership.role].label} · since {formatDate(space.createdAt, tz, true)}
          </p>
        </div>
        <Badge tone="outline">{plan.name}</Badge>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        <SummaryCard
          title="Basics"
          line="Name, kind, words and accent"
          href={`${base}/settings/basics`}
          rows={[
            ['Kind', space.businessType ? businessTypes[space.businessType].label : 'Not set'],
            [
              'Words',
              [
                on('projects') ? profile.plural : null,
                on('projects') ? `${profile.client}s` : null,
                on('vehicles') ? vehicle.plural : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—',
            ],
            ['Accent', accent?.name ?? 'Your own'],
          ]}
        />
        {on('receipts') && (
          <SummaryCard
            title="Receipts"
            line="What employees must record"
            href={`${base}/settings/receipts`}
            rows={[
              ...(on('projects')
                ? ([[profile.singular, required(settings.receipts.requireProject)]] as [
                    string,
                    string,
                  ][])
                : []),
              ...(on('vehicles')
                ? ([[vehicle.singular, required(settings.receipts.requireVehicle)]] as [
                    string,
                    string,
                  ][])
                : []),
              ...fieldRows(asked('receipts')),
              ['Personal expenses', settings.receipts.allowPersonal ? 'Allowed' : 'Not allowed'],
              ['Approval', describeApproval(settings.receipts.approval, 'receipt')],
            ]}
          />
        )}
        {on('mileage') && (
          <SummaryCard
            title="Mileage"
            line="How mileage works here"
            href={`${base}/settings/mileage`}
            rows={[
              [
                'Rate',
                space.mileageRate ? `${formatCurrency(space.mileageRate)} a mile` : 'Not paid back',
              ],
              ['Purpose', required(settings.mileage.requirePurpose)],
              ...(on('projects')
                ? ([[profile.singular, required(settings.mileage.requireProject)]] as [
                    string,
                    string,
                  ][])
                : []),
              ...(on('vehicles')
                ? ([
                    [
                      'Personal vehicles',
                      settings.mileage.allowPersonalVehicles ? 'Allowed' : 'Not allowed',
                    ],
                  ] as [string, string][])
                : []),
              ...fieldRows(asked('mileage')),
              ['Approval', describeApproval(settings.mileage.approval, 'trip')],
            ]}
          />
        )}
        {on('projects') && (
          <SummaryCard
            title={profile.plural}
            line={`What each ${profile.singular.toLowerCase()} keeps`}
            href={`${base}/settings/work`}
            rows={fieldRows(asked('projects'))}
            empty="Nothing extra yet"
          />
        )}
        {on('vehicles') && (
          <SummaryCard
            title={vehicle.plural}
            line={`What each ${vehicle.singular.toLowerCase()} keeps`}
            href={`${base}/settings/vehicles`}
            rows={fieldRows(asked('vehicles'))}
            empty="Nothing extra yet"
          />
        )}
        <SummaryCard
          title="People"
          line="What you keep about each person"
          href={`${base}/settings/people`}
          rows={fieldRows(asked('people'))}
          empty="Nothing extra yet"
        />
        <SummaryCard
          title="Approvals"
          line="Who reviews submissions"
          href={`${base}/settings/approvals`}
          rows={[
            ['Who approves', approversText(settings.approvals.approvers)],
            ['Their own', 'Never — someone else does'],
            ...(settings.receipts.defaultCategory
              ? ([['Receipts start on', categoryLabel[settings.receipts.defaultCategory]]] as [
                  string,
                  string,
                ][])
              : []),
          ]}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel id="tools" className="lg:col-span-2">
          <PanelHeader title="Tools" count={space.modules.length}>
            <span className="text-[12.5px] text-muted">What’s available to your team</span>
          </PanelHeader>
          <p className="px-4 pb-2 text-[13px] text-muted">
            Turning a tool off hides it for everyone here — menus, buttons and Home. Nothing it
            holds is deleted: turn it back on and it’s all there. People and Files are always on;
            every business has a team and paperwork.
          </p>
          <ModuleToggles slug={space.slug} rows={rows} enabled={space.modules} />
        </Panel>

        <PlanPanel planName={plan.name} summary={plan.summary} owner={can('space.billing')} />

        <Panel>
          <PanelHeader title="People & roles" href={`${base}/people`} action="Manage" />
          <ul className="px-4 pb-4">
            {ROLE_ORDER.map((role) => {
              const count = members.filter((member) => member.role === role).length;
              return (
                <li
                  key={role}
                  className="flex items-center justify-between border-t border-line py-2.5 text-[13.5px] first:border-0"
                >
                  <span>
                    <span className="font-medium">{roles[role].label}</span>
                    <span className="ml-2 text-muted">{roles[role].summary}</span>
                  </span>
                  <span className="mono-num text-[12px] text-muted">{count}</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        {setup.length > 0 && (
          <Panel className="lg:col-span-2" aria-label="Recent setup changes">
            <PanelHeader title="Recent setup changes" />
            <div className="pb-2">
              <ActivityList
                events={setup}
                people={directory}
                base={base}
                viewerId={workspace.person.id}
                timezone={tz}
                compact
              />
            </div>
          </Panel>
        )}
      </div>
      <p className="mt-6 text-[12.5px] text-faint">
        Looking for your own profile?{' '}
        <Link href={`${base}/profile`} className="underline">
          Profile & Spaces
        </Link>
      </p>
    </SettingsPage>
  );
}

function SummaryCard({
  title,
  line,
  href,
  rows,
  empty,
}: {
  title: string;
  line: string;
  href: string;
  rows: [string, ReactNode][];
  empty?: string;
}) {
  return (
    <Panel as="article" aria-label={title} className="flex flex-col">
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          <p className="text-[12.5px] text-muted">{line}</p>
        </div>
        <Link
          href={href}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[9px] px-2.5 text-[13px] font-medium text-ink shadow-card transition-colors hover:bg-subtle"
        >
          Customize <Icon name="arrow-right" size={14} />
        </Link>
      </header>
      {rows.length ? (
        <dl className="row-divide flex-1 px-4 pb-2">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 py-2 text-[13.5px]"
            >
              <dt className="min-w-0 truncate text-ink-2">{label}</dt>
              <dd
                className={
                  value === 'Required'
                    ? 'shrink-0 font-medium text-signal-ink'
                    : 'shrink-0 text-right text-muted'
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="px-4 pb-4 text-[13.5px] text-muted">{empty}</p>
      )}
    </Panel>
  );
}

function PlanPanel({
  planName,
  summary,
  owner,
}: {
  planName: string;
  summary: string;
  owner: boolean;
}) {
  return (
    <Panel>
      <PanelHeader title="Plan" />
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2">
          <p className="text-[20px] font-semibold">{planName}</p>
          <Badge tone="outline">Preview</Badge>
        </div>
        <p className="mt-1 text-[13.5px] text-muted">{summary}</p>
        <p className="mt-4 text-[12.5px] text-faint">
          {owner
            ? 'Billing isn’t active in this preview. Plans and prices arrive with accounts.'
            : 'Only owners can change the plan.'}
        </p>
        <Button size="sm" className="mt-3" disabled>
          {owner ? 'Change plan' : 'Owner only'}
        </Button>
      </div>
    </Panel>
  );
}
