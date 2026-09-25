import 'server-only';
import { perspectives, seed } from '@/lib/data/demo/seed';
import { dataBackend } from '@/lib/data';
import { readConfig } from '@/lib/data/demo/config';
import { readJournal } from '@/lib/data/demo/journal';
import { changesSinceSeed, personaIds, resetAllowed } from '@/lib/data/supabase/dev';
import type { Workspace } from '@/lib/identity/types';
import { roles } from '@/lib/platform/roles';
import type { Person, Role, Space } from '@/lib/platform/types';

export type DemoPerspective = {
  id: string;
  personId: string;
  spaceSlug: string;
  spaceName: string;
  space: Pick<Space, 'id' | 'slug' | 'brand' | 'name' | 'kind'>;
  role: Role;
  roleLabel: string;
  title: string;
  note: string;
};

export type DemoModel = {
  personId: string;
  spaceSlug: string;
  changes: number;
  canReset: boolean;
  people: { person: Person; perspectives: DemoPerspective[] }[];
};

/** Everything the Preview As control needs. Built only when the identity source is the demo. */
export async function demoModel(workspace: Workspace): Promise<DemoModel> {
  const data = seed();
  // On real data the people are the seeded personas; the bar speaks in persona keys either way.
  const real = dataBackend() === 'supabase';
  const [changes, ids] = real
    ? await Promise.all([changesSinceSeed(), personaIds()])
    : [(await readJournal()).length + (await readConfig()).changes, null];
  const personaKey = ids
    ? ([...ids].find(([, id]) => id === workspace.person.id)?.[0] ?? '')
    : workspace.person.id;
  const byPerson = new Map<string, DemoPerspective[]>();
  for (const item of perspectives) {
    const person = data.people.find((entry) => entry.id === item.personId)!;
    const space =
      item.spaceSlug === 'personal'
        ? data.spaces.find((entry) => entry.kind === 'personal' && entry.ownerId === person.id)!
        : data.spaces.find((entry) => entry.slug === item.spaceSlug)!;
    const membership = data.memberships.find(
      (entry) => entry.personId === person.id && entry.spaceId === space.id,
    )!;
    const list = byPerson.get(person.id) ?? [];
    list.push({
      id: item.id,
      personId: person.id,
      spaceSlug: item.spaceSlug,
      spaceName: space.name,
      space: {
        id: space.id,
        slug: space.slug,
        brand: space.brand,
        name: space.name,
        kind: space.kind,
      },
      role: membership.role,
      roleLabel: space.kind === 'personal' ? 'Personal' : roles[membership.role].label,
      title: membership.title,
      note: item.note,
    });
    byPerson.set(person.id, list);
  }
  return {
    personId: personaKey,
    spaceSlug: workspace.space.slug,
    changes,
    canReset: !real || resetAllowed(),
    people: [...byPerson.entries()].map(([id, list]) => ({
      person: data.people.find((entry) => entry.id === id)!,
      perspectives: list,
    })),
  };
}
