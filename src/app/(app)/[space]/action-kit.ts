import 'server-only';
import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { DataUnavailableError, RuleError } from '@/lib/data/repository';
import { StorageUnavailableError } from '@/lib/files/storage';
import { getWorkspace, PermissionError, requirePermission } from '@/lib/identity';
import type { Workspace } from '@/lib/identity/types';
import { SettingsError } from '@/lib/platform/business-settings';
import type { Permission } from '@/lib/platform/roles';
import { isModuleReady, tools } from '@/lib/platform/tools';
import type { ModuleId } from '@/lib/platform/types';

/*
 * What every server action shares: resolve the Workspace from the URL, check the permission on
 * the server, and turn refusals into sentences. Used by actions.ts and file-actions.ts.
 */

export type ActionResult =
  | { ok: true; id?: string; message?: string; link?: string; href?: string }
  | { ok: false; error: string };

export class InputError extends Error {}

export async function open(slug: string, permission?: Permission) {
  const workspace = await getWorkspace(slug);
  if (!workspace) throw new InputError('You’re not a member of this Space.');
  if (permission) requirePermission(workspace, permission);
  return { workspace, repo: getRepository(workspace) };
}

export async function run(slug: string, work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const result = await work();
    revalidatePath(`/${slug}`, 'layout');
    return result;
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, error: 'Your role in this Space can’t do that.' };
    if (
      error instanceof InputError ||
      error instanceof RuleError ||
      error instanceof DataUnavailableError ||
      error instanceof StorageUnavailableError ||
      error instanceof SettingsError
    )
      return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}

export async function visibleProject(repo: ReturnType<typeof getRepository>, id: unknown) {
  if (!id) return undefined;
  const project = await repo.project(String(id));
  if (!project) throw new InputError('That project isn’t available to you.');
  return project.id;
}

export async function visibleVehicle(repo: ReturnType<typeof getRepository>, id: unknown) {
  if (!id) return undefined;
  const vehicle = await repo.vehicle(String(id));
  if (!vehicle) throw new InputError('That vehicle isn’t available to you.');
  return vehicle.id;
}

/** The tool must be on here, for this person — a switched-off tool takes no new records. */
export function requireTool(workspace: Workspace, module: ModuleId) {
  if (!isModuleReady(module, workspace.space, workspace.membership))
    throw new InputError(
      `${tools.find((tool) => tool.module === module)?.name ?? 'That tool'} is off in ${workspace.space.name}.`,
    );
}
