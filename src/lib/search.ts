import 'server-only';
import type { IconName } from '@/components/ui/icon';
import type { Repository } from '@/lib/data';
import type { Workspace } from '@/lib/identity/types';
import type { CreateAction } from '@/lib/platform/actions';
import type { NavModel } from '@/lib/platform/navigation';
import { roles } from '@/lib/platform/roles';
import { availability, tools, toolName } from '@/lib/platform/tools';
import type { DemoModel } from '@/lib/demo/model';

export type SearchItem = {
  id: string;
  group:
    | 'Actions'
    | 'Go to'
    | 'Tools'
    | 'Projects'
    | 'Vehicles'
    | 'People'
    | 'Files'
    | 'Spaces'
    | 'Preview as';
  title: string;
  subtitle?: string;
  keywords?: string;
  href?: string;
  create?: CreateAction['id'];
  preview?: { personId: string; space: string };
  visual:
    | { kind: 'icon'; icon: IconName }
    | { kind: 'tool'; icon: IconName; color: string; ink: 'dark' | 'light' }
    | { kind: 'person'; initials: string; hue: string }
    | {
        kind: 'space';
        monogram: string;
        color: string;
        ink: 'dark' | 'light';
        round: boolean;
        spark: boolean;
      };
};

/**
 * What the command bar can find in this Space — only what this person can already see, because
 * it's built from the same scoped repository. Production search would query instead of listing.
 */
export async function buildSearchIndex(
  workspace: Workspace,
  repo: Repository,
  nav: NavModel,
  actions: CreateAction[],
  demo: DemoModel | null,
): Promise<SearchItem[]> {
  const { space } = workspace;
  const base = `/${space.slug}`;
  const [projects, vehicles, members, files] = await Promise.all([
    repo.projects(),
    repo.vehicles(),
    nav.space.some((item) => item.id === 'people') ? repo.members() : Promise.resolve([]),
    repo.files(),
  ]);
  const projectWord = space.labels?.projects?.singular ?? 'Project';

  return [
    ...actions.map<SearchItem>((action) => ({
      id: `action-${action.id}`,
      group: 'Actions',
      title: action.label,
      subtitle: action.hint,
      keywords: `create new add ${action.toolId}`,
      ...(action.target.type === 'form'
        ? { create: action.id }
        : { href: `${base}${action.target.path}` }),
      visual: { kind: 'tool', icon: action.icon, color: action.color, ink: action.ink },
    })),
    ...[...nav.primary, ...nav.space, ...(nav.settings ? [nav.settings] : [])].map<SearchItem>(
      (item) => ({
        id: `nav-${item.id}`,
        group: 'Go to',
        title: item.label,
        href: item.href,
        keywords: 'go open page',
        visual: { kind: 'icon', icon: item.icon },
      }),
    ),
    ...tools
      .filter((tool) => tool.kind !== 'module' && tool.path)
      .filter((tool) => availability(tool, space, workspace.membership).state === 'ready')
      .map<SearchItem>((tool) => ({
        id: `tool-${tool.id}`,
        group: 'Tools',
        title: toolName(tool, space),
        subtitle: tool.tagline,
        keywords: tool.description,
        href: `${base}${tool.path}`,
        visual: { kind: 'tool', icon: tool.icon, color: tool.color, ink: tool.ink },
      })),
    ...projects.map<SearchItem>((project) => ({
      id: `project-${project.id}`,
      group: 'Projects',
      title: project.name,
      subtitle: [projectWord, project.location, project.client].filter(Boolean).join(' · '),
      keywords: project.summary,
      href: `${base}/projects/${project.id}`,
      visual: { kind: 'icon', icon: 'projects' },
    })),
    ...vehicles.map<SearchItem>((vehicle) => ({
      id: `vehicle-${vehicle.id}`,
      group: 'Vehicles',
      title: vehicle.name,
      subtitle: `${vehicle.year} ${vehicle.make} ${vehicle.model} · ${vehicle.plate}`,
      href: `${base}/vehicles/${vehicle.id}`,
      visual: { kind: 'icon', icon: 'truck' },
    })),
    ...members.map<SearchItem>((member) => ({
      id: `person-${member.personId}`,
      group: 'People',
      title: member.person.name,
      subtitle: `${member.title} · ${roles[member.role].label}`,
      keywords: member.person.email,
      href: `${base}/people/${member.personId}`,
      visual: { kind: 'person', initials: member.person.initials, hue: member.person.hue },
    })),
    ...files.slice(0, 80).map<SearchItem>((file) => ({
      id: `file-${file.id}`,
      group: 'Files',
      title: file.name,
      subtitle: file.folder,
      href: `${base}/files?file=${file.id}`,
      visual: {
        kind: 'icon',
        icon: file.kind === 'image' ? 'image' : file.kind === 'archive' ? 'archive' : 'file-text',
      },
    })),
    ...workspace.session.memberships
      .filter((item) => item.space.id !== space.id)
      .map<SearchItem>((item) => ({
        id: `space-${item.space.id}`,
        group: 'Spaces',
        title: `Switch to ${item.space.name}`,
        subtitle: item.space.kind === 'personal' ? 'Your personal Space' : roles[item.role].label,
        href: `/${item.space.slug}`,
        visual: {
          kind: 'space',
          monogram: item.space.brand.monogram,
          color: item.space.brand.color,
          ink: item.space.brand.ink,
          round: item.space.kind === 'personal',
          spark: item.space.id === 'sp_hyphy',
        },
      })),
    ...(demo?.people.flatMap((entry) =>
      entry.perspectives.map<SearchItem>((view) => ({
        id: `preview-${view.id}`,
        group: 'Preview as',
        title: `${entry.person.name} — ${view.spaceName}`,
        subtitle: `${view.roleLabel} · ${view.note}`,
        keywords: 'demo persona switch preview as',
        preview: { personId: entry.person.id, space: view.spaceSlug },
        visual: { kind: 'person', initials: entry.person.initials, hue: entry.person.hue },
      })),
    ) ?? []),
  ];
}
