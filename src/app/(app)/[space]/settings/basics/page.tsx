import { headers } from 'next/headers';
import Link from 'next/link';
import { AccentPicker, KindChooser, NameForm, TermsForm } from '@/components/settings/basics';
import { SettingsPage } from '@/components/settings/sections';
import { Icon } from '@/components/ui/icon';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { BASE_PATH } from '@/lib/base-path';
import { categoryLabel } from '@/lib/insights';
import { resolveSettings } from '@/lib/platform/business-settings';
import { formatCurrency } from '@/lib/platform/format';
import { openBusinessSettings } from '../load';

export const metadata = { title: 'Business basics' };

export default async function BasicsSettings({ params }: PageProps<'/[space]/settings/basics'>) {
  const { workspace, repo, base } = await openBusinessSettings(params);
  const { space } = workspace;
  const host = (await headers()).get('host')?.replace(/:\d+$/, '') ?? 'hyphy-studio.com';
  const fields = await repo.fields();
  const settings = resolveSettings(space);
  return (
    <SettingsPage
      space={space}
      active="basics"
      title="Basics"
      description="Your name, what kind of business you are, the words you use and your mark."
    >
      <div className="grid max-w-[860px] gap-5">
        <Panel>
          <PanelHeader title="Name and kind" />
          <div className="grid gap-5 px-4 pb-5">
            <NameForm />
            <KindChooser fields={fields} />
            <p className="text-[12.5px] leading-snug text-muted">
              The kind of business suggests a starting setup. Changing it later asks before adding
              anything, and never removes what you have.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Your words" />
          <div className="px-4 pb-5">
            <TermsForm />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Accent and mark" />
          <div className="grid gap-4 px-4 pb-5">
            <AccentPicker />
            <p className="flex items-center gap-2 text-[12.5px] text-muted">
              <Icon name="image" size={14} /> Logo uploads arrive with file storage. Until then your
              mark uses your initials.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Defaults" />
          <dl className="row-divide px-4 pb-2 text-[13.5px]">
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-ink-2">Currency</dt>
              <dd className="text-right text-muted">US dollar — the only one for now</dd>
            </div>
            {space.modules.includes('mileage') && (
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-ink-2">Mileage rate</dt>
                <dd>
                  <Link href={`${base}/settings/mileage`} className="text-muted hover:text-ink">
                    {space.mileageRate
                      ? `${formatCurrency(space.mileageRate)} a mile`
                      : 'Not paid back'}{' '}
                    · Change
                  </Link>
                </dd>
              </div>
            )}
            {space.modules.includes('receipts') && (
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-ink-2">New receipts start on</dt>
                <dd>
                  <Link href={`${base}/settings/receipts`} className="text-muted hover:text-ink">
                    {settings.receipts.defaultCategory
                      ? categoryLabel[settings.receipts.defaultCategory]
                      : 'Hyphy’s guess'}{' '}
                    · Change
                  </Link>
                </dd>
              </div>
            )}
            {space.modules.includes('vehicles') && (
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-ink-2">Someone’s default vehicle</dt>
                <dd className="text-right text-muted">The one assigned to them</dd>
              </div>
            )}
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title="Address" />
          <div className="grid gap-1.5 px-4 pb-4">
            <p className="truncate rounded-[11px] bg-subtle px-3.5 py-3 text-[14px] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] lg:py-2.5">
              {host}
              {BASE_PATH}/<span className="text-ink">{space.slug}</span>
            </p>
            <p className="text-[12.5px] leading-snug text-muted">
              Addresses stay the same so links and bookmarks keep working.
            </p>
          </div>
        </Panel>
      </div>
    </SettingsPage>
  );
}
