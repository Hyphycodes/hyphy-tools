import 'server-only';
import type { ShellModel } from '@/components/shell/model';
import type { Repository } from '@/lib/data';
import type { Workspace } from '@/lib/identity/types';
import { currentProjectFor } from '@/lib/insights';
import { createActionsFor } from '@/lib/platform/actions';
import { navigationFor } from '@/lib/platform/navigation';
import { plans } from '@/lib/platform/plans';
import { workProfile } from '@/lib/platform/work';
import { roles } from '@/lib/platform/roles';

export function roleLabel(workspace: Pick<Workspace, 'space' | 'membership'>) {
  return workspace.space.kind === 'personal' ? 'Personal' : roles[workspace.membership.role].label;
}

/** Everything the client shell needs, computed once per request on the server. */
export async function buildShellModel(workspace: Workspace, repo: Repository): Promise<ShellModel> {
  const { space, membership, person, session } = workspace;
  const [inbox, projects, vehicles, members, trips, activity, pins] = await Promise.all([
    repo.inbox(),
    repo.projects(),
    repo.vehicles(),
    repo.members(),
    repo.mileage({ createdBy: person.id }),
    repo.activity({ actorId: person.id, limit: 12 }),
    repo.pins(),
  ]);
  const seen = new Set<string>();
  const recentTrips = [...trips]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((trip) => {
      const key = `${trip.from}→${trip.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map((trip) => ({
      from: trip.from,
      to: trip.to,
      miles: trip.miles,
      roundTrip: Boolean(trip.roundTrip),
      purpose: trip.purpose,
      vehicleId: trip.vehicleId,
      projectId: trip.projectId,
    }));
  const nav = navigationFor(space, membership);
  // Pinned tools lead the sidebar's tool list, in the order they were pinned.
  const pinned = pins.filter((pin) => pin.type === 'tool').map((pin) => pin.id);
  const rank = (id: string) => (pinned.includes(id) ? pinned.indexOf(id) : pinned.length);
  nav.tools = [...nav.tools]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((tool) => ({ ...tool, pinned: pinned.includes(tool.id) }));
  const shop =
    space.slug === 'abc-construction'
      ? ['Shop, Oak Brook']
      : space.slug === 'hyphy'
        ? ['Studio, West Town']
        : ['Home'];
  return {
    person,
    space,
    role: membership.role,
    roleLabel: roleLabel(workspace),
    title: space.kind === 'personal' ? 'Personal Space' : membership.title,
    planName: plans[space.plan].name,
    permissions: workspace.permissions,
    spaces: session.memberships.map((item) => ({
      id: item.space.id,
      slug: item.space.slug,
      name: item.space.name,
      kind: item.space.kind,
      brand: item.space.brand,
      descriptor: item.space.descriptor,
      roleLabel: item.space.kind === 'personal' ? 'Personal' : roles[item.role].label,
    })),
    nav,
    inboxCount: inbox.length,
    actions: createActionsFor(space, membership),
    options: {
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
      })),
      vehicles: vehicles.map((vehicle) => ({
        id: vehicle.id,
        name: vehicle.name,
        assignedTo: vehicle.assignedTo,
        odometer: vehicle.odometer,
        fuelCardLast4: vehicle.fuelCardLast4,
      })),
      people: members
        .filter((member) => member.status === 'active')
        .map((member) => ({
          id: member.personId,
          name: member.person.name,
          initials: member.person.initials,
          hue: member.person.hue,
          role: member.role,
        })),
      currentProjectId: currentProjectFor(person.id, projects, activity)?.id,
      recentTrips,
      places: [
        ...shop,
        ...projects
          .filter((project) => project.status !== 'done' && project.location)
          .map((project) => project.name),
      ],
    },
    labels: {
      project: workProfile(space).singular,
      projects: workProfile(space).plural,
    },
  };
}
