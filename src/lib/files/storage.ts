import 'server-only';
import type { Workspace } from '@/lib/identity/types';
import type { FileStorage } from '@/lib/platform/types';
import { requireSupabaseConfig } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { STORAGE_BUCKET } from './rules';

/*
 * Where file bytes go. The product talks to one small interface; nothing else in the app calls
 * `supabase.storage`. docs/FILES.md.
 *
 * - Supabase Storage (real accounts): the private `hyphy-files` bucket, always as the signed-in
 *   person (their session's JWT, the publishable key) so Storage's own policies — which ask the
 *   file's database record — decide every upload, read and removal. No secret key is used, on the
 *   server or anywhere else.
 * - The device (Demo Mode): there's no signed-in account for Storage to check, so the bytes stay
 *   in the uploading browser (IndexedDB, `lib/files/device.ts`) and the server only keeps the
 *   record. Nothing is pretended: other browsers see the record and are told where the file is.
 */

export class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Hyphy couldn’t reach file storage. Nothing was changed — try again in a moment.', {
      cause,
    });
  }
}

/** Where the browser sends the bytes of one upload. */
export type UploadTarget =
  | {
      kind: 'storage';
      /** Supabase's signed upload URL for this one path. Valid two hours; one use (no upsert). */
      url: string;
      /** The project's publishable key, which Supabase's gateway expects. Public by design. */
      apikey: string;
    }
  | { kind: 'device' };

export interface StorageProvider {
  readonly storage: FileStorage;
  /** A one-path, one-use upload target, issued only after the server authorized the upload. */
  uploadTarget(path: string): Promise<UploadTarget>;
  /** The first bytes of a stored file, to check what it really is. Null if it isn't there. */
  head(path: string, bytes: number): Promise<Uint8Array | null>;
  /** Short-lived read links for many files in one request (paths this person may read only). */
  links(paths: string[], seconds: number): Promise<Map<string, string>>;
  /** One short-lived link; `download` makes it save as that name instead of opening. */
  link(path: string, seconds: number, download?: string): Promise<string | null>;
  /** Removes bytes. Storage refuses paths this person's file records don't let them remove. */
  remove(paths: string[]): Promise<void>;
}

/** How long links last. Never stored anywhere; made again whenever they're needed. */
export const LINK_SECONDS = { open: 60, preview: 10 * 60, logo: 60 * 60 };

function supabaseStorage(): StorageProvider {
  const bucket = async () => (await createSupabaseServerClient()).storage.from(STORAGE_BUCKET);
  const fail = (error: unknown): never => {
    throw new StorageUnavailableError(error);
  };
  return {
    storage: 'hyphy-files',
    async uploadTarget(path) {
      const { data, error } = await (await bucket()).createSignedUploadUrl(path);
      if (error || !data) fail(error);
      return {
        kind: 'storage',
        url: data!.signedUrl,
        apikey: requireSupabaseConfig().publishableKey,
      };
    },
    async head(path, bytes) {
      const url = await this.link(path, 60);
      if (!url) return null;
      const response = await fetch(url, {
        headers: { range: `bytes=0-${bytes - 1}` },
        cache: 'no-store',
      }).catch(fail);
      if (response.status === 404 || response.status === 400) return null;
      if (!response.ok) fail(new Error(`Storage answered ${response.status}`));
      return new Uint8Array(await response.arrayBuffer()).slice(0, bytes);
    },
    async links(paths, seconds) {
      const links = new Map<string, string>();
      if (!paths.length) return links;
      const { data, error } = await (await bucket()).createSignedUrls(paths, seconds);
      if (error) fail(error);
      for (const item of data ?? [])
        if (item.path && item.signedUrl) links.set(item.path, item.signedUrl);
      return links;
    },
    async link(path, seconds, download) {
      const { data, error } = await (
        await bucket()
      ).createSignedUrl(path, seconds, download ? { download } : undefined);
      // Not found and not allowed read the same: there is nothing this person may open.
      if (error || !data) return null;
      return data.signedUrl;
    },
    async remove(paths) {
      if (!paths.length) return;
      const { error } = await (await bucket()).remove(paths);
      if (error) fail(error);
    },
  };
}

const device: StorageProvider = {
  storage: 'device',
  uploadTarget: async () => ({ kind: 'device' }),
  head: async () => null,
  links: async () => new Map(),
  link: async () => null,
  // The browser that holds the bytes clears them itself (lib/files/device.ts).
  remove: async () => {},
};

/**
 * Where this person's new files go: Supabase Storage for a real account, the device in Demo
 * Mode. A file's own `storage` says where an existing one is.
 */
export function storageFor(workspace: Pick<Workspace, 'session'>): StorageProvider {
  return workspace.session.source === 'supabase' ? supabaseStorage() : device;
}

/** The provider holding one file's bytes, if this session can reach it. */
export function storageOf(
  workspace: Pick<Workspace, 'session'>,
  where: FileStorage | undefined,
): StorageProvider | null {
  const mine = storageFor(workspace);
  return where && where === mine.storage ? mine : null;
}
