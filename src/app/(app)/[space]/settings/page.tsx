import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { fieldTypes } from '@/lib/platform/custom-fields';
import { formatDate } from '@/lib/platform/format';
import { planFor, plans } from '@/lib/platform/plans';
import { ROLE_ORDER, roles } from '@/lib/platform/roles';
import { tools } from '@/lib/platform/tools';
import { ModuleToggles, type ToggleRow } from './module-toggles';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({ params }: PageProps<'/[space]/settings'>) {
  const { workspace, repo, base, tz, can } = await openPage(params);
  if (!can('space.manage')) notFound();
  const { space, membership } = workspace;
  const plan = plans[space.plan];
  const members = await repo.members();
  const personal = space.kind === 'personal';

  const rows: ToggleRow[] = tools
    .filter((tool) => tool.module && tool.status !== 'soon' && tool.spaceKinds.includes(space.kind))
    .map((tool) => {
      const inPlan = plan.includes.includes(tool.module!);
      return {
        module: tool.module!,
        name: (tool.module && space.labels?.[tool.module]?.plural) || tool.name,
        tagline: tool.tagline,
        color: tool.color,
        ink: tool.ink,
        icon: tool.icon,
        locked: inPlan
          ? undefined
          : `Included with ${planFor(tool.module!, space.kind)?.name ?? 'a higher plan'}`,
        required: tool.module === 'files' || (!personal && tool.module === 'people'),
      };
    });
  const customFields = Object.entries(space.customFields ?? {}).filter(([, list]) => list?.length);

  return (
    <Page>
      <PageHeader
        title={personal ? 'Settings' : 'Space settings'}
        description={
          personal
            ? 'Your personal Space: private to you.'
            : `How ${space.name} works for everyone in it.`
        }
      />

      <Panel className="mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <SpaceMark space={space} size="xl" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{space.name}</h2>
          <p className="text-[13.5px] text-muted">
            {space.descriptor} · {personal ? 'Personal Space' : 'Business Space'} · since{' '}
            {formatDate(space.createdAt, tz, true)}
          </p>
        </div>
        <Button size="sm" disabled title="Editing arrives with accounts">
          <Icon name="pencil" size={14} /> Edit
        </Button>
      </Panel>

      <div className="mb-5 rounded-[16px] bg-signal-soft/70 p-4 text-[13.5px] leading-relaxed text-signal-ink shadow-[inset_0_0_0_1px_rgb(50_64_255/.12)]">
        <p className="font-semibold">Three separate switches</p>
        <p className="mt-1 text-signal-ink/85">
          Your <b>role</b> ({personal ? 'Owner' : roles[membership.role].label}) decides what you
          can do. The <b>plan</b> ({plan.name}) decides what this Space can turn on. The{' '}
          <b>tools</b> below decide what’s actually on. Changing one never changes the others.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel id="tools" className="lg:col-span-2">
          <PanelHeader title="Tools in this Space" count={space.modules.length} />
          <p className="px-4 pb-2 text-[13px] text-muted">
            Turning a tool off hides it for everyone here. Nothing is deleted.
          </p>
          <ModuleToggles slug={space.slug} rows={rows} enabled={space.modules} />
        </Panel>

        <Panel>
          <PanelHeader title="Plan" />
          <div className="px-4 pb-4">
            <div className="flex items-center gap-2">
              <p className="text-[20px] font-semibold">{plan.name}</p>
              <Badge tone="outline">Preview</Badge>
            </div>
            <p className="mt-1 text-[13.5px] text-muted">{plan.summary}</p>
            <p className="mt-4 text-[12.5px] text-faint">
              {can('space.billing')
                ? 'Billing isn’t active in this preview. Plans and prices arrive with accounts.'
                : 'Only owners can change the plan.'}
            </p>
            <Button size="sm" className="mt-3" disabled>
              {can('space.billing') ? 'Change plan' : 'Owner only'}
            </Button>
          </div>
        </Panel>

        {!personal && (
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
        )}

        {customFields.length > 0 && (
          <Panel className="lg:col-span-2">
            <PanelHeader title="Custom fields">
              <Badge tone="signal">Preview</Badge>
            </PanelHeader>
            <p className="px-4 text-[13px] text-muted">
              Add your own details to records without a database builder. Shown read-only for now;
              editing arrives with accounts.
            </p>
            <div className="grid gap-4 p-4 sm:grid-cols-3">
              {customFields.map(([module, list]) => (
                <div key={module}>
                  <p className="label mb-2">
                    {space.labels?.[module as 'projects']?.plural ?? module}
                  </p>
                  <ul className="grid gap-1.5">
                    {list!.map((field) => (
                      <li
                        key={field.id}
                        className="flex items-center justify-between rounded-[10px] bg-subtle px-3 py-2 text-[13px]"
                      >
                        <span className="font-medium">{field.label}</span>
                        <span className="text-[12px] text-muted">
                          {fieldTypes[field.type].label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
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
    </Page>
  );
}
