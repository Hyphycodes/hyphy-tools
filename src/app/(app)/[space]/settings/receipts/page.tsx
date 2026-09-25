import { notFound } from 'next/navigation';
import { FieldEditor } from '@/components/settings/field-editor';
import { ReceiptRules } from '@/components/settings/receipt-rules';
import { SettingsPage } from '@/components/settings/sections';
import { resolveSettings } from '@/lib/platform/business-settings';
import { approversText, fieldSetup, openBusinessSettings } from '../load';

export const metadata = { title: 'Receipt settings' };

export default async function ReceiptSettings({ params }: PageProps<'/[space]/settings/receipts'>) {
  const { workspace, repo } = await openBusinessSettings(params);
  const { space } = workspace;
  if (!space.modules.includes('receipts')) notFound();
  const settings = resolveSettings(space);
  const { fields, inUse } = await fieldSetup(repo, 'receipts');
  return (
    <SettingsPage
      space={space}
      active="receipts"
      title="Receipts"
      description="What employees must record on every receipt, and when a manager says yes."
      wide
    >
      <ReceiptRules
        rules={settings.receipts}
        fields={fields}
        approvers={approversText(settings.approvals.approvers)}
      >
        <FieldEditor
          appliesTo="receipts"
          fields={fields}
          inUse={inUse}
          noun="receipt"
          title="Extra receipt information"
          intro="What else your company asks for on a receipt."
          always="Hyphy always records where, the total, the date, who sent it and whether it was approved. Your fields add to that; they never change it."
        />
      </ReceiptRules>
    </SettingsPage>
  );
}
