import 'server-only';
import type { IconName } from '@/components/ui/icon';
import type { Repository } from '@/lib/data';
import type { Workspace } from '@/lib/identity/types';
import type { CreateAction } from '@/lib/platform/actions';
import type { NavModel } from '@/lib/platform/navigation';
import { inboxLook } from '@/lib/platform/inbox';
import { roles } from '@/lib/platform/roles';
import { availability, tools, toolName } from '@/lib/platform/tools';
import { workProfile } from '@/lib/platform/work';
import type { DemoModel } from '@/lib/demo/model';

export type SearchItem = {
  id: string;
  group:
    | 'Needs attention'
    | 'Actions'
    | 'Go to'
    | 'Tools'
    | 'Projects'
    | 'Vehicles'
    | 'People'
    | 'Receipts'
    | 'Files'
    | 'Spaces'
    | 'Preview as';
  title: string;
  subtitle?: string;
  keywords?: string;
  href?: string;
  create?: CreateAction['id'];
  preview?: { personId: string; space: string };
  /** Breaks ties in ranking: active work above finished work. */
  boost?: number;
  visual:
    | { kind: 'icon'; icon: IconName }
    /** A record's own color: a project's, a vehicle's, the tool that made a file. */
    | { kind: 'tint'; icon: IconName; bg: string; fg: string }
    /** A photo shows itself. */
    | { kind: 'thumb'; preview: string }
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
  const [projects, vehicles, members, files, inbox, receipts, directory] = await Promise.all([
    repo.projects(),
    repo.vehicles(),
    nav.space.some((item) => item.id === 'people') ? repo.members() : Promise.resolve([]),
    repo.files(),
    repo.inbox(),
    tools.some(
      (tool) =>
        tool.id === 'receipts' && availability(tool, space, workspace.membership).state === 'ready',
    )
      ? repo.receipts()
      : Promise.resolve([]),
    repo.directory(),
  ]);
  const projectWord = workProfile(space).singular;
  const nameOf = (id?: string) => directory.find((person) => person.id === id)?.firstName;
  const projectName = (id?: string) => projects.find((project) => project.id === id)?.name;

  return [
    ...inbox.slice(0, 3).map<SearchItem>((item) => ({
      id: `inbox-${item.id}`,
      group: 'Needs attention',
      title: item.title,
      subtitle: [nameOf(item.fromId), item.detail].filter(Boolean).join(' · '),
      keywords: 'inbox approve attention',
      href: `${base}/inbox`,
      boost: item.priority === 'high' ? 0.4 : 0,
      visual: (({ icon, bg, fg }) => ({ kind: 'tint' as const, icon, bg, fg }))(inboxLook(item)),
    })),
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
      boost: project.status === 'active' ? 0.3 : project.status === 'done' ? -0.3 : 0,
      visual: {
        kind: 'tint',
        icon: 'projects',
        bg: `color-mix(in oklab, ${project.color} 22%, white)`,
        fg: `color-mix(in oklab, ${project.color}, black 35%)`,
      },
    })),
    ...vehicles.map<SearchItem>((vehicle) => ({
      id: `vehicle-${vehicle.id}`,
      group: 'Vehicles',
      title: vehicle.name,
      subtitle: `${vehicle.year} ${vehicle.make} ${vehicle.model} · ${vehicle.plate}`,
      href: `${base}/vehicles/${vehicle.id}`,
      boost: 0.2,
      visual: {
        kind: 'tint',
        icon: 'truck',
        bg: `color-mix(in oklab, ${vehicle.color} 20%, white)`,
        fg: `color-mix(in oklab, ${vehicle.color}, black 40%)`,
      },
    })),
    ...members.map<SearchItem>((member) => ({
      id: `person-${member.personId}`,
      group: 'People',
      title: member.person.name,
      subtitle: `${member.title} · ${roles[member.role].label}`,
      keywords: member.person.email,
      href: `${base}/people/${member.personId}`,
      boost: 0.2,
      visual: { kind: 'person', initials: member.person.initials, hue: member.person.hue },
    })),
    ...receipts.slice(0, 60).map<SearchItem>((receipt) => ({
      id: `receipt-${receipt.id}`,
      group: 'Receipts',
      title: receipt.vendor,
      subtitle: [
        receipt.total ? `$${receipt.total.toFixed(2)}` : 'No total yet',
        space.kind === 'business' ? nameOf(receipt.createdBy) : undefined,
        projectName(receipt.projectId),
      ]
        .filter(Boolean)
        .join(' · '),
      keywords: `receipt expense ${receipt.category} ${receipt.status === 'submitted' ? 'pending' : receipt.status}`,
      href: `${base}/tools/receipts?receipt=${receipt.id}`,
      visual: { kind: 'tint', icon: 'receipt', bg: 'var(--color-tool-receipt)', fg: '#16150F' },
    })),
    ...files.slice(0, 80).map<SearchItem>((file) => ({
      id: `file-${file.id}`,
      group: 'Files',
      title: file.name,
      subtitle: [
        file.attachedTo
          .map((ref) =>
            ref.type === 'project'
              ? projectName(ref.id)
              : ref.type === 'vehicle'
                ? vehicles.find((vehicle) => vehicle.id === ref.id)?.name
                : undefined,
          )
          .filter(Boolean)[0],
        file.folder,
      ]
        .filter(Boolean)
        .join(' · '),
      href: `${base}/files?file=${file.id}`,
      visual:
        file.kind === 'image' && file.preview
          ? { kind: 'thumb', preview: file.preview }
          : file.kind === 'pdf'
            ? {
                kind: 'tint',
                icon: 'pdf',
                bg: 'color-mix(in oklab, var(--color-tool-pdf) 22%, white)',
                fg: '#B8401C',
              }
            : {
                kind: 'tint',
                icon:
                  file.kind === 'archive'
                    ? 'archive'
                    : file.kind === 'image'
                      ? 'image'
                      : 'file-text',
                bg: 'color-mix(in oklab, var(--color-tool-files) 40%, white)',
                fg: '#4B3A8C',
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
