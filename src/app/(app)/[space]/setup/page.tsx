import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SetupTeam } from '@/components/business/setup-team';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { Page } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { businessTypes } from '@/lib/platform/business-types';
import { grantableRoles } from '@/lib/platform/roles';
import { ModuleToggles } from '../settings/module-toggles';
import { toggleRowsFor } from '../settings/rows';

export const metadata = { title: 'Set up' };

const steps = [
  { id: 'created', label: 'Business created' },
  { id: 'tools', label: 'Tools' },
  { id: 'team', label: 'Your team' },
] as const;

/**
 * Right after creating a business: pick its tools (already set from its kind), then invite the
 * team or skip. Two short steps; everything here can be changed later in Settings and People.
 */
export default async function SetupPage({ params, searchParams }: PageProps<'/[space]/setup'>) {
  const { workspace, base, can } = await openPage(params);
  const { space } = workspace;
  if (space.kind !== 'business' || !can('space.manage')) notFound();
  const step = (await searchParams).step === 'team' ? 'team' : 'tools';
  const preset = space.businessType ? businessTypes[space.businessType] : undefined;
  const at = steps.findIndex((item) => item.id === step);

  return (
    <Page>
      <div className="mx-auto max-w-[720px]">
        <header className="mb-6 flex items-center gap-4">
          <SpaceMark space={space} size="xl" />
          <div className="min-w-0">
            <p className="label mb-1.5">{preset?.label ?? 'Business'}</p>
            <h1 className="display text-[30px] sm:text-[36px]">
              {step === 'tools' ? `${space.name} is ready.` : 'Invite your team.'}
            </h1>
          </div>
        </header>

        <ol
          className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]"
          aria-label="Setup"
        >
          {steps.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2">
              <span
                aria-current={index === at ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-1',
                  index < at && 'text-positive',
                  index === at && 'bg-ink text-white',
                  index > at && 'text-muted',
                )}
              >
                {index < at ? (
                  <Icon name="check" size={13} />
                ) : (
                  <span className="mono-num">{index + 1}</span>
                )}
                {item.label}
              </span>
              {index < steps.length - 1 && <span className="text-faint">·</span>}
            </li>
          ))}
        </ol>

        {step === 'tools' ? (
          <>
            <Panel className="mb-5">
              <div className="px-4 pt-4 pb-2">
                <h2 className="text-[16px] font-semibold">What should Hyphy help with?</h2>
                <p className="mt-1 text-[13.5px] text-muted">
                  We turned on what {preset ? preset.label.toLowerCase() : 'most'} businesses use.
                  Switch anything on or off — it’s the same list as Settings.
                </p>
              </div>
              <ModuleToggles
                slug={space.slug}
                rows={toggleRowsFor(space)}
                enabled={space.modules}
              />
            </Panel>
            <div className="flex justify-end">
              <Link
                href={`${base}/setup?step=team`}
                className={buttonClass({ variant: 'primary', size: 'lg' })}
              >
                Continue <Icon name="arrow-right" size={17} />
              </Link>
            </div>
          </>
        ) : (
          <Panel className="p-5">
            <p className="mb-5 text-[14px] leading-relaxed text-muted">
              Each person gets an email with a link. They join with their own Hyphy account — new or
              existing — and see only what their role allows.
            </p>
            <SetupTeam slug={space.slug} grantable={grantableRoles(workspace.membership.role)} />
          </Panel>
        )}
      </div>
    </Page>
  );
}
