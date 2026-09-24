import 'server-only';
import { notFound } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { requireWorkspace } from '@/lib/identity';
import { isModuleReady } from '@/lib/platform/tools';
import type { ModuleId } from '@/lib/platform/types';

/**
 * What nearly every page starts with: the Workspace for the URL, its repository and a name
 * lookup. Passing `module` makes the page 404 for anyone whose Space or role doesn't include it.
 */
export async function openPage(params: Promise<{ space: string }>, module?: ModuleId) {
  const workspace = await requireWorkspace((await params).space);
  if (module && !isModuleReady(module, workspace.space, workspace.membership)) notFound();
  const repo = getRepository(workspace);
  const directory = await repo.directory();
  return {
    workspace,
    repo,
    base: `/${workspace.space.slug}`,
    tz: workspace.space.timezone,
    directory,
    people: new Map(directory.map((person) => [person.id, person])),
    can: (permission: (typeof workspace.permissions)[number]) =>
      workspace.permissions.includes(permission),
  };
}
