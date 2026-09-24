import 'server-only';
import { perspectives, seed } from '@/lib/data/demo/seed';
import { readJournal } from '@/lib/data/demo/journal';
import type { Workspace } from '@/lib/identity/types';
import { roles } from '@/lib/platform/roles';
import type { Person, Role, Space } from '@/lib/platform/types';

export type DemoPerspective = {
  id: string;
  personId: string;
  spaceSlug: string;
  spaceName: string;
  space: Pick<Space, 'id' | 'brand' | 'name' | 'kind'>;
  role: Role;
  roleLabel: string;
  title: string;
  note: string;
};

export type DemoModel = {
  personId: string;
  spaceSlug: string;
  changes: number;
  people: { person: Person; perspectives: DemoPerspective[] }[];
};

/** Everything the Preview As control needs. Built only when the identity source is the demo. */
export async function demoModel(workspace: Workspace): Promise<DemoModel> {
  const data = seed();
  const changes = (await readJournal()).length;
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
      space: { id: space.id, brand: space.brand, name: space.name, kind: space.kind },
      role: membership.role,
      roleLabel: space.kind === 'personal' ? 'Personal' : roles[membership.role].label,
      title: membership.title,
      note: item.note,
    });
    byPerson.set(person.id, list);
  }
  return {
    personId: workspace.person.id,
    spaceSlug: workspace.space.slug,
    changes,
    people: [...byPerson.entries()].map(([id, list]) => ({
      person: data.people.find((entry) => entry.id === id)!,
      perspectives: list,
    })),
  };
}
