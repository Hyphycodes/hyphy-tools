import 'server-only';
import { BASE_PATH } from '@/lib/base-path';
import type { Workspace } from '@/lib/identity/types';
import type { FileRecord } from '@/lib/platform/types';
import { typeByMime } from './rules';
import { LINK_SECONDS, storageOf } from './storage';

/**
 * How a page may show and open one file, decided on the server for the person looking. Plain data
 * for client components. Links to open or download point at the app (`/{space}/files/{id}/open`),
 * which checks access again at the moment of the click and only then asks Storage for a
 * one-minute link — so nothing permanent, and nothing signed, is ever put in a page for later.
 */
export type FileView = {
  id: string;
  /**
   * `stored`: bytes in Hyphy's storage. `device`: Demo Mode, bytes in the browser that added it.
   * `sample`: a record from before real files (the Demo world's samples) — details only.
   * `elsewhere`: stored where this session can't reach (a Demo Mode file seen with a real account,
   * or the other way round).
   */
  state: 'stored' | 'device' | 'sample' | 'elsewhere';
  /** A short-lived link to show an image inline, made in one batch per page. */
  preview?: string;
  open?: string;
  download?: string;
  /** Whether a browser shows it in a tab (images, PDFs) or only downloads it. */
  inline: boolean;
};

export type FileViews = Record<string, FileView>;

export function fileHref(slug: string, id: string, action: 'open' | 'download') {
  return `${BASE_PATH}/${slug}/files/${id}/${action}`;
}

/**
 * Views for the files a page shows. Image previews are signed together in one request (and only
 * for images a browser can show), not one per image.
 */
export async function viewsFor(
  workspace: Pick<Workspace, 'session' | 'space'>,
  files: FileRecord[],
  { previews = true }: { previews?: boolean } = {},
): Promise<FileViews> {
  const views: FileViews = {};
  const toSign: FileRecord[] = [];
  for (const file of files) {
    const inline = Boolean(typeByMime(file.mimeType)?.inline);
    if (!file.storage) {
      views[file.id] = { id: file.id, state: 'sample', inline: false };
      continue;
    }
    const provider = storageOf(workspace, file.storage);
    if (!provider) {
      views[file.id] = { id: file.id, state: 'elsewhere', inline: false };
      continue;
    }
    if (provider.storage === 'device') {
      views[file.id] = { id: file.id, state: 'device', inline };
      continue;
    }
    views[file.id] = {
      id: file.id,
      state: 'stored',
      inline,
      open: fileHref(workspace.space.slug, file.id, 'open'),
      download: fileHref(workspace.space.slug, file.id, 'download'),
    };
    if (previews && file.kind === 'image' && inline && file.storagePath) toSign.push(file);
  }
  if (toSign.length) {
    const provider = storageOf(workspace, 'hyphy-files')!;
    try {
      const links = await provider.links(
        toSign.map((file) => file.storagePath!),
        LINK_SECONDS.preview,
      );
      for (const file of toSign) views[file.id].preview = links.get(file.storagePath!);
    } catch {
      // Previews are a nicety: without them the file still opens and downloads.
    }
  }
  return views;
}
