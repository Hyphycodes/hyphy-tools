import { Tabs } from '@/components/ui/tabs';
import { Page, PageHeader } from '@/components/ui/page';
import type { ReactNode } from 'react';
import { vehicleWords } from '@/lib/platform/terms';
import type { ModuleId, Space } from '@/lib/platform/types';
import { workProfile } from '@/lib/platform/work';

/*
 * Business settings, as a handful of plain sections instead of one long form. Each answers one
 * question an owner actually has ("What must employees record on a receipt?"), shows what's true
 * now, and changes only that. Sections for tools that are off step aside.
 */

export type SettingsSection =
  'overview' | 'basics' | 'work' | 'receipts' | 'mileage' | 'vehicles' | 'people' | 'approvals';

export function settingsSections(space: Space) {
  const all: { id: SettingsSection; label: string; path: string; module?: ModuleId }[] = [
    { id: 'overview', label: 'Overview', path: '' },
    { id: 'basics', label: 'Basics', path: '/basics' },
    { id: 'work', label: workProfile(space).plural, path: '/work', module: 'projects' },
    { id: 'receipts', label: 'Receipts', path: '/receipts', module: 'receipts' },
    { id: 'mileage', label: 'Mileage', path: '/mileage', module: 'mileage' },
    { id: 'vehicles', label: vehicleWords(space).plural, path: '/vehicles', module: 'vehicles' },
    { id: 'people', label: 'People', path: '/people', module: 'people' },
    { id: 'approvals', label: 'Approvals', path: '/approvals' },
  ];
  return all.filter((section) => !section.module || space.modules.includes(section.module));
}

/** A settings page: its title, the sections as tabs, then the page. */
export function SettingsPage({
  space,
  active,
  title,
  description,
  children,
  wide,
}: {
  space: Space;
  active: SettingsSection;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const base = `/${space.slug}/settings`;
  return (
    <Page wide={wide}>
      <PageHeader
        back={active === 'overview' ? undefined : { href: base, label: 'Business settings' }}
        title={title}
        description={description}
        className="!mb-4 lg:!mb-5"
      />
      <Tabs
        className="mb-6"
        active={active}
        items={settingsSections(space).map((section) => ({
          id: section.id,
          label: section.label,
          href: `${base}${section.path}`,
        }))}
      />
      {children}
    </Page>
  );
}
