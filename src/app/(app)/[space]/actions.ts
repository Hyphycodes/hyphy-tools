'use server';
import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import type { FileInput } from '@/lib/data/repository';
import { getWorkspace, PermissionError, requirePermission } from '@/lib/identity';
import type { Workspace } from '@/lib/identity/types';
import type { Permission } from '@/lib/platform/roles';
import { ROLE_ORDER } from '@/lib/platform/roles';
import { tools } from '@/lib/platform/tools';
import type {
  AttachmentRef,
  FileKind,
  LinkPage,
  ModuleId,
  ProjectStatus,
  ReceiptCategory,
  Role,
} from '@/lib/platform/types';

/*
 * Every change goes through here: resolve the Workspace from the URL, check the permission on
 * the server, validate, then write through the scoped repository. The same functions will run
 * unchanged against Supabase, where RLS checks everything a second time.
 */

export type ActionResult =
  { ok: true; id?: string; message?: string } | { ok: false; error: string };

class InputError extends Error {}

async function open(slug: string, permission?: Permission) {
  const workspace = await getWorkspace(slug);
  if (!workspace) throw new InputError('You’re not a member of this Space.');
  if (permission) requirePermission(workspace, permission);
  return { workspace, repo: getRepository(workspace) };
}

async function run(slug: string, work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const result = await work();
    revalidatePath(`/${slug}`, 'layout');
    return result;
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, error: 'Your role in this Space can’t do that.' };
    if (error instanceof InputError) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}

/* ---------- validation ---------- */

type Input = Record<string, unknown>;

function text(input: Input, key: string, { max = 200, required = true } = {}) {
  const value = typeof input[key] === 'string' ? (input[key] as string).trim() : '';
  if (!value && required) throw new InputError(`Add ${key === 'name' ? 'a name' : `the ${key}`}.`);
  if (value.length > max) throw new InputError(`That ${key} is too long.`);
  return value || undefined;
}

function number(input: Input, key: string, { min = 0, max = 1e9, required = false } = {}) {
  const raw = input[key];
  if (raw === '' || raw === undefined || raw === null) {
    if (required) throw new InputError(`Add the ${key}.`);
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new InputError(`Check the ${key}.`);
  return value;
}

function date(input: Input, key: string, required = true) {
  const raw = typeof input[key] === 'string' ? (input[key] as string) : '';
  if (!raw) {
    if (required) throw new InputError(`Add the ${key}.`);
    return undefined;
  }
  // Date-only values are read as local noon so they don't slip a day across timezones.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00-05:00`) : new Date(raw);
  if (Number.isNaN(value.getTime())) throw new InputError(`Check the ${key}.`);
  return value.toISOString();
}

function oneOf<T extends string>(
  input: Input,
  key: string,
  options: readonly T[],
  fallback?: T,
): T {
  const value = input[key];
  if (options.includes(value as T)) return value as T;
  if (fallback) return fallback;
  throw new InputError(`Choose a ${key}.`);
}

async function visibleProject(repo: ReturnType<typeof getRepository>, id: unknown) {
  if (!id) return undefined;
  const project = await repo.project(String(id));
  if (!project) throw new InputError('That project isn’t available to you.');
  return project.id;
}

async function visibleVehicle(repo: ReturnType<typeof getRepository>, id: unknown) {
  if (!id) return undefined;
  const vehicle = await repo.vehicle(String(id));
  if (!vehicle) throw new InputError('That vehicle isn’t available to you.');
  return vehicle.id;
}

/* ---------- actions ---------- */

const CATEGORIES: ReceiptCategory[] = [
  'fuel',
  'materials',
  'meals',
  'supplies',
  'equipment',
  'other',
];

export async function createReceipt(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'expenses.submit');
    const draft = input.draft === true;
    const receipt = await repo.createReceipt({
      vendor: text(input, 'vendor', { max: 80 })!,
      category: oneOf(input, 'category', CATEGORIES, 'other'),
      total: number(input, 'total', { min: 0, max: 100000, required: !draft }) ?? 0,
      date: date(input, 'date')!,
      gallons: number(input, 'gallons', { max: 500 }),
      odometer: number(input, 'odometer', { max: 2_000_000 }),
      vehicleId: await visibleVehicle(repo, input.vehicleId),
      projectId: await visibleProject(repo, input.projectId),
      paymentMethod: text(input, 'paymentMethod', { max: 60, required: false }),
      notes: text(input, 'notes', { max: 500, required: false }),
      draft,
    });
    const business = workspace.space.kind === 'business';
    return {
      ok: true,
      id: receipt.id,
      message:
        receipt.status === 'submitted'
          ? 'Sent for approval'
          : draft
            ? 'Saved as a draft'
            : business
              ? 'Filed and approved'
              : 'Saved to your receipts',
    };
  });
}

export async function createMileage(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo } = await open(slug, 'expenses.submit');
    const entry = await repo.createMileage({
      date: date(input, 'date')!,
      from: text(input, 'from', { max: 120 })!,
      to: text(input, 'to', { max: 120 })!,
      miles: number(input, 'miles', { min: 0.1, max: 2000, required: true })!,
      roundTrip: input.roundTrip === true,
      purpose: text(input, 'purpose', { max: 200, required: false }) ?? '',
      vehicleId: await visibleVehicle(repo, input.vehicleId),
      projectId: await visibleProject(repo, input.projectId),
    });
    return {
      ok: true,
      id: entry.id,
      message: entry.status === 'submitted' ? 'Sent for approval' : 'Trip saved',
    };
  });
}

const STATUSES: ProjectStatus[] = ['planning', 'active', 'on-hold', 'done'];

export async function createProject(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'projects.manage');
    const members = await repo.members();
    const ids = new Set(members.map((member) => member.personId));
    const team = Array.isArray(input.teamIds)
      ? input.teamIds.map(String).filter((id) => ids.has(id))
      : [];
    const lead = ids.has(String(input.leadId)) ? String(input.leadId) : workspace.person.id;
    const project = await repo.createProject({
      name: text(input, 'name', { max: 80 })!,
      location: text(input, 'location', { max: 120, required: false }),
      client: text(input, 'client', { max: 80, required: false }),
      summary: text(input, 'summary', { max: 400, required: false }) ?? '',
      dueDate: date(input, 'dueDate', false),
      leadId: lead,
      teamIds: Array.from(new Set([lead, ...team])),
      budget: number(input, 'budget', { max: 1e8 }),
      status: oneOf(input, 'status', STATUSES, 'planning'),
    });
    return { ok: true, id: project.id };
  });
}

export async function invitePerson(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'people.manage');
    const role = oneOf<Role>(input, 'role', ROLE_ORDER);
    // Only an owner can hand out owner or admin.
    if ((role === 'owner' || role === 'admin') && workspace.membership.role !== 'owner')
      throw new InputError('Only an owner can add owners or admins.');
    const email = text(input, 'email', { max: 120 })!;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Check the email address.');
    const projects = await repo.projects();
    const projectIds = Array.isArray(input.projectIds)
      ? input.projectIds.map(String).filter((id) => projects.some((project) => project.id === id))
      : [];
    if (role === 'guest' && projectIds.length === 0)
      throw new InputError('Pick at least one project a guest can see.');
    const member = await repo.invite({
      name: text(input, 'name', { max: 80 })!,
      email,
      role,
      title:
        text(input, 'title', { max: 80, required: false }) ??
        (role === 'guest' ? 'Guest' : 'Team member'),
      projectIds: projectIds.length ? projectIds : undefined,
    });
    return {
      ok: true,
      id: member.personId,
      message: `Invite ready for ${member.person.firstName}`,
    };
  });
}

export async function createVehicle(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo } = await open(slug, 'vehicles.manage');
    const members = await repo.members();
    const assignedTo = members.some((member) => member.personId === input.assignedTo)
      ? String(input.assignedTo)
      : undefined;
    const vehicle = await repo.createVehicle({
      name: text(input, 'name', { max: 40 })!,
      year: number(input, 'year', { min: 1980, max: 2030, required: true })!,
      make: text(input, 'make', { max: 40 })!,
      model: text(input, 'model', { max: 60 })!,
      plate: text(input, 'plate', { max: 16, required: false }) ?? '—',
      fuel: oneOf(input, 'fuel', ['gas', 'diesel', 'electric'] as const, 'gas'),
      odometer: number(input, 'odometer', { max: 2_000_000 }) ?? 0,
      assignedTo,
    });
    return { ok: true, id: vehicle.id };
  });
}

const KINDS: FileKind[] = ['pdf', 'image', 'doc', 'sheet', 'archive'];

export async function addFiles(
  slug: string,
  input: { files: Input[]; attachTo?: AttachmentRef | null; folder?: string },
) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'files.upload');
    if (!Array.isArray(input.files) || input.files.length === 0)
      throw new InputError('Choose at least one file.');
    if (input.files.length > 20) throw new InputError('Up to 20 files at a time.');
    let attachedTo: AttachmentRef[] = [];
    if (input.attachTo?.type === 'project')
      attachedTo = [{ type: 'project', id: (await visibleProject(repo, input.attachTo.id))! }];
    if (input.attachTo?.type === 'vehicle')
      attachedTo = [{ type: 'vehicle', id: (await visibleVehicle(repo, input.attachTo.id))! }];
    const guest = workspace.membership.role === 'guest';
    if (guest && attachedTo.length === 0)
      throw new InputError('Guests upload into a shared project.');
    const personal = workspace.space.kind === 'personal';
    const folder =
      (typeof input.folder === 'string' && input.folder.trim().slice(0, 40)) || undefined;
    const files: FileInput[] = input.files.map((file) => {
      const kind = oneOf(file, 'kind', KINDS, 'doc');
      return {
        name: text(file, 'name', { max: 140 })!,
        kind,
        size: number(file, 'size', { max: 500_000_000 }) ?? 0,
        pages: number(file, 'pages', { max: 5000 }),
        folder: folder ?? (kind === 'image' ? 'Photos' : 'Uploads'),
        attachedTo,
        access: personal ? 'private' : guest ? 'shared' : 'team',
        source: tools.some((tool) => tool.module === file.source)
          ? (file.source as ModuleId)
          : undefined,
        preview:
          kind === 'image'
            ? `linear-gradient(${120 + ((file.name as string)?.length ?? 0) * 7}deg,#d9d2c3 0%,#9a8f7d 50%,#3f3a33 100%)`
            : undefined,
      };
    });
    const saved = await repo.addFiles(files);
    return {
      ok: true,
      id: saved[0]?.id,
      message: saved.length === 1 ? 'File added' : `${saved.length} files added`,
    };
  });
}

export async function saveQrCode(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo } = await open(slug, 'tools.use');
    const hex = /^#[0-9a-f]{6}$/i;
    const code = await repo.saveQrCode({
      label: text(input, 'label', { max: 60 })!,
      content: text(input, 'content', { max: 1000 })!,
      fg: hex.test(String(input.fg)) ? String(input.fg) : '#0F0F0E',
      bg: hex.test(String(input.bg)) ? String(input.bg) : '#FFFFFF',
      placement: text(input, 'placement', { max: 60, required: false }),
    });
    return { ok: true, id: code.id, message: 'Saved to this Space' };
  });
}

const THEMES: LinkPage['theme'][] = ['paper', 'ink', 'signal', 'ember'];

export async function saveLinkPage(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo } = await open(slug, 'tools.use');
    const links = (Array.isArray(input.links) ? input.links : [])
      .slice(0, 12)
      .map((link: Input, index: number) => ({
        id: String(link.id ?? `l${index}`),
        label: text(link, 'label', { max: 60 })!,
        url: text(link, 'url', { max: 300 })!,
      }));
    const handle = (text(input, 'handle', { max: 30 }) ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    if (!handle) throw new InputError('Pick a handle with letters or numbers.');
    const page = await repo.saveLinkPage({
      id: typeof input.id === 'string' ? input.id : undefined,
      title: text(input, 'title', { max: 60 })!,
      handle,
      bio: text(input, 'bio', { max: 160, required: false }) ?? '',
      theme: oneOf(input, 'theme', THEMES, 'paper'),
      links,
    });
    return { ok: true, id: page.id, message: 'Link page saved' };
  });
}

export async function reviewItem(
  slug: string,
  table: 'receipts' | 'mileage',
  id: string,
  decision: 'approved' | 'rejected',
) {
  return run(slug, async () => {
    const { repo } = await open(slug, 'expenses.approve');
    if (table !== 'receipts' && table !== 'mileage') throw new InputError('Unknown item.');
    if (decision !== 'approved' && decision !== 'rejected')
      throw new InputError('Unknown decision.');
    await repo.review(table, id, decision);
    return { ok: true, message: decision === 'approved' ? 'Approved' : 'Returned to sender' };
  });
}

export async function resolveInboxItem(slug: string, id: string) {
  return run(slug, async () => {
    const { repo } = await open(slug);
    const item = (await repo.inbox()).find((entry) => entry.id === id);
    if (!item) throw new InputError('That item is already handled.');
    await repo.resolveInbox(id);
    return { ok: true, message: 'Marked as done' };
  });
}

export async function setModules(slug: string, modules: string[]) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'space.manage');
    const known = new Set(tools.flatMap((tool) => (tool.module ? [tool.module] : [])));
    const next = Array.from(
      new Set(modules.filter((id): id is ModuleId => known.has(id as ModuleId))),
    );
    // Files and People keep a business Space working; they can't be switched off here.
    const required: ModuleId[] =
      workspace.space.kind === 'business' ? ['files', 'people'] : ['files'];
    await repo.setModules(Array.from(new Set([...required, ...next])));
    return { ok: true, message: 'Tools updated' };
  });
}

export type { Workspace };
