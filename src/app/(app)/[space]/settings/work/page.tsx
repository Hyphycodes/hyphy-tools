import { notFound } from 'next/navigation';
import { FieldEditor } from '@/components/settings/field-editor';
import { SettingsPage } from '@/components/settings/sections';
import { Panel } from '@/components/ui/panel';
import { activeFields } from '@/lib/platform/custom-fields';
import { workProfile } from '@/lib/platform/work';
import { fieldSetup, openBusinessSettings } from '../load';

export const metadata = { title: 'Project settings' };

/** What each job (event, property…) keeps, and how its page shows it. */
export default async function WorkSettings({ params }: PageProps<'/[space]/settings/work'>) {
  const { workspace, repo } = await openBusinessSettings(params);
  const { space } = workspace;
  if (!space.modules.includes('projects')) notFound();
  const profile = workProfile(space);
  const noun = profile.singular.toLowerCase();
  const { fields, inUse } = await fieldSetup(repo, 'projects');
  const shown = activeFields(fields, 'projects');
  return (
    <SettingsPage
      space={space}
      active="work"
      title={profile.plural}
      description={`What each ${noun} keeps, beyond its name, dates, team and costs.`}
      wide
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <FieldEditor
          appliesTo="projects"
          fields={fields}
          inUse={inUse}
          noun={noun}
          title={`What else each ${noun} keeps`}
          intro={`Filled in when a ${noun} is created, and from its page any time.`}
          always={`Hyphy always keeps the name, ${profile.location.toLowerCase()}, ${profile.client.toLowerCase()}, dates, team, money and everything filed to it.`}
        />
        <Panel className="p-4 lg:sticky lg:top-6" aria-label="How it shows">
          <p className="label mb-2">How a {noun} page shows it</p>
          <dl className="row-divide rounded-[12px] bg-subtle px-3 text-[13px]">
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-muted">{profile.client}</dt>
              <dd className="font-medium">Harrison Family</dd>
            </div>
            {shown.slice(0, 6).map((field) => (
              <div key={field.id} className="flex justify-between gap-3 py-2">
                <dt className="text-muted">{field.label}</dt>
                <dd className="truncate font-medium text-faint">
                  {field.type === 'select' ? field.options?.[0] : '…'}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12.5px] leading-snug text-muted">
            Your fields read like Hyphy’s own. Ones marked “On lists” also show on each {noun} card.
          </p>
        </Panel>
      </div>
    </SettingsPage>
  );
}
