'use client';
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { cn } from '@/components/ui/cn';
import { Segmented } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { downloadText } from '@/lib/files/download';
import { plural } from '@/lib/platform/format';
import {
  findDuplicates,
  fingerprint,
  formatSize,
  LARGE_FILE,
  reportCsv,
  sameNameDifferent,
  sortBySize,
  suggestKeep,
  tally,
  type DuplicateGroup,
  type KeepRule,
  type Progress,
  type ScanFile,
} from '@/lib/tools/duplicates';
import { folderOf, splitName } from '@/lib/tools/rename';
import { FileDrop, Note, SampleButton, StartPanel, Surface } from './kit';

/*
 * Duplicates: exact copies among the files or folder a person chooses. Sizes are compared first;
 * only files that share a size are read, one at a time, and fingerprinted on this device. The
 * result is a list with a suggested copy to keep in each group. Nothing is changed or deleted:
 * a web page can't, and this one doesn't try.
 */

const ACCENT = 'var(--accent, #9fb2ff)';
/** Groups (and name clashes) shown at a time; the rest are a tap away. */
const PAGE = 20;

type Entry = ScanFile & { blob: Blob };
type Phase = 'idle' | 'running' | 'done' | 'stopped';

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Whether a chosen file can still be read. A dropped folder can't, nor can a file moved or changed
 * since it was chosen. One byte is enough to tell; an empty entry is read whole, since a slice of
 * nothing never touches the disk.
 */
const readable = (file: File) =>
  (file.size ? file.slice(0, 1) : file).arrayBuffer().then(
    () => true,
    () => false,
  );

/** “a.jpg”, “b.jpg” and 3 more. */
function list(items: string[]) {
  if (items.length <= 2) return items.join(' and ');
  return `${items[0]}, ${items[1]} and ${items.length - 2} more`;
}
const quote = (name: string) => `“${name}”`;

/** Repeatable bytes, so the sample's copies are true copies and its lookalikes aren't. */
function noise(seed: number, length: number) {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 255;
  }
  return bytes;
}

/** A small, fictional folder with real copies in it, made on this device. */
const SAMPLE: { path: string; modified: string; seed?: number; size?: number; text?: string }[] = [
  { path: 'Photos/beach day.jpg', seed: 11, size: 2_400_000, modified: '2026-06-14T10:02' },
  { path: 'Photos/beach day (1).jpg', seed: 11, size: 2_400_000, modified: '2026-06-20T19:40' },
  { path: 'Backup/2026/beach day.jpg', seed: 11, size: 2_400_000, modified: '2026-07-01T08:15' },
  { path: 'Photos/sunset.jpg', seed: 12, size: 2_400_000, modified: '2026-06-14T20:31' },
  { path: 'Invoices/invoice-1042.pdf', seed: 21, size: 184_320, modified: '2026-05-02T09:30' },
  {
    path: 'Downloads/invoice-1042 (1).pdf',
    seed: 21,
    size: 184_320,
    modified: '2026-05-09T16:12',
  },
  { path: 'Downloads/flyer.png', seed: 31, size: 640_000, modified: '2026-04-18T11:45' },
  { path: 'Backup/2026/flyer.png', seed: 31, size: 640_000, modified: '2026-07-01T08:15' },
  { path: 'Music/intro.m4a', seed: 41, size: 912_000, modified: '2026-03-30T22:08' },
  {
    path: 'Notes/todo.txt',
    text: 'Order lemons for Salt & Ember.\nCall the printer about the flyer.\n',
    modified: '2026-07-03T08:40',
  },
  {
    path: 'Backup/2026/todo.txt',
    text: 'Order lemons for Salt & Ember.\n',
    modified: '2026-07-01T08:15',
  },
];

function sampleFiles() {
  const made = new Map<number, Uint8Array<ArrayBuffer>>();
  return SAMPLE.map((sample) => {
    const name = sample.path.slice(sample.path.lastIndexOf('/') + 1);
    let part: BlobPart = sample.text ?? '';
    if (sample.seed !== undefined && sample.size !== undefined) {
      const bytes = made.get(sample.seed) ?? noise(sample.seed, sample.size);
      made.set(sample.seed, bytes);
      part = bytes;
    }
    const file = new File([part], name, { lastModified: new Date(sample.modified).getTime() });
    return { file, path: `Sample folder/${sample.path}` };
  });
}

/** A folder with the same file in it three times: two of them extra. */
function DuplicatesArt() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-[118px] w-[250px]">
      <span className="absolute inset-x-6 top-5 bottom-0 rounded-[18px] bg-well shadow-[inset_0_0_0_1px_var(--color-line)]" />
      <span className="absolute top-2 left-6 h-6 w-20 rounded-t-[12px] bg-well" />
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'absolute top-9 grid h-[66px] w-[54px] place-items-center rounded-[10px] bg-white shadow-lift',
            index > 0 && 'opacity-80',
          )}
          style={{
            left: `${52 + index * 52}px`,
            transform: `rotate(${[-6, 0, 6][index]}deg)`,
          }}
        >
          <span
            className="block size-7 rounded-[7px]"
            style={{ background: 'linear-gradient(160deg,#f6b77a,#8a6a4f)' }}
          />
          {index > 0 && (
            <span
              className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full text-[#12110d] shadow-lift"
              style={{ background: ACCENT }}
            >
              <Icon name="copy" size={12} />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

export function DuplicatesTool() {
  const id = useId();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hashes, setHashes] = useState<ReadonlyMap<number, string>>(new Map());
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [unreadable, setUnreadable] = useState<Entry[]>([]);
  const [keepRule, setKeepRule] = useState<KeepRule>('oldest');
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [groupsShown, setGroupsShown] = useState(PAGE);
  const [clashesShown, setClashesShown] = useState(PAGE);
  const [note, setNote] = useState('');
  const scan = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const painted = useRef(0);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  // Leaving the page stops a scan that's still reading.
  useEffect(() => {
    const current = scan;
    return () => current.current?.abort();
  }, []);

  const sizes = useMemo(() => sortBySize(entries), [entries]);
  const groups = useMemo(() => findDuplicates(entries, hashes), [entries, hashes]);
  const clashes = useMemo(() => sameNameDifferent(entries, hashes), [entries, hashes]);
  const total = tally(groups);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const folders = new Set(entries.map((entry) => folderOf(entry.path)).filter(Boolean));
  const tops = new Set(entries.map((entry) => entry.path.split('/')[0]));
  const onlyNames = entries.length > 0 && folders.size === 0;
  const checked = phase === 'done' || phase === 'stopped';
  /** Files that share a size and have been fingerprinted so far. */
  const read = sizes.candidates.filter((entry) => hashes.has(entry.id)).length;

  const keepFor = (group: DuplicateGroup) => {
    const picked = picks[group.hash];
    return group.files.some((file) => file.id === picked)
      ? picked
      : suggestKeep(group.files, keepRule).id;
  };

  async function run(list: Entry[], known: ReadonlyMap<number, string>) {
    if (!globalThis.crypto?.subtle) {
      setNote(
        'This browser won’t fingerprint files on this page: it needs a secure (https) connection.',
      );
      return;
    }
    scan.current?.abort();
    const controller = new AbortController();
    scan.current = controller;
    setPhase('running');
    setStopping(false);
    setProgress(null);
    setUnreadable([]);
    const result = await fingerprint(list, known, {
      signal: controller.signal,
      onProgress: (step) => {
        // Small files finish faster than the screen redraws: repaint a dozen times a second,
        // but always before a big file, so its note shows while it's read.
        const now = performance.now();
        if (step.current && step.current.size < LARGE_FILE && now - painted.current < 80) return;
        painted.current = now;
        setProgress(step);
      },
    });
    if (scan.current !== controller) return;
    scan.current = null;
    setHashes(result.hashes);
    setUnreadable(result.unreadable);
    setPhase(result.stopped ? 'stopped' : 'done');
    setStopping(false);
  }

  async function add(files: { file: File; path: string }[]) {
    if (phase === 'running' || !files.length) return;
    const keyOf = (path: string, size: number, modified: number) => `${path}/${size}/${modified}`;
    const known = new Set(entries.map((entry) => keyOf(entry.path, entry.size, entry.modified)));
    const incoming: Entry[] = [];
    const folderEntries: string[] = [];
    let repeats = 0;
    for (const { file, path } of files) {
      const key = keyOf(path, file.size, file.lastModified);
      if (known.has(key)) repeats += 1;
      // Only a drop can hand over a folder itself (a folder pick lists what's inside).
      else if (
        !file.webkitRelativePath &&
        !file.type &&
        !splitName(file.name).extension &&
        !(await readable(file))
      )
        folderEntries.push(file.name);
      else {
        known.add(key);
        incoming.push({
          id: nextId.current++,
          name: file.name,
          path,
          size: file.size,
          modified: file.lastModified,
          blob: file,
        });
      }
    }
    const notes: string[] = [];
    if (incoming.length && entries.length) notes.push(`Added ${plural(incoming.length, 'file')}.`);
    if (repeats)
      notes.push(`${plural(repeats, 'file')} ${repeats === 1 ? 'was' : 'were'} already here.`);
    if (folderEntries.length)
      notes.push(
        `${list(folderEntries.map(quote))} ${folderEntries.length === 1 ? 'is a folder' : 'are folders'}: use Choose a folder to check what’s inside.`,
      );
    setNote(notes.join(' '));
    if (!incoming.length) return;
    const next = [...entries, ...incoming];
    setEntries(next);
    setGroupsShown(PAGE);
    setClashesShown(PAGE);
    await run(next, hashes);
  }

  function startOver() {
    scan.current?.abort();
    scan.current = null;
    setEntries([]);
    setHashes(new Map());
    setPicks({});
    setUnreadable([]);
    setProgress(null);
    setPhase('idle');
    setNote('');
  }

  const downloadReport = () =>
    downloadText(reportCsv(groups, keepFor), 'duplicates-report.csv', 'text/csv');

  const take = (files: File[]) =>
    add(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));

  if (!entries.length)
    return (
      <div
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          take(Array.from(event.dataTransfer.files));
        }}
      >
        <StartPanel
          art={<DuplicatesArt />}
          title="Find the copies taking up space"
          lead="Choose a folder and every exact copy turns up, even under another name."
          footer={
            <Note icon="shield-check" className="text-left">
              Nothing is moved or deleted. You get a list with the one to keep already suggested,
              and you decide.
            </Note>
          }
        >
          <div className="grid gap-2 sm:mx-auto sm:max-w-[360px]">
            <button
              type="button"
              onClick={() => folderInput.current?.click()}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-[16px] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent,transparent)] transition-transform active:scale-[.985] sm:h-13 sm:text-[16px]"
              style={{ background: ACCENT }}
            >
              <Icon name="folder-open" size={19} /> Choose a folder
            </button>
            <button
              type="button"
              onClick={() => filesInput.current?.click()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] px-4 text-[15px] font-medium text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink"
            >
              Or pick some files
            </button>
          </div>
          <input
            ref={folderInput}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose a folder"
            // A folder picker: every file inside, with its path.
            {...({ webkitdirectory: '' } as Record<string, string>)}
            onChange={(event) => {
              take(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <input
            ref={filesInput}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose files"
            onChange={(event) => {
              take(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <SampleButton onClick={() => add(sampleFiles())} className="mt-3">
            Try a sample folder with copies in it
          </SampleButton>
          {note && (
            <p role="status" className="mt-2 text-[13px] leading-relaxed text-ink-2">
              {note}
            </p>
          )}
        </StartPanel>
      </div>
    );

  const percent =
    progress && progress.bytesTotal
      ? Math.round((progress.bytesDone / progress.bytesTotal) * 100)
      : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
      <Surface className="grid grid-cols-1 gap-4 lg:col-start-1 lg:row-start-1">
        <>
          <div className="flex items-center gap-3">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-[12px] text-[#12110d]"
              style={{ background: ACCENT }}
            >
              <Icon name="folder-search" size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">
                {plural(entries.length, 'file')} · {formatSize(totalBytes)}
              </p>
              <p className="truncate text-[13px] text-muted">
                {onlyNames
                  ? 'Chosen one by one'
                  : `${tops.size === 1 ? `From “${[...tops][0]}”` : 'From several folders'} · ${plural(folders.size, 'folder')}`}
              </p>
            </div>
            <button
              type="button"
              onClick={startOver}
              className="h-11 shrink-0 rounded-[11px] px-3.5 text-[14px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-9 lg:text-[13.5px]"
            >
              Start over
            </button>
          </div>
          <FileDrop
            folder
            compact
            disabled={phase === 'running'}
            onFiles={(files) =>
              add(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })))
            }
            icon="plus"
            title="Add another folder or more files"
          />
        </>
        {note && (
          <p role="status" className="text-[13px] leading-relaxed text-ink-2">
            {note}
          </p>
        )}
      </Surface>

      <aside
        aria-label="Summary"
        className={cn(
          'min-w-0 grid-cols-1 gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid lg:self-start',
          phase === 'idle' ? 'hidden' : 'grid',
        )}
      >
        <Surface className="grid grid-cols-1 gap-4">
          {phase === 'idle' && (
            <>
              <p className="label">How it finds copies</p>
              <ol className="grid gap-3.5">
                {[
                  'Choose a folder, or a pile of files.',
                  'Each file’s contents are compared, so a copy is found even under another name.',
                  'You get a list of copies, with the one to keep already suggested.',
                ].map((step, index) => (
                  <li key={step} className="flex gap-3 text-[14px] leading-snug text-ink-2">
                    <span
                      className="mono-num grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-[#12110d]"
                      style={{ background: ACCENT }}
                    >
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <Note icon="shield-check">
                It never deletes anything. You get a clear list, with a suggested copy to keep in
                each group, and you decide.
              </Note>
            </>
          )}

          {phase === 'running' && (
            <div className="grid grid-cols-1 gap-3" aria-live="polite">
              <p className="label">Looking for copies</p>
              <p className="text-[13.5px] leading-relaxed text-ink-2">
                Checking {plural(entries.length, 'file')}.
                {sizes.skipped.length > 0 &&
                  ` ${plural(sizes.skipped.length, 'is', 'are')} too big to check here (over 2 GB).`}
              </p>
              <div
                role="progressbar"
                aria-label="Reading files"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={
                  progress ? `${progress.done} of ${progress.total} files` : 'Starting'
                }
                className="h-2.5 overflow-hidden rounded-full bg-well"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{ width: `${percent}%`, background: ACCENT }}
                />
              </div>
              <p className="mono-num text-[13px] text-ink-2">
                {progress
                  ? `${progress.done.toLocaleString('en-US')} of ${plural(progress.total, 'file')} · ${formatSize(progress.bytesDone)} of ${formatSize(progress.bytesTotal)}`
                  : 'Starting…'}
              </p>
              {progress?.current && (
                <p className="truncate text-[12.5px] text-muted">Reading {progress.current.path}</p>
              )}
              {progress?.current && progress.current.size >= LARGE_FILE && (
                <Note icon="alert" tone="caution">
                  A big one: “{progress.current.name}” is {formatSize(progress.current.size)}.
                  Reading it can take a minute and a lot of memory, and this page may feel slow
                  until it’s done.
                </Note>
              )}
              <button
                type="button"
                disabled={stopping}
                onClick={() => {
                  setStopping(true);
                  scan.current?.abort();
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-well px-4 text-[14.5px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink disabled:opacity-60 lg:h-10 lg:text-[13.5px]"
              >
                <Icon name="x" size={15} />
                {stopping ? 'Stopping after this file…' : 'Stop'}
              </button>
            </div>
          )}

          {checked && (
            <>
              <div aria-live="polite">
                <p className="label">Exact copies</p>
                {total.groups ? (
                  <>
                    <p
                      className="mt-2 font-display text-[44px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                      style={{ fontVariationSettings: "'wdth' 110" }}
                    >
                      {formatSize(total.wasted)}
                    </p>
                    <p className="mt-2 text-[14.5px] text-ink-2">
                      {plural(total.copies, 'extra copy', 'extra copies')} ·{' '}
                      {formatSize(total.wasted)} you could free
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-[20px] font-semibold text-ink">No exact copies</p>
                    <p className="mt-1 text-[14px] text-ink-2">
                      {phase === 'stopped'
                        ? 'None among the files checked so far.'
                        : `Every one of the ${plural(entries.length, 'file')} is one of a kind.`}
                    </p>
                  </>
                )}
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  {total.groups ? `In ${plural(total.groups, 'group')}, among ` : 'Checked '}
                  {plural(entries.length, 'file')} ({formatSize(totalBytes)}).
                </p>
              </div>

              {phase === 'stopped' && (
                <Note icon="alert" tone="caution">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      Stopped early, with {read.toLocaleString('en-US')} of{' '}
                      {plural(sizes.candidates.length, 'file')} checked. The results cover only
                      those.
                    </span>
                    <button
                      type="button"
                      onClick={() => run(entries, hashes)}
                      className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 lg:min-h-0"
                    >
                      Carry on
                    </button>
                  </span>
                </Note>
              )}

              {total.groups > 0 && (
                <>
                  <fieldset className="grid gap-1.5">
                    <legend className="mb-1.5 text-[13.5px] font-medium text-ink-2">
                      Suggest keeping
                    </legend>
                    <Segmented
                      name={`${id}-keep`}
                      value={keepRule}
                      onChange={(rule) => {
                        setKeepRule(rule);
                        setPicks({});
                      }}
                      options={[
                        { value: 'oldest', label: 'The oldest' },
                        { value: 'shortest', label: 'The shortest path' },
                      ]}
                    />
                    <p className="text-[12.5px] text-muted">
                      A suggestion for every group. Change any of them below.
                    </p>
                  </fieldset>
                  <button
                    type="button"
                    onClick={downloadReport}
                    className="inline-flex h-14 items-center justify-center gap-2 rounded-[16px] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent,transparent)] transition-transform active:scale-[.985] sm:h-13 sm:text-[16px]"
                    style={{ background: ACCENT }}
                  >
                    <Icon name="download" size={19} /> Download the list of copies
                  </button>
                  <div className="grid gap-2 border-t border-line pt-4">
                    <p className="text-[14px] font-semibold text-ink">What to do next</p>
                    <ol className="grid list-decimal gap-1.5 pl-5 text-[13.5px] leading-relaxed text-ink-2 marker:text-muted">
                      <li>Nothing has been moved or deleted.</li>
                      <li>Download the list of copies, so you have every path in one place.</li>
                      <li>
                        {onlyNames
                          ? 'Find each file marked “Extra copy” on your computer'
                          : 'Open each folder on your computer'}{' '}
                        and move the files marked “Extra copy” to the Trash (the Recycle Bin on
                        Windows). Leave the ones marked “Keep”.
                      </li>
                      <li>Empty the Trash once you’re sure.</li>
                    </ol>
                  </div>
                </>
              )}
            </>
          )}
        </Surface>
      </aside>

      {checked && (
        <div className="grid min-w-0 gap-5 lg:col-start-1 lg:row-start-2">
          {(unreadable.length > 0 || sizes.skipped.length > 0 || sizes.empty > 0) && (
            <div className="grid gap-2">
              {unreadable.length > 0 && (
                <Note icon="alert" tone="caution">
                  {list(unreadable.map((entry) => quote(entry.name)))} couldn’t be read (moved,
                  deleted or locked?), so {unreadable.length === 1 ? 'it isn’t' : 'they aren’t'} in
                  the results.
                </Note>
              )}
              {sizes.skipped.length > 0 && (
                <Note icon="alert" tone="caution">
                  Too big to check here (over 2 GB):{' '}
                  {list(
                    sizes.skipped.map(
                      (entry) => `${quote(entry.name)} (${formatSize(entry.size)})`,
                    ),
                  )}
                  . Each shares its size with another file, so{' '}
                  {sizes.skipped.length === 1 ? 'it' : 'any of them'} could be a copy: compare those
                  by hand.
                </Note>
              )}
              {sizes.empty > 0 && (
                <Note icon="circle">
                  {plural(sizes.empty, 'empty file')} (0 bytes) left out: they take no space.
                </Note>
              )}
            </div>
          )}

          {groups.length > 0 && (
            <Surface
              as="section"
              aria-labelledby={`${id}-groups`}
              className="grid grid-cols-1 gap-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`${id}-groups`} className="text-[17px] font-semibold text-ink">
                  Exact copies · {plural(groups.length, 'group')}
                </h2>
                <p className="text-[12.5px] text-muted">Most space first</p>
              </div>
              <ol className="grid gap-3">
                {groups.slice(0, groupsShown).map((group) => (
                  <GroupCard
                    key={group.hash}
                    group={group}
                    name={`${id}-${group.hash.slice(0, 16)}`}
                    keep={keepFor(group)}
                    suggested={suggestKeep(group.files, keepRule).id}
                    keepRule={keepRule}
                    onKeep={(fileId) =>
                      setPicks((current) => ({ ...current, [group.hash]: fileId }))
                    }
                  />
                ))}
              </ol>
              {groups.length > groupsShown && (
                <button
                  type="button"
                  onClick={() => setGroupsShown((shown) => shown + PAGE)}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[11px] bg-well text-[14px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink lg:h-10"
                >
                  Show {Math.min(PAGE, groups.length - groupsShown)} more of{' '}
                  {groups.length - groupsShown} left
                </button>
              )}
            </Surface>
          )}

          {clashes.length > 0 && (
            <Surface
              as="section"
              aria-labelledby={`${id}-clashes`}
              className="grid grid-cols-1 gap-4"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-well text-ink-2">
                  <Icon name="files" size={18} />
                </span>
                <div className="min-w-0">
                  <h2 id={`${id}-clashes`} className="text-[17px] font-semibold text-ink">
                    Same name, different contents
                  </h2>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                    Not copies: these share a name, but what’s inside differs. Worth a look before
                    you tidy up, since one may be newer than the other.
                  </p>
                </div>
              </div>
              <ul className="grid gap-3">
                {clashes.slice(0, clashesShown).map((clash) => (
                  <li
                    key={clash.files.map((file) => file.id).join('-')}
                    className="rounded-[16px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-4"
                  >
                    <p className="px-1 text-[14.5px] font-semibold text-ink [overflow-wrap:anywhere]">
                      {clash.name}{' '}
                      <span className="font-normal text-muted">
                        · {plural(clash.files.length, 'file')}, {clash.versions} different
                      </span>
                    </p>
                    <ul className="mt-2 grid gap-1">
                      {clash.files.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-start gap-3 rounded-[12px] px-1 py-1.5"
                        >
                          <span
                            className="mono-num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-well text-[11px] font-semibold text-ink-2"
                            title={file.version ? `Version ${file.version}` : 'Couldn’t be checked'}
                          >
                            {file.version ?? '?'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] text-ink [overflow-wrap:anywhere]">
                              {folderOf(file.path) || 'Chosen on its own'}
                            </span>
                            <span className="block text-[12.5px] text-muted">
                              {formatSize(file.size)} · {when.format(file.modified)}
                            </span>
                          </span>
                          {file.id === clash.newest && (
                            <span className="shrink-0 rounded-full bg-positive-soft px-2 py-0.5 text-[11.5px] font-semibold text-positive">
                              Newest
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {clashes.length > clashesShown && (
                <button
                  type="button"
                  onClick={() => setClashesShown((shown) => shown + PAGE)}
                  className="inline-flex h-11 items-center justify-center rounded-[11px] bg-well text-[14px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink lg:h-10"
                >
                  Show more
                </button>
              )}
              <p className="text-[12.5px] text-muted">
                Files with the same letter have the same contents. A “?” couldn’t be checked.
              </p>
            </Surface>
          )}

          <p className="px-1 text-[12.5px] text-faint">
            Finds exact copies only. Photos that only look alike come later.
          </p>
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  name,
  keep,
  suggested,
  keepRule,
  onKeep,
}: {
  group: DuplicateGroup;
  name: string;
  keep: number;
  suggested: number;
  keepRule: KeepRule;
  onKeep: (fileId: number) => void;
}) {
  return (
    <li className="rounded-[18px] bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1.5 pt-1">
        <p className="text-[14.5px] font-semibold text-ink">
          {plural(group.files.length, 'copy', 'copies')} · {formatSize(group.size)} each
        </p>
        <p className="mono-num text-[12px] text-muted">
          <span className="text-ink-2">{formatSize(group.wasted)}</span> extra
        </p>
      </div>
      <fieldset className="mt-2 grid gap-1">
        <legend className="sr-only">Which copy to keep</legend>
        {group.files.map((file) => {
          const kept = file.id === keep;
          return (
            <label
              key={file.id}
              className={cn(
                'flex min-h-12 cursor-pointer items-start gap-3 rounded-[12px] px-2.5 py-2 transition-colors',
                kept
                  ? 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
                  : 'hover:bg-ink/5',
              )}
            >
              <input
                type="radio"
                name={name}
                checked={kept}
                onChange={() => onKeep(file.id)}
                className="mt-[3px] size-[18px] shrink-0 accent-[#9fb2ff]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink [overflow-wrap:anywhere]">
                  {file.name}
                </span>
                <span className="block text-[12.5px] text-muted [overflow-wrap:anywhere]">
                  {folderOf(file.path) || 'Chosen on its own'} · {when.format(file.modified)}
                </span>
              </span>
              <span
                className={cn(
                  'mt-px shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
                  kept ? 'text-[#12110d]' : 'bg-well text-muted',
                )}
                style={kept ? { background: ACCENT } : undefined}
              >
                {kept ? 'Keep' : 'Extra copy'}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="px-1.5 pt-2 pb-0.5 text-[12px] text-muted">
        {keep === suggested ? (
          `Suggested: ${keepRule === 'oldest' ? 'the oldest copy' : 'the copy with the shortest path'}.`
        ) : (
          <>
            Your pick.{' '}
            <button
              type="button"
              onClick={() => onKeep(suggested)}
              className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
            >
              Back to the suggestion
            </button>
          </>
        )}
      </p>
    </li>
  );
}
