import { BASE_PATH } from '@/lib/base-path';
import { getRepository } from '@/lib/data';
import { LINK_SECONDS, StorageUnavailableError, storageOf } from '@/lib/files/storage';
import { getWorkspace } from '@/lib/identity';

/**
 * Open or download one file: `/{space}/files/{id}/open` or `/download`. Access is checked now —
 * the person must be a current member who can see this file (the repository reads it as them,
 * under Row Level Security) — and only then does Storage, asked as the same person, give a
 * one-minute link, which this sends the browser to. The id alone opens nothing; the link is
 * never stored. A removed member, another Space's file or a made-up id all get the same answer.
 */
export async function GET(_: Request, ctx: RouteContext<'/[space]/files/[id]/[action]'>) {
  const { space, id, action } = await ctx.params;
  if (action !== 'open' && action !== 'download') return unavailable(space, 404);
  const workspace = await getWorkspace(space);
  if (!workspace) return unavailable(space, 404);
  const file = await getRepository(workspace)
    .file(id)
    .catch(() => null);
  if (!file || (file.status ?? 'ready') !== 'ready' || !file.storagePath)
    return unavailable(space, 404);
  // Trash opens only for whoever can bring it back.
  if (
    file.deletedAt &&
    file.createdBy !== workspace.person.id &&
    !workspace.permissions.includes('files.manage')
  )
    return unavailable(space, 404);
  const storage = storageOf(workspace, file.storage);
  if (!storage) return unavailable(space, 404);
  try {
    const link = await storage.link(
      file.storagePath,
      LINK_SECONDS.open,
      action === 'download' ? file.name : undefined,
    );
    if (!link) return unavailable(space, 404);
    return new Response(null, {
      status: 302,
      headers: { location: link, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  } catch (error) {
    if (error instanceof StorageUnavailableError) return unavailable(space, 503);
    throw error;
  }
}

function unavailable(space: string, status: 404 | 503) {
  const text =
    status === 503
      ? 'Hyphy couldn’t reach file storage just now. Try again in a moment.'
      : 'This file isn’t available to you. It may have been deleted, or you no longer have access.';
  const back = `${BASE_PATH}/${encodeURIComponent(space)}/files`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>File not available · Hyphy</title><body style="font:16px/1.5 system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f4ef;color:#16150f"><main style="max-width:360px;padding:24px"><h1 style="font-size:20px">File not available</h1><p>${text}</p><p><a href="${back}" style="color:#3240ff">Back to Files</a></p></main>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
}
