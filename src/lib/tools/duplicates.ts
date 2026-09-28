import { csv } from '@/lib/files/download';
import { naturalCompare } from './rename';

/*
 * Duplicates: exact copies among the files a person chooses. Files are grouped by size first;
 * only files that share a size are read, one at a time, and fingerprinted with SHA-256 (the
 * browser's own crypto.subtle). Same size and same fingerprint means the same contents, whatever
 * the names. Nothing is ever changed or deleted: the result is a list. Pure and tested
 * (tests/lib-duplicates.spec.ts).
 */

const GB = 1024 * 1024 * 1024;
/** Past this, reading a file in one go is slow and takes a lot of memory: say so as it happens. */
export const LARGE_FILE = 1.5 * GB;
/** Browsers can't dependably read more than this into memory at once, so these are skipped. */
export const MAX_FILE = 2 * GB;

export type ScanFile = {
  id: number;
  name: string;
  /** Its place inside a chosen folder ("Photos/2026/beach.jpg"), or just the name. */
  path: string;
  size: number;
  /** Last modified, in milliseconds. */
  modified: number;
};

/** What the sizes alone say: which files need a fingerprint, and which can't have one. */
export function sortBySize<T extends ScanFile>(files: T[]) {
  const bySize = new Map<number, T[]>();
  for (const file of files) {
    const same = bySize.get(file.size);
    if (same) same.push(file);
    else bySize.set(file.size, [file]);
  }
  const candidates: T[] = [];
  const skipped: T[] = [];
  for (const [size, same] of bySize) {
    // A size nobody else has is one of a kind; empty files take no space to begin with.
    if (same.length < 2 || size === 0) continue;
    (size > MAX_FILE ? skipped : candidates).push(...same);
  }
  return {
    candidates,
    /** Same size as another file, but too big to read here. */
    skipped,
    empty: bySize.get(0)?.length ?? 0,
  };
}

/** The SHA-256 fingerprint of a file's contents, as hex. */
export async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type Progress = {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  /** The file being read right now. */
  current: ScanFile | null;
};

/**
 * Fingerprints the files that share a size with another, one at a time, skipping any already
 * known. Stopping (the signal) keeps what's done so far; unreadable files are reported, not fatal.
 */
export async function fingerprint<T extends ScanFile & { blob: Blob }>(
  files: T[],
  known: ReadonlyMap<number, string> = new Map(),
  { onProgress, signal }: { onProgress?: (progress: Progress) => void; signal?: AbortSignal } = {},
) {
  const hashes = new Map(known);
  const queue = sortBySize(files).candidates.filter((file) => !hashes.has(file.id));
  const unreadable: T[] = [];
  const progress: Progress = {
    done: 0,
    total: queue.length,
    bytesDone: 0,
    bytesTotal: queue.reduce((sum, file) => sum + file.size, 0),
    current: null,
  };
  for (const file of queue) {
    if (signal?.aborted) return { hashes, unreadable, stopped: true };
    onProgress?.({ ...progress, current: file });
    try {
      hashes.set(file.id, await sha256(file.blob));
    } catch {
      unreadable.push(file);
    }
    progress.done += 1;
    progress.bytesDone += file.size;
  }
  onProgress?.(progress);
  return { hashes, unreadable, stopped: false };
}

export type DuplicateGroup = {
  hash: string;
  size: number;
  /** In natural path order. */
  files: ScanFile[];
  /** The space the extra copies take: every copy but one. */
  wasted: number;
};

/** Groups of identical files (two or more), the most wasted space first. */
export function findDuplicates(files: ScanFile[], hashes: ReadonlyMap<number, string>) {
  const byContent = new Map<string, ScanFile[]>();
  for (const file of files) {
    const hash = hashes.get(file.id);
    if (!hash) continue;
    const key = `${file.size}:${hash}`;
    const same = byContent.get(key);
    if (same) same.push(file);
    else byContent.set(key, [file]);
  }
  return [...byContent.values()]
    .filter((same) => same.length > 1)
    .map((same): DuplicateGroup => {
      const sorted = [...same].sort((a, b) => naturalCompare(a.path, b.path));
      return {
        hash: hashes.get(sorted[0].id)!,
        size: sorted[0].size,
        files: sorted,
        wasted: sorted[0].size * (sorted.length - 1),
      };
    })
    .sort(
      (a, b) =>
        b.wasted - a.wasted || b.size - a.size || naturalCompare(a.files[0].path, b.files[0].path),
    );
}

/** "37 extra copies · 4.2 GB you could free", as numbers. */
export function tally(groups: DuplicateGroup[]) {
  return {
    groups: groups.length,
    files: groups.reduce((sum, group) => sum + group.files.length, 0),
    copies: groups.reduce((sum, group) => sum + group.files.length - 1, 0),
    wasted: groups.reduce((sum, group) => sum + group.wasted, 0),
  };
}

export type KeepRule = 'oldest' | 'shortest';

/**
 * Which copy to suggest keeping: the oldest (earliest modified), or the one with the shortest
 * path; each breaks the other's ties. Only a suggestion: the person decides.
 */
export function suggestKeep(files: ScanFile[], rule: KeepRule): ScanFile {
  const byAge = (a: ScanFile, b: ScanFile) => a.modified - b.modified;
  const byPath = (a: ScanFile, b: ScanFile) =>
    Array.from(a.path).length - Array.from(b.path).length;
  return [...files].sort(
    (a, b) =>
      (rule === 'oldest' ? byAge(a, b) || byPath(a, b) : byPath(a, b) || byAge(a, b)) ||
      naturalCompare(a.path, b.path),
  )[0];
}

export type NameClash = {
  /** The shared name, as the first file spells it. */
  name: string;
  files: (ScanFile & {
    /** Files with the same letter have the same contents; null when it couldn't be checked. */
    version: string | null;
  })[];
  /** How many different contents were found. */
  versions: number;
  /** The most recently modified file. */
  newest: number;
};

/**
 * Files that share a name (ignoring capitals) but not their contents: not copies, but worth a
 * look ("which report.pdf is the right one?"). Different sizes mean different contents; same
 * sizes are told apart by fingerprint. Files that couldn't be checked are listed, not guessed.
 */
export function sameNameDifferent(
  files: ScanFile[],
  hashes: ReadonlyMap<number, string>,
): NameClash[] {
  const byName = new Map<string, ScanFile[]>();
  for (const file of files) {
    const key = file.name.toLowerCase();
    const same = byName.get(key);
    if (same) same.push(file);
    else byName.set(key, [file]);
  }
  const clashes: NameClash[] = [];
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    const sizes = new Map<number, number>();
    for (const file of same) sizes.set(file.size, (sizes.get(file.size) ?? 0) + 1);
    const content = (file: ScanFile) =>
      file.size === 0
        ? 'empty'
        : (hashes.get(file.id) ?? (sizes.get(file.size) === 1 ? `size:${file.size}` : null));
    const letters = new Map<string, string>();
    const sorted = [...same].sort((a, b) => naturalCompare(a.path, b.path));
    const listed = sorted.map((file) => {
      const key = content(file);
      if (key !== null && !letters.has(key))
        letters.set(key, String.fromCharCode(65 + (letters.size % 26)));
      return { ...file, version: key === null ? null : letters.get(key)! };
    });
    if (letters.size < 2) continue;
    clashes.push({
      name: sorted[0].name,
      files: listed,
      versions: letters.size,
      newest: sorted.reduce((latest, file) => (file.modified > latest.modified ? file : latest)).id,
    });
  }
  return clashes.sort((a, b) => naturalCompare(a.name, b.name));
}

/** A spreadsheet-friendly local time: 2026-05-03 09:14. */
export function stamp(time: number) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** The report: one row per file in every group, and which copy the person is keeping. */
export function reportCsv(groups: DuplicateGroup[], keep: (group: DuplicateGroup) => number) {
  return csv([
    ['group', 'path', 'size', 'modified', 'sha256', 'keep'],
    ...groups.flatMap((group, index) => {
      const kept = keep(group);
      return group.files.map((file) => [
        index + 1,
        file.path,
        file.size,
        stamp(file.modified),
        group.hash,
        file.id === kept ? 'yes' : 'no',
      ]);
    }),
  ]);
}

/** 4.2 GB, 312 MB, 18 KB. */
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  // Step up before a number would round to 1000 or more: "1.0 MB", never "1000 KB".
  while (value >= 999.5 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
