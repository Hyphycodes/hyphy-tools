'use client';
import {
  cancelUpload,
  finishUpload,
  prepareUpload,
  retryUpload,
  type UploadRequest,
} from '@/app/(app)/[space]/file-actions';
import type { UploadTarget } from './storage';
import { putDeviceFile } from './device';
import { checkUpload, cleanDisplayName, HEAD_BYTES, MB, type UploadPurpose } from './rules';

/*
 * The browser's half of the one upload pipeline (the server's is file-actions.ts). Every place
 * that saves a file — Files, a project, a receipt, the tools, the logo — calls `uploadFile`.
 *
 *   checking → preparing → uploading n% → finishing → done
 *                                  ↘ failed (Try again: same record, fresh link) / cancelled
 */

export type UploadStage = 'checking' | 'preparing' | 'uploading' | 'finishing';

export type UploadOptions = {
  purpose: UploadPurpose;
  /** A tool's result: 'pdf', 'images' or 'qr'. */
  source?: string;
  attachTo?: UploadRequest['attachTo'];
  folder?: string;
  /** Known already (a PDF the tool made), so it isn't worked out again. */
  pages?: number;
  width?: number;
  height?: number;
  onStage?: (stage: UploadStage) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export type Uploaded = { fileId: string; name: string; href: string };

/** Why an upload stopped, and whether trying again can help. */
export class UploadError extends Error {
  constructor(
    message: string,
    public retry: { fileId?: string } | null,
  ) {
    super(message);
  }
}

const OFFLINE = 'The upload didn’t get through. Check the connection and try again.';

function base64(bytes: Uint8Array) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

async function sha256(file: Blob) {
  if (file.size > 50 * MB || typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  } catch {
    return undefined;
  }
}

async function dimensions(file: Blob) {
  if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return {};
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

/** Sends the bytes where the server said, with progress. Supabase's signed upload, or the device. */
function transfer(
  fileId: string,
  target: UploadTarget,
  blob: Blob,
  name: string,
  options: UploadOptions,
): Promise<void> {
  if (target.kind === 'device')
    return putDeviceFile(fileId, blob, name).then(() => options.onProgress?.(1));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.url);
    xhr.setRequestHeader('apikey', target.apikey);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new UploadError(
              xhr.status === 413 || /too large|exceeded the maximum/i.test(xhr.responseText)
                ? 'This file is bigger than Hyphy takes.'
                : xhr.status === 409 || /already exists|duplicate/i.test(xhr.responseText)
                  ? 'This upload was already sent. Finishing it…'
                  : OFFLINE,
              { fileId },
            ),
          );
    xhr.onerror = () => reject(new UploadError(OFFLINE, { fileId }));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', blob);
    xhr.send(form);
  });
}

async function finish(slug: string, fileId: string): Promise<Uploaded> {
  const done = await finishUpload(slug, fileId);
  if (!done.ok) throw new UploadError(done.error, done.retry ? { fileId } : null);
  return { fileId: done.fileId, name: done.name, href: done.href };
}

/**
 * Uploads one file for this Space. Resolves once the file is `ready` (stored, checked, visible to
 * the people it's for); rejects with an `UploadError` saying what went wrong and whether a retry
 * can help, or an AbortError when cancelled (the server forgets the upload).
 */
export async function uploadFile(
  slug: string,
  file: Blob & { name?: string },
  options: UploadOptions,
): Promise<Uploaded> {
  const name = cleanDisplayName(file.name ?? 'Untitled');
  options.onStage?.('checking');
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const check = checkUpload({ name, size: file.size, mime: file.type, head }, options.purpose);
  if (!check.ok) throw new UploadError(check.problem, null);
  // Stored as exactly the type Hyphy checked, whatever the browser guessed.
  const blob = new Blob([file], { type: check.type.mime });
  const [digest, size] = await Promise.all([
    sha256(blob),
    options.width ? { width: options.width, height: options.height } : dimensions(blob),
  ]);

  options.onStage?.('preparing');
  const prepared = await prepareUpload(slug, {
    name,
    size: blob.size,
    mime: check.type.mime,
    head: base64(head),
    purpose: options.purpose,
    source: options.source,
    attachTo: options.attachTo ?? null,
    folder: options.folder,
    sha256: digest,
    pages: options.pages,
    ...size,
  }).catch(() => ({ ok: false as const, error: OFFLINE }));
  if (!prepared.ok) throw new UploadError(prepared.error, null);
  return send(slug, prepared.fileId, prepared.target, blob, name, options);
}

async function send(
  slug: string,
  fileId: string,
  target: UploadTarget,
  blob: Blob,
  name: string,
  options: UploadOptions,
) {
  try {
    options.onStage?.('uploading');
    options.onProgress?.(0);
    try {
      await transfer(fileId, target, blob, name, options);
    } catch (error) {
      // Already there (a retry after the bytes had arrived): just finish.
      if (!(error instanceof UploadError && /already sent/.test(error.message))) throw error;
    }
    options.onStage?.('finishing');
    return await finish(slug, fileId);
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      await cancelUpload(slug, fileId).catch(() => {});
      throw error;
    }
    if (error instanceof UploadError) throw error;
    throw new UploadError(OFFLINE, { fileId });
  }
}

/** Tries a failed upload again: same record, a fresh link. Never a second copy. */
export async function retryFile(
  slug: string,
  fileId: string,
  file: Blob & { name?: string },
  options: UploadOptions,
): Promise<Uploaded> {
  options.onStage?.('preparing');
  const again = await retryUpload(slug, fileId).catch(() => ({
    ok: false as const,
    error: OFFLINE,
  }));
  // The record is gone (cancelled, cleaned up): start over.
  if (!again.ok) return uploadFile(slug, file, options);
  const check = checkUpload(
    { name: again.name, size: file.size, mime: file.type },
    options.purpose,
  );
  const blob = check.ok ? new Blob([file], { type: check.type.mime }) : file;
  return send(slug, fileId, again.target, blob, again.name, options);
}
