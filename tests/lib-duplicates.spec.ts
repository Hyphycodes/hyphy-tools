import { expect, test } from '@playwright/test';
import {
  findDuplicates,
  fingerprint,
  formatSize,
  MAX_FILE,
  reportCsv,
  sameNameDifferent,
  sha256,
  sortBySize,
  stamp,
  suggestKeep,
  tally,
  type Progress,
  type ScanFile,
} from '@/lib/tools/duplicates';

/* Duplicates: size first, then SHA-256, and only exact copies count. */

const MAY_3 = new Date(2026, 4, 3, 9, 14).getTime();
let lastId = 0;
/** A file made of text, the way the tool sees one: where it is, and its contents. */
const entry = (path: string, contents: string, modified = MAY_3) => {
  const blob = new Blob([contents]);
  lastId += 1;
  return {
    id: lastId,
    name: path.split('/').pop()!,
    path,
    size: blob.size,
    modified,
    blob,
  };
};
/** A file as the grouping sees it, without contents. */
const scanned = (id: number, path: string, size: number, modified = MAY_3): ScanFile => ({
  id,
  name: path.split('/').pop()!,
  path,
  size,
  modified,
});

test('fingerprints are standard SHA-256', async () => {
  expect(await sha256(new Blob(['abc']))).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('only files that share a size are read; empty and giant ones are set aside', async () => {
  const hello = entry('a/hello.txt', 'hello');
  const world = entry('b/world.txt', 'world');
  const unique = entry('c/unique.txt', 'one of a kind');
  const empties = [entry('empty-1.txt', ''), entry('empty-2.txt', '')];
  const giants = [1, 2].map((index) => ({
    ...entry(`giant-${index}.mov`, ''),
    size: MAX_FILE + 1,
  }));
  const files = [hello, world, unique, ...empties, ...giants];

  const sorted = sortBySize(files);
  expect(sorted.candidates.map((file) => file.path)).toEqual(['a/hello.txt', 'b/world.txt']);
  expect(sorted.skipped.map((file) => file.path)).toEqual(['giant-1.mov', 'giant-2.mov']);
  expect(sorted.empty).toBe(2);

  const seen: Progress[] = [];
  const result = await fingerprint(files, new Map(), { onProgress: (step) => seen.push(step) });
  expect([...result.hashes.keys()]).toEqual([hello.id, world.id]);
  expect(seen[0]).toMatchObject({ done: 0, total: 2, bytesDone: 0, bytesTotal: 10 });
  expect(seen[0].current?.path).toBe('a/hello.txt');
  expect(seen.at(-1)).toMatchObject({ done: 2, bytesDone: 10, current: null });
  expect(result.stopped).toBe(false);
});

test('identical contents group together whatever their names; the same size isn’t enough', async () => {
  const files = [
    entry('Photos/beach.jpg', 'sand and sea'),
    entry('Backup/beach copy.jpg', 'sand and sea'),
    entry('Photos/sunset.jpg', 'sand and SEA'),
    entry('Invoices/invoice-1042.pdf', 'Salt & Ember invoice 1042, a long one'),
    entry('Downloads/invoice-1042 (1).pdf', 'Salt & Ember invoice 1042, a long one'),
  ];
  const { hashes } = await fingerprint(files);
  const groups = findDuplicates(files, hashes);
  expect(groups.map((group) => group.files.map((file) => file.path))).toEqual([
    ['Downloads/invoice-1042 (1).pdf', 'Invoices/invoice-1042.pdf'],
    ['Backup/beach copy.jpg', 'Photos/beach.jpg'],
  ]);
  expect(groups[1].hash).toBe(await sha256(new Blob(['sand and sea'])));
});

test('wasted space counts every copy but one, biggest first', () => {
  const files = [
    scanned(1, 'a.jpg', 100),
    scanned(2, 'b.jpg', 100),
    scanned(3, 'c.jpg', 100),
    scanned(4, 'movie.mov', 1000),
    scanned(5, 'movie copy.mov', 1000),
    scanned(6, 'lonely.txt', 7),
  ];
  const hashes = new Map([
    [1, 'x'],
    [2, 'x'],
    [3, 'x'],
    [4, 'y'],
    [5, 'y'],
  ]);
  const groups = findDuplicates(files, hashes);
  expect(groups.map((group) => group.wasted)).toEqual([1000, 200]);
  expect(tally(groups)).toEqual({ groups: 2, files: 5, copies: 3, wasted: 1200 });
  expect(tally([])).toEqual({ groups: 0, files: 0, copies: 0, wasted: 0 });
});

test('the suggested copy is the oldest, or the one with the shortest path', () => {
  const files = [
    scanned(1, 'Backup/2026/beach.jpg', 9, 100),
    scanned(2, 'Photos/beach (1).jpg', 9, 300),
    scanned(3, 'Photos/beach.jpg', 9, 200),
  ];
  expect(suggestKeep(files, 'oldest').id).toBe(1);
  expect(suggestKeep(files, 'shortest').id).toBe(3);
  // Ties go to the other rule, then to the path.
  const twins = [scanned(4, 'b/x.jpg', 9, 100), scanned(5, 'a/x.jpg', 9, 100)];
  expect(suggestKeep(twins, 'oldest').id).toBe(5);
  expect(
    suggestKeep([scanned(6, 'aa.jpg', 9, 500), scanned(7, 'bb.jpg', 9, 50)], 'shortest').id,
  ).toBe(7);
});

test('same name, different contents is its own list, and never a guess', () => {
  const files = [
    scanned(1, 'Work/report.pdf', 10),
    scanned(2, 'Old/Report.pdf', 12, MAY_3 + 1000),
    scanned(3, 'a/notes.txt', 5),
    scanned(4, 'b/notes.txt', 5),
    scanned(5, 'a/todo.txt', 8),
    scanned(6, 'b/todo.txt', 8),
    scanned(7, 'a/big.mov', 50),
    scanned(8, 'b/big.mov', 50),
    scanned(9, 'a/photo.jpg', 20),
    scanned(10, 'b/photo.jpg', 20),
    scanned(11, 'c/photo.jpg', 21),
  ];
  const hashes = new Map([
    [3, 'n'],
    [4, 'n'],
    [5, 't1'],
    [6, 't2'],
    [9, 'p'],
    [10, 'p'],
  ]);
  const clashes = sameNameDifferent(files, hashes);
  // notes.txt is two identical copies; big.mov couldn't be checked: neither is listed.
  // Named as the first file (in path order) spells it.
  expect(clashes.map((clash) => clash.name)).toEqual(['photo.jpg', 'Report.pdf', 'todo.txt']);
  const [photo, report] = clashes;
  expect(photo.versions).toBe(2);
  expect(photo.files.map((file) => file.version)).toEqual(['A', 'A', 'B']);
  expect(report.newest).toBe(2);
  expect(report.files.map((file) => file.path)).toEqual(['Old/Report.pdf', 'Work/report.pdf']);
});

test('stopping keeps what’s done; unreadable files are reported, not fatal', async () => {
  const files = ['one', 'two', 'six', 'ten'].map((word, index) => entry(`f${index}.txt`, word));
  const controller = new AbortController();
  const first = await fingerprint(files, new Map(), {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  });
  expect(first.stopped).toBe(true);
  expect(first.hashes.size).toBe(1);

  // Carrying on reads only what's left.
  let total = 0;
  const rest = await fingerprint(files, first.hashes, {
    onProgress: (step) => (total = step.total),
  });
  expect(total).toBe(3);
  expect(rest.hashes.size).toBe(4);

  const gone = {
    ...entry('gone.txt', 'abc'),
    blob: { arrayBuffer: () => Promise.reject(new Error('moved')) } as unknown as Blob,
  };
  const kept = entry('kept.txt', 'abc');
  const result = await fingerprint([gone, kept]);
  expect(result.unreadable.map((file) => file.path)).toEqual(['gone.txt']);
  expect([...result.hashes.keys()]).toEqual([kept.id]);
});

test('the report lists every copy, its fingerprint, and the one being kept', () => {
  const files = [
    scanned(1, 'Photos/beach.jpg', 9, MAY_3),
    scanned(2, '=HYPERLINK("x").jpg', 9, MAY_3),
  ];
  const [group] = findDuplicates(
    files,
    new Map([
      [1, 'abc123'],
      [2, 'abc123'],
    ]),
  );
  expect(reportCsv([group], () => 1)).toBe(
    [
      'group,path,size,modified,sha256,keep',
      `1,"'=HYPERLINK(""x"").jpg",9,${stamp(MAY_3)},abc123,no`,
      `1,Photos/beach.jpg,9,${stamp(MAY_3)},abc123,yes`,
    ].join('\r\n'),
  );
  expect(stamp(MAY_3)).toBe('2026-05-03 09:14');
});

test('sizes read the way people say them', () => {
  expect(formatSize(0)).toBe('0 B');
  expect(formatSize(1023)).toBe('1023 B');
  expect(formatSize(1536)).toBe('1.5 KB');
  expect(formatSize(18 * 1024)).toBe('18 KB');
  expect(formatSize(312 * 1024 * 1024)).toBe('312 MB');
  expect(formatSize(1023.9 * 1024 * 1024)).toBe('1.0 GB');
  expect(formatSize(4.2 * 1024 ** 3)).toBe('4.2 GB');
});
