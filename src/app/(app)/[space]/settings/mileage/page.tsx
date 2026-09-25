import { notFound } from 'next/navigation';
import { FieldEditor } from '@/components/settings/field-editor';
import { MileageRules } from '@/components/settings/mileage-rules';
import { SettingsPage } from '@/components/settings/sections';
import { resolveSettings } from '@/lib/platform/business-settings';
import { approversText, fieldSetup, openBusinessSettings } from '../load';

export const metadata = { title: 'Mileage settings' };

export default async function MileageSettings({ params }: PageProps<'/[space]/settings/mileage'>) {
  const { workspace, repo } = await openBusinessSettings(params);
  const { space } = workspace;
  if (!space.modules.includes('mileage')) notFound();
  const settings = resolveSettings(space);
  const { fields, inUse } = await fieldSetup(repo, 'mileage');
  return (
    <SettingsPage
      space={space}
      active="mileage"
      title="Mileage"
      description="How trips are logged and paid back here."
      wide
    >
      <MileageRules
        rules={settings.mileage}
        rate={space.mileageRate}
        fields={fields}
        approvers={approversText(settings.approvals.approvers)}
      >
        <FieldEditor
          appliesTo="mileage"
          fields={fields}
          inUse={inUse}
          noun="trip"
          title="Extra trip information"
          intro="What else your company asks for on a trip."
          always="Hyphy always records the date, where from and to, the miles, the vehicle, who drove and whether it was approved."
        />
      </MileageRules>
    </SettingsPage>
  );
}
