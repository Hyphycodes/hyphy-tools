import { notFound } from 'next/navigation';
import { FieldEditor } from '@/components/settings/field-editor';
import { SettingsPage } from '@/components/settings/sections';
import { vehicleWords } from '@/lib/platform/terms';
import { fieldSetup, openBusinessSettings } from '../load';

export const metadata = { title: 'Vehicle settings' };

export default async function VehicleSettings({ params }: PageProps<'/[space]/settings/vehicles'>) {
  const { workspace, repo } = await openBusinessSettings(params);
  const { space } = workspace;
  if (!space.modules.includes('vehicles')) notFound();
  const words = vehicleWords(space);
  const noun = words.singular.toLowerCase();
  const { fields, inUse } = await fieldSetup(repo, 'vehicles');
  return (
    <SettingsPage
      space={space}
      active="vehicles"
      title={words.plural}
      description={`What you keep about each ${noun}. Not fleet software — just what you’d want on hand.`}
      wide
    >
      <div className="max-w-[760px]">
        <FieldEditor
          appliesTo="vehicles"
          fields={fields}
          inUse={inUse}
          noun={noun}
          title={`What else each ${noun} keeps`}
          intro="Plate, VIN, a department, the next inspection — whatever your business checks."
          always="Hyphy always keeps the name, year, make and model, plate, odometer, who drives it, and its fuel, trips and papers."
        />
      </div>
    </SettingsPage>
  );
}
