import { FieldEditor } from '@/components/settings/field-editor';
import { SettingsPage } from '@/components/settings/sections';
import { fieldSetup, openBusinessSettings } from '../load';

export const metadata = { title: 'People settings' };

export default async function PeopleSettings({ params }: PageProps<'/[space]/settings/people'>) {
  const { workspace, repo } = await openBusinessSettings(params);
  const { fields, inUse } = await fieldSetup(repo, 'people');
  return (
    <SettingsPage
      space={workspace.space}
      active="people"
      title="People"
      description="What you keep about each person here: a crew, a certification. Not HR records."
      wide
    >
      <div className="max-w-[760px]">
        <FieldEditor
          appliesTo="people"
          fields={fields}
          inUse={inUse}
          noun="person"
          listable={false}
          title="What else you keep about people"
          intro="Owners and admins fill these in from each person’s page. Guests never see them."
          always="Hyphy always keeps each person’s name, contact details, role and job title. Roles themselves stay Hyphy’s five."
        />
      </div>
    </SettingsPage>
  );
}
