'use server';
import { dataBackend, type Repository } from '@/lib/data';
import {
  checkUpload,
  cleanDisplayName,
  HEAD_BYTES,
  bytesMatch,
  objectName,
  renamed,
  storagePath,
  typeByMime,
  type UploadPurpose,
} from '@/lib/files/rules';
import { storageFor, storageOf, type UploadTarget } from '@/lib/files/storage';
import { requirePermission } from '@/lib/identity';
import type { Workspace } from '@/lib/identity/types';
import type { AttachmentRef, FileRecord, FileSource, ModuleId } from '@/lib/platform/types';
import {
  InputError,
  open,
  requireTool,
  run,
  visibleProject,
  visibleVehicle,
  type ActionResult,
} from './action-kit';

/*
 * The one upload pipeline every part of Hyphy uses — Files, a project's photos, a receipt's photo,
 * the PDF, image and QR tools, the business logo. docs/FILES.md, "Upload lifecycle":
 *
 *   1. prepareUpload  the server decides everything that matters — the Space (the URL's, checked
 *                     against the person's membership), the record it belongs to (visible to
 *                     them), the path (made here from the Space and a new file id), the type and
 *                     size (checked against the allowlist, the file's first bytes included) — and
 *                     writes a `pending` record, then asks Storage, as the person, for a one-use
 *                     upload link to exactly that path.
 *   2. the browser    sends the bytes there (with progress, and a Cancel).
 *   3. finishUpload   reads the stored file's first bytes again, then the database checks the
 *                     bytes are there at the size and type promised and marks it `ready`. Only
 *                     now can anyone else see it, and its activity is written.
 *
 * Anything that goes wrong on the way leaves no healthy-looking file behind: an unfinished record
 * is only its uploader's, is cleaned up when they cancel, retry or next upload, and failed bytes
 * are removed before their record. The browser never names a Space, a path or a storage key.
 */

type Input = Record<string, unknown>;

export type UploadRequest = {
  name: string;
  size: number;
  /** The browser's type. A hint only. */
  mime: string;
  /** The file's first bytes (base64), read by the browser. Checked again once stored. */
  head: string;
  purpose: UploadPurpose;
  /** A tool's result (`pdf`, `images`, `qr`). Receipts and logos set their own. */
  source?: string;
  attachTo?: AttachmentRef | null;
  folder?: string;
  sha256?: string;
  width?: number;
  height?: number;
  pages?: number;
};

export type PreparedUpload =
  { ok: true; fileId: string; name: string; target: UploadTarget } | { ok: false; error: string };

export type FinishedUpload =
  | { ok: true; fileId: string; name: string; href: string }
  | { ok: false; error: string; retry: boolean };

/** Unfinished uploads older than this are this person's to clean up on their next upload. */
const STALE_MS = 60 * 60 * 1000;
/** How many uploads one person may have waiting at once. */
const MAX_PENDING = 25;

const TOOL_SOURCES: ModuleId[] = ['pdf', 'images', 'qr'];

function decodeHead(value: unknown) {
  if (typeof value !== 'string' || value.length > Math.ceil((HEAD_BYTES * 4) / 3) + 8)
    throw new InputError('Choose the file again.');
  return new Uint8Array(Buffer.from(value, 'base64')).slice(0, HEAD_BYTES);
}

const whole = (value: unknown, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : undefined;

/** Removes an unfinished upload of this person's: bytes first, then the record. */
async function forget(workspace: Workspace, repo: Repository, file: FileRecord) {
  const storage = storageOf(workspace, file.storage);
  if (storage && file.storagePath) await storage.remove([file.storagePath]);
  await repo.discardUpload(file.id);
}

export async function prepareUpload(slug: string, input: UploadRequest): Promise<PreparedUpload> {
  let prepared: PreparedUpload | null = null;
  const result = await run(slug, async () => {
    const request = (input ?? {}) as unknown as Input;
    const purpose = (['file', 'photo', 'receipt', 'logo'] as const).find(
      (item) => item === request.purpose,
    );
    if (!purpose) throw new InputError('Unknown upload.');
    const { workspace, repo } = await open(slug, 'files.upload');
    const personal = workspace.space.kind === 'personal';
    const guest = workspace.membership.role === 'guest';

    const name = cleanDisplayName(String(request.name ?? ''));
    const check = checkUpload(
      {
        name,
        size: Number(request.size),
        mime: typeof request.mime === 'string' ? request.mime : '',
        head: decodeHead(request.head),
      },
      purpose,
    );
    if (!check.ok) throw new InputError(check.problem);
    const type = check.type;

    // What the file is for decides where it goes and who sees it — never the browser.
    let source: FileSource | undefined;
    let access: FileRecord['access'] = personal ? 'private' : guest ? 'shared' : 'team';
    let folder =
      (typeof request.folder === 'string' && cleanDisplayName(request.folder, 40)) ||
      (type.kind === 'image' ? 'Photos' : 'Uploads');
    let attachedTo: AttachmentRef[] = [];
    if (purpose === 'receipt') {
      requirePermission(workspace, 'expenses.submit');
      requireTool(workspace, 'receipts');
      // A receipt's photo is its submitter's until it's on the receipt; then it follows the
      // receipt (approvers see it, nobody else).
      source = 'receipts';
      access = 'private';
      folder = 'Receipts';
    } else if (purpose === 'logo') {
      requirePermission(workspace, 'space.manage');
      if (workspace.space.kind !== 'business') throw new InputError('Only businesses have a logo.');
      source = 'brand';
      access = 'team';
      folder = 'Company';
    } else {
      if (typeof request.source === 'string' && request.source) {
        const tool = TOOL_SOURCES.find((item) => item === request.source);
        if (!tool) throw new InputError('Unknown tool.');
        requireTool(workspace, tool);
        source = tool;
      }
      const target = request.attachTo as AttachmentRef | null | undefined;
      if (target?.type === 'project')
        attachedTo = [{ type: 'project', id: (await visibleProject(repo, target.id))! }];
      else if (target?.type === 'vehicle' && !guest)
        attachedTo = [{ type: 'vehicle', id: (await visibleVehicle(repo, target.id))! }];
      else if (target?.type === 'person') {
        const person = await repo.member(String(target.id));
        const self = String(target.id) === workspace.person.id;
        if (
          !person ||
          person.status !== 'active' ||
          (!self && !workspace.permissions.includes('people.manage'))
        )
          throw new InputError('You can’t add files to that person.');
        attachedTo = [{ type: 'person', id: person.personId }];
      } else if (target) throw new InputError('That isn’t something files can belong to.');
      if (guest && !attachedTo.some((ref) => ref.type === 'project'))
        throw new InputError('Guests add files to a project shared with them.');
    }

    const storage = storageFor(workspace);
    // Tidy this person's earlier unfinished uploads here, and cap how many can wait at once.
    const unfinished = await repo.myUnfinishedUploads();
    for (const file of unfinished.filter(
      (item) => Date.now() - Date.parse(item.createdAt) > STALE_MS,
    ))
      await forget(workspace, repo, file).catch(() => {});
    if (unfinished.length >= MAX_PENDING)
      throw new InputError('Too many uploads are still waiting. Let them finish, then try again.');

    const id = repo.newFileId();
    const path = storagePath(workspace.space.id, id, objectName(name, type));
    const file = await repo.startUpload({
      id,
      name,
      originalName: name,
      kind: type.kind,
      size: Number(request.size),
      mimeType: type.mime,
      folder,
      attachedTo,
      access,
      source,
      pages: whole(request.pages, 5000),
      width: whole(request.width, 100000),
      height: whole(request.height, 100000),
      sha256:
        typeof request.sha256 === 'string' && /^[0-9a-f]{64}$/.test(request.sha256)
          ? request.sha256
          : undefined,
      storage: storage.storage,
      // Demo Mode's cookie journal is small, and its device store is keyed by id, not path.
      storagePath: dataBackend() === 'demo' ? undefined : path,
    });
    try {
      const target = await storage.uploadTarget(path);
      prepared = { ok: true, fileId: file.id, name, target };
    } catch (error) {
      await repo.discardUpload(file.id).catch(() => {});
      throw error;
    }
    return { ok: true, id: file.id };
  });
  if (!result.ok) return result;
  return prepared!;
}

export async function finishUpload(slug: string, fileId: string): Promise<FinishedUpload> {
  let finished: FinishedUpload | null = null;
  const result = await run(slug, async () => {
    const { workspace, repo } = await open(slug);
    const file = await repo.file(String(fileId));
    if (!file || file.createdBy !== workspace.person.id)
      throw new InputError('That upload isn’t yours to finish.');
    const href = `/${slug}/files?file=${file.id}`;
    if ((file.status ?? 'ready') === 'ready') {
      finished = { ok: true, fileId: file.id, name: file.name, href };
      return { ok: true };
    }
    const storage = storageOf(workspace, file.storage);
    if (storage?.storage === 'hyphy-files' && file.storagePath) {
      // What arrived must be what was promised: its first bytes are the type the record says.
      const head = await storage.head(file.storagePath, HEAD_BYTES);
      if (!head) {
        finished = { ok: false, error: 'The file didn’t arrive. Try again.', retry: true };
        return { ok: true };
      }
      const type = typeByMime(file.mimeType);
      if (!type || !bytesMatch(type, head)) {
        await forget(workspace, repo, file);
        finished = {
          ok: false,
          error: `This file isn’t really a ${type?.label ?? 'supported'} file, so Hyphy didn’t keep it.`,
          retry: false,
        };
        return { ok: true };
      }
    }
    const outcome = await repo.finishUpload(file.id);
    if (outcome === 'missing')
      finished = { ok: false, error: 'The file didn’t arrive. Try again.', retry: true };
    else if (outcome === 'mismatch') {
      await forget(workspace, repo, file);
      finished = {
        ok: false,
        error: 'What arrived wasn’t the file that was chosen, so Hyphy didn’t keep it.',
        retry: false,
      };
    } else finished = { ok: true, fileId: file.id, name: file.name, href };
    return { ok: true };
  });
  if (!result.ok) return { ok: false, error: result.error, retry: true };
  return finished!;
}

/** Stops an upload: its bytes (if any arrived) and its record go. */
export async function cancelUpload(slug: string, fileId: string): Promise<ActionResult> {
  return run(slug, async () => {
    const { workspace, repo } = await open(slug);
    const file = await repo.file(String(fileId));
    if (!file || file.createdBy !== workspace.person.id || (file.status ?? 'ready') === 'ready')
      return { ok: true };
    await forget(workspace, repo, file);
    return { ok: true, message: 'Upload cancelled' };
  });
}

/**
 * Tries an upload again without making a second record: a fresh link to the same path. (If the
 * bytes did arrive and only finishing failed, the browser just finishes again.)
 */
export async function retryUpload(slug: string, fileId: string): Promise<PreparedUpload> {
  let prepared: PreparedUpload | null = null;
  const result = await run(slug, async () => {
    const { workspace, repo } = await open(slug, 'files.upload');
    const file = await repo.file(String(fileId));
    if (!file || file.createdBy !== workspace.person.id || file.status !== 'pending')
      throw new InputError('Choose the file again.');
    const storage = storageOf(workspace, file.storage);
    if (!storage) throw new InputError('Choose the file again.');
    const target = await storage.uploadTarget(file.storagePath ?? '');
    prepared = { ok: true, fileId: file.id, name: file.name, target };
    return { ok: true };
  });
  if (!result.ok) return result;
  return prepared!;
}

/* ---------- a file's life after upload ---------- */

export async function renameFile(slug: string, fileId: string, name: string) {
  return run(slug, async () => {
    const { repo } = await open(slug);
    const file = await repo.file(String(fileId));
    if (!file) throw new InputError('That file isn’t available to you.');
    const next = renamed(file.name, String(name ?? ''));
    if (!String(name ?? '').trim()) throw new InputError('Add a name.');
    // Only the name changes: the bytes stay where they are.
    await repo.renameFile(file.id, next);
    return { ok: true, message: 'Renamed' };
  });
}

export async function trashFile(slug: string, fileId: string, trashed: boolean) {
  return run(slug, async () => {
    const { repo } = await open(slug);
    await repo.trashFile(String(fileId), trashed === true);
    return {
      ok: true,
      message: trashed ? 'Moved to Trash' : 'Restored',
      href: trashed ? `/${slug}/files` : `/${slug}/files?file=${fileId}`,
    };
  });
}

/** Deletes a file in Trash for good: its bytes from Storage first, then its record. */
export async function deleteFileForGood(slug: string, fileId: string) {
  return run(slug, async () => {
    const { workspace, repo } = await open(slug);
    const file = await repo.file(String(fileId));
    if (!file || !file.deletedAt) throw new InputError('Move it to Trash first.');
    if (file.createdBy !== workspace.person.id && !workspace.permissions.includes('files.manage'))
      throw new InputError('Only whoever added it, or someone who manages files, can delete it.');
    const storage = storageOf(workspace, file.storage);
    // The path comes from the record Hyphy made, never from the browser.
    if (storage && file.storagePath) await storage.remove([file.storagePath]);
    await repo.deleteFile(file.id);
    return { ok: true, message: 'Deleted for good' };
  });
}

/** Attach a file to one more project or vehicle — the same bytes, never a copy. */
export async function attachFile(slug: string, fileId: string, target: AttachmentRef) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug);
    let ref: AttachmentRef;
    if (target?.type === 'project')
      ref = { type: 'project', id: (await visibleProject(repo, target.id))! };
    else if (target?.type === 'vehicle' && workspace.membership.role !== 'guest')
      ref = { type: 'vehicle', id: (await visibleVehicle(repo, target.id))! };
    else throw new InputError('Choose a project or vehicle.');
    await repo.attachFile(String(fileId), ref);
    return { ok: true, message: 'Attached' };
  });
}

/**
 * The business logo: owners and admins. The new logo must be an upload they just finished; the
 * old one is deleted for good (a new object and a new reference, never an overwrite).
 */
export async function setBusinessLogo(slug: string, fileId: string | null) {
  return run(slug, async () => {
    const { workspace, repo } = await open(slug, 'space.manage');
    if (workspace.space.kind !== 'business') throw new InputError('Only businesses have a logo.');
    const previous = await repo.setLogo(fileId ? String(fileId) : null);
    if (previous) {
      const old = await repo.file(previous);
      if (old?.deletedAt) {
        const storage = storageOf(workspace, old.storage);
        try {
          if (storage && old.storagePath) await storage.remove([old.storagePath]);
          await repo.deleteFile(old.id);
        } catch {
          // It stays in Trash, where it can be deleted later.
        }
      }
    }
    return { ok: true, message: fileId ? 'Logo updated' : 'Logo removed' };
  });
}
