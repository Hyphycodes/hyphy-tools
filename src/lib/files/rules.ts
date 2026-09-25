import type { FileKind } from '@/lib/platform/types';

/*
 * What Hyphy accepts as a file, and how it names and places one. Pure — the browser checks with it
 * before uploading, the server checks again before signing an upload and after the bytes arrive,
 * and the database checks the same list (`private.file_allowed`,
 * supabase/migrations/20261001000000_file_storage.sql). docs/FILES.md.
 *
 * A conservative allowlist: photos, PDFs, office documents, plain text and CSV, zip. No HTML, SVG,
 * scripts or programs — nothing a browser would run. A file must be what its name says: its first
 * bytes are checked against the type its extension claims, so `malware.exe` renamed `invoice.pdf`
 * is refused. That's validation, not virus scanning; Hyphy doesn't open or run what it stores.
 */

export const STORAGE_BUCKET = 'hyphy-files';
export const MB = 1024 * 1024;
/** How many files one upload takes at a time. */
export const MAX_FILES_AT_ONCE = 20;
/** How many bytes of a file's start are read to check what it really is. */
export const HEAD_BYTES = 4096;

export type FileTypeId =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'heic'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'doc'
  | 'xls'
  | 'csv'
  | 'txt'
  | 'zip';

export type FileType = {
  id: FileTypeId;
  /** The one MIME type Hyphy stores it as. */
  mime: string;
  /** Other names browsers and systems give the same type. */
  aliases: string[];
  extensions: string[];
  kind: FileKind;
  label: string;
  limit: number;
  /** Whether a browser can show it inline (an image preview, a PDF tab). */
  inline: boolean;
};

const at = (head: Uint8Array, offset: number, bytes: number[]) =>
  bytes.every((byte, index) => head[offset + index] === byte);
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const OFFICE_ZIP = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];

export const FILE_TYPES: FileType[] = [
  {
    id: 'jpeg',
    mime: 'image/jpeg',
    aliases: ['image/jpg', 'image/pjpeg'],
    extensions: ['jpg', 'jpeg'],
    kind: 'image',
    label: 'JPG',
    limit: 20 * MB,
    inline: true,
  },
  {
    id: 'png',
    mime: 'image/png',
    aliases: [],
    extensions: ['png'],
    kind: 'image',
    label: 'PNG',
    limit: 20 * MB,
    inline: true,
  },
  {
    id: 'webp',
    mime: 'image/webp',
    aliases: [],
    extensions: ['webp'],
    kind: 'image',
    label: 'WebP',
    limit: 20 * MB,
    inline: true,
  },
  {
    id: 'gif',
    mime: 'image/gif',
    aliases: [],
    extensions: ['gif'],
    kind: 'image',
    label: 'GIF',
    limit: 20 * MB,
    inline: true,
  },
  {
    id: 'heic',
    mime: 'image/heic',
    aliases: ['image/heif', 'image/heic-sequence', 'image/heif-sequence'],
    extensions: ['heic', 'heif'],
    kind: 'image',
    label: 'HEIC',
    limit: 20 * MB,
    // Only Safari shows HEIC; everywhere else it opens as a download.
    inline: false,
  },
  {
    id: 'pdf',
    mime: 'application/pdf',
    aliases: ['application/x-pdf'],
    extensions: ['pdf'],
    kind: 'pdf',
    label: 'PDF',
    limit: 50 * MB,
    inline: true,
  },
  {
    id: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    aliases: OFFICE_ZIP,
    extensions: ['docx'],
    kind: 'doc',
    label: 'Word',
    limit: 25 * MB,
    inline: false,
  },
  {
    id: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    aliases: OFFICE_ZIP,
    extensions: ['xlsx'],
    kind: 'sheet',
    label: 'Excel',
    limit: 25 * MB,
    inline: false,
  },
  {
    id: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    aliases: OFFICE_ZIP,
    extensions: ['pptx'],
    kind: 'doc',
    label: 'PowerPoint',
    limit: 25 * MB,
    inline: false,
  },
  {
    id: 'doc',
    mime: 'application/msword',
    aliases: ['application/octet-stream'],
    extensions: ['doc'],
    kind: 'doc',
    label: 'Word',
    limit: 25 * MB,
    inline: false,
  },
  {
    id: 'xls',
    mime: 'application/vnd.ms-excel',
    aliases: ['application/octet-stream'],
    extensions: ['xls'],
    kind: 'sheet',
    label: 'Excel',
    limit: 25 * MB,
    inline: false,
  },
  {
    id: 'csv',
    mime: 'text/csv',
    aliases: ['application/csv', 'text/comma-separated-values', 'application/vnd.ms-excel'],
    extensions: ['csv'],
    kind: 'sheet',
    label: 'CSV',
    limit: 5 * MB,
    inline: false,
  },
  {
    id: 'txt',
    mime: 'text/plain',
    aliases: [],
    extensions: ['txt'],
    kind: 'doc',
    label: 'Text',
    limit: 5 * MB,
    inline: false,
  },
  {
    id: 'zip',
    mime: 'application/zip',
    aliases: ['application/x-zip-compressed', 'application/x-zip', 'multipart/x-zip'],
    extensions: ['zip'],
    kind: 'archive',
    label: 'Zip',
    limit: 50 * MB,
    inline: false,
  },
];

/** Every MIME type Hyphy stores — the bucket's own allowlist. */
export const STORED_MIME_TYPES = FILE_TYPES.map((type) => type.mime);

/** What an upload is for. Each asks for less than a general file. */
export type UploadPurpose = 'file' | 'photo' | 'receipt' | 'logo';

export const PURPOSES: Record<UploadPurpose, { types: FileTypeId[]; limit?: number }> = {
  file: { types: FILE_TYPES.map((type) => type.id) },
  photo: { types: ['jpeg', 'png', 'webp', 'gif', 'heic'] },
  receipt: { types: ['jpeg', 'png', 'webp', 'heic', 'pdf'] },
  logo: { types: ['png', 'jpeg', 'webp'], limit: 2 * MB },
};

/** The `accept` attribute for a file input of this purpose. */
export function acceptFor(purpose: UploadPurpose) {
  const types = FILE_TYPES.filter((type) => PURPOSES[purpose].types.includes(type.id));
  return [
    ...types.map((type) => type.mime),
    ...types.flatMap((type) => type.extensions.map((ext) => `.${ext}`)),
  ].join(',');
}

export const typeById = (id: string | undefined) => FILE_TYPES.find((type) => type.id === id);
export const typeByMime = (mime: string | undefined) =>
  FILE_TYPES.find((type) => type.mime === mime?.toLowerCase());

export function extensionOf(name: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/** "20 MB" */
export function sizeLabel(bytes: number) {
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function limitFor(type: FileType, purpose: UploadPurpose) {
  return Math.min(type.limit, PURPOSES[purpose].limit ?? Infinity);
}

/** "JPG, PNG or PDF" */
export function kindsLabel(purpose: UploadPurpose) {
  const labels = Array.from(
    new Set(
      FILE_TYPES.filter((type) => PURPOSES[purpose].types.includes(type.id)).map((t) => t.label),
    ),
  );
  if (purpose === 'file') return 'photos, PDFs, Word, Excel, PowerPoint, CSV, text or zip files';
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
    : labels[0];
}

/* ---------- what the bytes really are ---------- */

/** Whether the start of a file is what this type's files start with. */
export function bytesMatch(type: FileType, head: Uint8Array): boolean {
  switch (type.id) {
    case 'jpeg':
      return at(head, 0, [0xff, 0xd8, 0xff]);
    case 'png':
      return at(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'gif':
      return at(head, 0, ascii('GIF87a')) || at(head, 0, ascii('GIF89a'));
    case 'webp':
      return at(head, 0, ascii('RIFF')) && at(head, 8, ascii('WEBP'));
    case 'heic': {
      if (!at(head, 4, ascii('ftyp'))) return false;
      const brand = String.fromCharCode(...head.slice(8, 12));
      return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
    }
    case 'pdf': {
      // "%PDF-" within the first kilobyte, as readers accept it.
      const start = head.slice(0, 1024);
      for (let i = 0; i + 5 <= start.length; i += 1) if (at(start, i, ascii('%PDF-'))) return true;
      return false;
    }
    case 'docx':
    case 'xlsx':
    case 'pptx':
    case 'zip':
      return at(head, 0, [0x50, 0x4b, 0x03, 0x04]) || at(head, 0, [0x50, 0x4b, 0x05, 0x06]);
    case 'doc':
    case 'xls':
      return at(head, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'csv':
    case 'txt':
      return looksLikeText(head);
  }
}

/** Text: no NUL bytes (which every program and image has), and not a web page or script. */
function looksLikeText(head: Uint8Array) {
  if (head.includes(0)) return false;
  const start = new TextDecoder('utf-8', { fatal: false })
    .decode(head.slice(0, 512))
    .replace(/^﻿/, '')
    .trimStart()
    .toLowerCase();
  return !/^<(!doctype|html|head|body|script|svg|\?xml|iframe)/.test(start);
}

/* ---------- checking an upload ---------- */

export type UploadCandidate = {
  name: string;
  size: number;
  /** What the browser said it is. Only a hint — never trusted on its own. */
  mime?: string;
  /** The file's first bytes, when they've been read. */
  head?: Uint8Array;
};

export type UploadCheck = { ok: true; type: FileType } | { ok: false; problem: string };

/**
 * Whether a file may be uploaded for this purpose: its extension names a type Hyphy accepts, the
 * browser's type (if any) agrees, it's within that type's limit, and — once its first bytes are
 * known — they are that type. Problems are sentences for the person.
 */
export function checkUpload(file: UploadCandidate, purpose: UploadPurpose): UploadCheck {
  const name = cleanDisplayName(file.name);
  const extension = extensionOf(name);
  const allowed = FILE_TYPES.filter((type) => PURPOSES[purpose].types.includes(type.id));
  const type = allowed.find((item) => item.extensions.includes(extension));
  if (!type)
    return {
      ok: false,
      problem: extension
        ? `Hyphy doesn’t take .${extension} files here. Use ${kindsLabel(purpose)}.`
        : `Hyphy can’t tell what kind of file this is. Use ${kindsLabel(purpose)}.`,
    };
  const declared = (file.mime ?? '').toLowerCase().split(';')[0].trim();
  if (declared && declared !== type.mime && !type.aliases.includes(declared))
    return { ok: false, problem: `This doesn’t look like a ${type.label} file.` };
  if (!Number.isFinite(file.size) || file.size <= 0)
    return { ok: false, problem: 'This file is empty.' };
  const limit = limitFor(type, purpose);
  if (file.size > limit)
    return {
      ok: false,
      problem: `This file is ${sizeLabel(file.size)}. ${type.label} files can be up to ${sizeLabel(limit)}${purpose === 'logo' ? ' for a logo' : ''}.`,
    };
  if (file.head && !bytesMatch(type, file.head))
    return {
      ok: false,
      problem: `This file isn’t really a ${type.label} file, so Hyphy won’t keep it.`,
    };
  return { ok: true, type };
}

/* ---------- names and places ---------- */

// Control characters, and the invisible direction marks that can make "invoice‮fdp.exe" read as
// "invoice.exe.pdf".
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/**
 * The name people see: whatever they called it, without any folders a browser or system put in
 * front, control characters or direction tricks, up to 140 characters (keeping the extension).
 */
export function cleanDisplayName(raw: string, max = 140): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  // Tabs and new lines are spaces; every other control character goes.
  let name = base.replace(/\s+/g, ' ').replace(UNSAFE, '').trim();
  if (!name || /^\.+$/.test(name)) name = 'Untitled';
  if (name.length <= max) return name;
  const extension = extensionOf(name);
  const tail = extension ? `.${extension}` : '';
  return `${name.slice(0, max - tail.length).trimEnd()}${tail}`;
}

/** A rename: the new name keeps the file's own extension, so a PDF stays a PDF. */
export function renamed(current: string, next: string) {
  const extension = extensionOf(current);
  let name = cleanDisplayName(next);
  if (extension && extensionOf(name) !== extension) name = `${name}.${extension}`;
  return cleanDisplayName(name);
}

/**
 * The name the bytes are stored under: made by Hyphy from the display name, lowercase letters,
 * digits and dashes only, with the type's own extension. It can't contain a folder, can't climb
 * out of one and is never trusted to be unique — the file's id in the path is.
 */
export function objectName(displayName: string, type: FileType): string {
  const stem = cleanDisplayName(displayName)
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${stem || 'file'}.${type.extensions[0]}`;
}

/** `spaces/<space>/files/<file>/<object-name>` — the only shape the database accepts. */
export function storagePath(spaceId: string, fileId: string, name: string) {
  return `spaces/${spaceId}/files/${fileId}/${name}`;
}

const PATH = /^spaces\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})\/[a-z0-9][a-z0-9._-]{0,99}$/;
/** Whether a path is one Hyphy made for this file. */
export function isPathFor(path: string, spaceId: string, fileId: string) {
  const match = PATH.exec(path);
  return Boolean(match && match[1] === spaceId && match[2] === fileId);
}
