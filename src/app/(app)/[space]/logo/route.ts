import { getRepository } from '@/lib/data';
import { LINK_SECONDS, storageOf } from '@/lib/files/storage';
import { getWorkspace } from '@/lib/identity';

/**
 * The business's logo, for its members: `/{space}/logo`. Checked like any file (current members
 * only; Storage asked as the person), then a short redirect to a signed link. The browser may
 * keep the redirect briefly — the logo changes rarely and its URL carries its file id.
 */
export async function GET(_: Request, ctx: RouteContext<'/[space]/logo'>) {
  const { space } = await ctx.params;
  const workspace = await getWorkspace(space);
  const logo = workspace?.space.logo;
  const storage = workspace && logo ? storageOf(workspace, logo.storage) : null;
  if (!workspace || !logo || !storage) return new Response(null, { status: 404 });
  const file = await getRepository(workspace)
    .file(logo.fileId)
    .catch(() => null);
  const link = file?.storagePath
    ? await storage.link(file.storagePath, LINK_SECONDS.logo).catch(() => null)
    : null;
  if (!link) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { location: link, 'cache-control': 'private, max-age=600' },
  });
}
