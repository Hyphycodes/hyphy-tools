import 'server-only';
import type { ShellModel } from '@/components/shell/model';
import type { Repository } from '@/lib/data';
import type { Workspace } from '@/lib/identity/types';
import { createActionsFor } from '@/lib/platform/actions';
import { navigationFor } from '@/lib/platform/navigation';
import { plans } from '@/lib/platform/plans';
import { roles } from '@/lib/platform/roles';

export function roleLabel(workspace: Pick<Workspace, 'space' | 'membership'>) {
  return workspace.space.kind === 'personal' ? 'Personal' : roles[workspace.membership.role].label;
}

/** Everything the client shell needs, computed once per request on the server. */
export async function buildShellModel(workspace: Workspace, repo: Repository): Promise<ShellModel> {
  const { space, membership, person, session } = workspace;
  const [inbox, projects, vehicles, members] = await Promise.all([
    repo.inbox(),
    repo.projects(),
    repo.vehicles(),
    repo.members(),
  ]);
  const nav = navigationFor(space, membership);
  const shop =
    space.id === 'sp_abc'
      ? ['Shop, Oak Brook']
      : space.id === 'sp_hyphy'
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
      places: [
        ...shop,
        ...projects
          .filter((project) => project.status !== 'done' && project.location)
          .map((project) => project.name),
      ],
    },
    labels: {
      project: space.labels?.projects?.singular ?? 'Project',
      projects: space.labels?.projects?.plural ?? 'Projects',
    },
  };
}
