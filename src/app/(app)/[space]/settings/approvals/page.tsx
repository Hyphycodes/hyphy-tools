import Link from 'next/link';
import { ApproversForm } from '@/components/settings/approvers';
import { SettingsPage } from '@/components/settings/sections';
import { Icon } from '@/components/ui/icon';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { describeApproval, resolveSettings } from '@/lib/platform/business-settings';
import { openBusinessSettings } from '../load';

export const metadata = { title: 'Approvals' };

/**
 * Who reviews submissions, and what needs reviewing. Deliberately small: two roles to choose from,
 * one rule per kind of submission. Not a workflow builder.
 */
export default async function ApprovalSettings({
  params,
}: PageProps<'/[space]/settings/approvals'>) {
  const { workspace, base } = await openBusinessSettings(params);
  const { space } = workspace;
  const settings = resolveSettings(space);
  const rows = [
    ...(space.modules.includes('receipts')
      ? [
          {
            label: 'Receipts',
            value: describeApproval(settings.receipts.approval, 'receipt'),
            href: `${base}/settings/receipts`,
          },
        ]
      : []),
    ...(space.modules.includes('mileage')
      ? [
          {
            label: 'Mileage',
            value: describeApproval(settings.mileage.approval, 'trip'),
            href: `${base}/settings/mileage`,
          },
        ]
      : []),
  ];
  return (
    <SettingsPage
      space={space}
      active="approvals"
      title="Approvals"
      description="Who says yes to receipts and trips, and which ones need it."
    >
      <div className="grid max-w-[760px] gap-5">
        <Panel>
          <PanelHeader title="Who approves" />
          <div className="px-4 pb-4">
            <ApproversForm approvers={settings.approvals.approvers} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="What needs approval" />
          <ul className="row-divide pb-1">
            {rows.map((row) => (
              <li key={row.label}>
                <Link
                  href={row.href}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-[14px] transition-colors hover:bg-subtle"
                >
                  <span className="font-medium text-ink">{row.label}</span>
                  <span className="flex items-center gap-2 text-muted">
                    {row.value} <Icon name="chevron-right" size={15} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <p className="flex items-start gap-2.5 rounded-[14px] bg-signal-soft/70 px-4 py-3 text-[13.5px] leading-relaxed text-signal-ink shadow-[inset_0_0_0_1px_rgb(50_64_255/.12)]">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
          <span>
            Nobody approves their own receipts or trips — Hyphy checks every decision, whatever the
            settings. Something filed without needing approval says so on its timeline.
          </span>
        </p>
      </div>
    </SettingsPage>
  );
}
