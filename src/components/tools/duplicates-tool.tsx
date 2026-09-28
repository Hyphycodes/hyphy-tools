'use client';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
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
import { AddMore } from './clean-add-more';
import { CountUp, MoreOptions, Payoff, SampleButton } from './kit';

/*
 * Duplicates: exact copies among the files or folder a person chooses. Sizes are compared first;
 * only files that share a size are read, one at a time, and fingerprinted on this device. Each set
 * of copies is shown as matching cards drawn together, the one to keep lit and the extras marked;
 * a tap on a card keeps that one instead. Nothing is changed or deleted: a web page can't, and
 * this one doesn't try. The list of copies downloads as a CSV.
 */

const ACCENT = 'var(--accent, #ffa24c)';
/** A counting number in the headline's own type (CountUp is monospaced by default). */
const DISPLAY_NUMBER =
  '![font-family:inherit] ![font-variation-settings:inherit] ![letter-spacing:inherit]';
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

/** A file's kind, as a little colored tile: photos, documents, sound, the rest. */
const KINDS: { test: RegExp; icon: IconName; tint: string }[] = [
  {
    test: /^(jpe?g|png|gif|webp|heic|heif|avif|tiff?|bmp|raw|cr2|nef|dng)$/i,
    icon: 'image',
    tint: '#ffcf8a',
  },
  { test: /^(pdf)$/i, icon: 'pdf', tint: '#ffb3a1' },
  { test: /^(mp3|m4a|wav|aac|flac|ogg)$/i, icon: 'music', tint: '#d9c8ff' },
  { test: /^(mp4|mov|m4v|avi|mkv|webm)$/i, icon: 'video', tint: '#a9d8ff' },
  { test: /^(txt|md|docx?|rtf|pages|odt|csv|xlsx?|numbers)$/i, icon: 'file-text', tint: '#c9e7b5' },
];
function kindOf(name: string) {
  const extension = splitName(name).extension;
  const kind = KINDS.find((item) => item.test.test(extension));
  return { extension, icon: kind?.icon ?? ('files' as IconName), tint: kind?.tint ?? '#e7c7a3' };
}

/** Two matching files, drawn together: the whole tool, as a picture. */
function PairArt() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto flex h-[132px] w-[248px] items-center justify-center"
    >
      {[0, 1].map((side) => (
        <span
          key={side}
          className={cn(
            'relative grid h-[112px] w-[86px] place-items-center rounded-[14px] bg-surface shadow-lift',
            side === 0 ? 'fx-pair-l -rotate-6' : 'fx-pair-r rotate-6 opacity-90',
          )}
          style={{ animationDelay: '120ms' }}
        >
          <span
            className="block size-12 rounded-[10px]"
            style={{ background: 'linear-gradient(160deg,#ffcf8a,#ff8a3d 60%,#b35300)' }}
          />
          <span className="absolute bottom-3 left-3 h-1.5 w-10 rounded-full bg-ink/15" />
          {side === 1 && (
            <span
              className="absolute -top-2.5 -right-2.5 grid size-7 place-items-center rounded-full text-[var(--on-accent,#12110d)] shadow-lift"
              style={{ background: ACCENT }}
            >
              <Icon name="copy" size={14} />
            </span>
          )}
        </span>
      ))}
      <span
        className="fx-pop absolute grid size-9 place-items-center rounded-full bg-ink text-[18px] font-bold text-on-ink shadow-lift"
        style={{ animationDelay: '380ms' }}
      >
        =
      </span>
    </div>
  );
}

/**
 * The way in: a folder, above all. Shaped like the other tools' drop objects; files or a folder
 * dragged anywhere over the page light it up and count.
 */
function FolderDrop({
  onFiles,
  onSample,
}: {
  onFiles: (files: File[]) => void;
  onSample: () => void;
}) {
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const take = useRef(onFiles);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    take.current = onFiles;
  });
  useEffect(() => {
    let depth = 0;
    const has = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => {
      if (!has(event)) return;
      depth += 1;
      setLit(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setLit(false);
    };
    const over = (event: DragEvent) => {
      if (has(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      depth = 0;
      setLit(false);
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      take.current(Array.from(event.dataTransfer.files));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  const pick = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  };
  return (
    <div className="flex min-w-0 flex-col items-center">
      <div
        data-shape="files"
        className={cn(
          'drop-object fx-move relative flex w-full flex-col items-center justify-center text-center',
          lit && 'is-lit',
        )}
      >
        <PairArt />
        <p className="mt-4 font-display text-[26px] leading-[1.02] font-bold tracking-[-0.03em] text-balance text-ink sm:text-[32px]">
          {lit ? 'Let go to check' : 'Which folder?'}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => folderInput.current?.click()}
            className="inline-flex h-13 items-center gap-2 rounded-full px-6 text-[16px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-16px_var(--accent)] transition-transform active:scale-[.97]"
            style={{ background: ACCENT }}
          >
            <Icon name="folder-open" size={18} /> Choose a folder
          </button>
          <button
            type="button"
            onClick={() => filesInput.current?.click()}
            className="inline-flex h-13 items-center gap-2 rounded-full bg-ink/[.06] px-5 text-[15px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink"
          >
            <Icon name="files" size={17} /> Some files
          </button>
        </div>
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
          pick(event.target.files);
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
          pick(event.target.files);
          event.target.value = '';
        }}
      />
      <SampleButton onClick={onSample} className="mt-3">
        Try a sample folder
      </SampleButton>
    </div>
  );
}

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
      <div className="mx-auto grid w-full max-w-[600px] gap-3 pt-2 pb-6 sm:pt-4">
        <FolderDrop onFiles={take} onSample={() => add(sampleFiles())} />
        {note && (
          <p role="status" className="text-center text-[13.5px] leading-relaxed text-ink-2">
            {note}
          </p>
        )}
      </div>
    );

  const percent =
    progress && progress.bytesTotal
      ? Math.round((progress.bytesDone / progress.bytesTotal) * 100)
      : 0;

  return (
    <div className="mx-auto grid w-full max-w-[980px] gap-5 pb-4">
      {/* What's here */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-[13px] text-[var(--on-accent,#12110d)]"
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
        <AddMore onFiles={take} disabled={phase === 'running'} />
        <button
          type="button"
          onClick={startOver}
          className="h-11 shrink-0 rounded-full px-3.5 text-[14px] font-medium text-ink-2 hover:bg-ink/[.06] hover:text-ink lg:h-10 lg:text-[13.5px]"
        >
          Start over
        </button>
      </div>
      {note && (
        <p role="status" className="-mt-2 text-[13px] leading-relaxed text-ink-2">
          {note}
        </p>
      )}

      {phase === 'running' && (
        <section
          aria-live="polite"
          className="fx-pop grid justify-items-center gap-4 rounded-[28px] bg-surface px-5 py-8 text-center shadow-lift sm:py-10"
        >
          <Comparing />
          <p className="font-display text-[28px] leading-none font-bold tracking-[-0.03em] text-ink sm:text-[34px]">
            Looking for copies
          </p>
          <div
            role="progressbar"
            aria-label="Reading files"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={progress ? `${progress.done} of ${progress.total} files` : 'Starting'}
            className="h-3 w-full max-w-[420px] overflow-hidden rounded-full bg-ink/[.07]"
          >
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{ width: `${Math.max(4, percent)}%`, background: ACCENT }}
            />
          </div>
          <p className="mono-num text-[13px] text-ink-2">
            {progress
              ? `${progress.done.toLocaleString('en-US')} of ${plural(progress.total, 'file')} · ${formatSize(progress.bytesDone)} of ${formatSize(progress.bytesTotal)}`
              : 'Starting…'}
          </p>
          {progress?.current && (
            <p className="max-w-full truncate text-[12.5px] text-muted">
              Reading {progress.current.path}
            </p>
          )}
          {sizes.skipped.length > 0 && (
            <p className="text-[12.5px] text-muted">
              {plural(sizes.skipped.length, 'is', 'are')} too big to check here (over 2 GB).
            </p>
          )}
          {progress?.current && progress.current.size >= LARGE_FILE && (
            <p className="max-w-[440px] rounded-[12px] bg-caution-soft px-3 py-2 text-[13px] text-caution">
              A big one: “{progress.current.name}” is {formatSize(progress.current.size)}. Reading
              it can take a minute, and the page may feel slow until it’s done.
            </p>
          )}
          <button
            type="button"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              scan.current?.abort();
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink/[.06] px-5 text-[14.5px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink disabled:opacity-60"
          >
            <Icon name="x" size={15} />
            {stopping ? 'Stopping after this file…' : 'Stop'}
          </button>
        </section>
      )}

      {checked && (
        <Payoff
          headline={
            total.groups ? (
              <>
                <Icon name="check" size={16} strokeWidth={3} />
                {plural(total.copies, 'copy', 'copies')} found
              </>
            ) : (
              <>
                <Icon name="check" size={16} strokeWidth={3} />
                {plural(entries.length, 'file')} checked
              </>
            )
          }
          value={
            total.groups ? (
              <CountUp
                value={total.wasted}
                format={formatSize}
                duration={600}
                className={DISPLAY_NUMBER}
              />
            ) : (
              'No copies'
            )
          }
          caption={
            total.groups
              ? 'to free up'
              : phase === 'stopped'
                ? 'None among the files checked so far.'
                : 'Every file here is one of a kind.'
          }
          action={
            total.groups
              ? { label: 'Download the list of copies', icon: 'download', onClick: downloadReport }
              : undefined
          }
        >
          {phase === 'stopped' && (
            <p className="mx-auto flex max-w-[520px] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[14px] bg-caution-soft px-4 py-2.5 text-[13.5px] text-caution">
              <span>
                Stopped early: {read.toLocaleString('en-US')} of{' '}
                {plural(sizes.candidates.length, 'file')} checked.
              </span>
              <button
                type="button"
                onClick={() => run(entries, hashes)}
                className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
              >
                Carry on
              </button>
            </p>
          )}
          {total.groups > 0 && (
            <p className="text-[14px] text-ink-2">
              In {plural(total.groups, 'set')}. Nothing has been deleted: you choose.
            </p>
          )}
        </Payoff>
      )}

      {checked && (unreadable.length > 0 || sizes.skipped.length > 0 || sizes.empty > 0) && (
        <ul className="grid gap-1.5 text-[13px] leading-relaxed">
          {unreadable.length > 0 && (
            <li className="flex gap-2 text-caution">
              <Icon name="alert" size={14} className="mt-[3px] shrink-0" />
              <span>
                {list(unreadable.map((entry) => quote(entry.name)))} couldn’t be read (moved,
                deleted or locked?), so {unreadable.length === 1 ? 'it isn’t' : 'they aren’t'} in
                the results.
              </span>
            </li>
          )}
          {sizes.skipped.length > 0 && (
            <li className="flex gap-2 text-caution">
              <Icon name="alert" size={14} className="mt-[3px] shrink-0" />
              <span>
                Too big to check here (over 2 GB):{' '}
                {list(
                  sizes.skipped.map((entry) => `${quote(entry.name)} (${formatSize(entry.size)})`),
                )}
                . {sizes.skipped.length === 1 ? 'It shares' : 'Each shares'} a size with another
                file, so compare {sizes.skipped.length === 1 ? 'it' : 'those'} by hand.
              </span>
            </li>
          )}
          {sizes.empty > 0 && (
            <li className="flex gap-2 text-muted">
              <Icon name="circle" size={14} className="mt-[3px] shrink-0" />
              <span>
                {plural(sizes.empty, 'empty file')} (0 bytes) left out: they take no space.
              </span>
            </li>
          )}
        </ul>
      )}

      {checked && groups.length > 0 && (
        <section aria-labelledby={`${id}-groups`} className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 id={`${id}-groups`} className="text-[17px] font-semibold text-ink">
              Tap the one to keep
            </h2>
            <div
              role="radiogroup"
              aria-label="Suggest keeping"
              className="flex items-center gap-1 rounded-full bg-ink/[.06] p-1"
            >
              {(
                [
                  ['oldest', 'Oldest'],
                  ['shortest', 'Shortest path'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={keepRule === value}
                  onClick={() => {
                    setKeepRule(value);
                    setPicks({});
                  }}
                  className={cn(
                    'fx-move h-10 rounded-full px-3.5 text-[13.5px] font-medium lg:h-9',
                    keepRule === value
                      ? 'bg-surface text-ink shadow-card'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ol className="grid gap-3">
            {groups.slice(0, groupsShown).map((group, index) => (
              <GroupCard
                key={group.hash}
                group={group}
                index={index}
                keep={keepFor(group)}
                suggested={suggestKeep(group.files, keepRule).id}
                keepRule={keepRule}
                onKeep={(fileId) => setPicks((current) => ({ ...current, [group.hash]: fileId }))}
              />
            ))}
          </ol>
          {groups.length > groupsShown && (
            <button
              type="button"
              onClick={() => setGroupsShown((shown) => shown + PAGE)}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-ink/[.06] text-[14px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink"
            >
              Show {Math.min(PAGE, groups.length - groupsShown)} more of{' '}
              {groups.length - groupsShown} left
            </button>
          )}
          <MoreOptions label="How to clean up">
            <ol className="grid list-decimal gap-1.5 pl-5 text-[14px] leading-relaxed text-ink-2 marker:text-muted">
              <li>Download the list of copies, so you have every path in one place.</li>
              <li>
                {onlyNames
                  ? 'Find each file marked “Extra copy” on your computer'
                  : 'Open each folder on your computer'}{' '}
                and move the files marked “Extra copy” to the Trash (the Recycle Bin on Windows).
                Leave the ones marked “Keep”.
              </li>
              <li>Empty the Trash once you’re sure.</li>
            </ol>
          </MoreOptions>
        </section>
      )}

      {checked && clashes.length > 0 && (
        <section aria-labelledby={`${id}-clashes`} className="grid min-w-0 gap-3">
          <div>
            <h2 id={`${id}-clashes`} className="text-[17px] font-semibold text-ink">
              Same name, different contents
            </h2>
            <p className="mt-0.5 text-[13.5px] text-muted">Not copies. One may be newer.</p>
          </div>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {clashes.slice(0, clashesShown).map((clash) => (
              <li
                key={clash.files.map((file) => file.id).join('-')}
                className="rounded-[20px] bg-surface p-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                <p className="px-1 text-[14.5px] font-semibold text-ink [overflow-wrap:anywhere]">
                  {clash.name}{' '}
                  <span className="font-normal text-muted">· {clash.versions} versions</span>
                </p>
                <ul className="mt-1.5 grid gap-0.5">
                  {clash.files.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-start gap-2.5 rounded-[12px] px-1 py-1.5"
                    >
                      <span
                        className="mono-num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ink/[.07] text-[11px] font-semibold text-ink-2"
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
              className="inline-flex h-11 items-center justify-center rounded-full bg-ink/[.06] text-[14px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink"
            >
              Show more
            </button>
          )}
          <p className="text-[12.5px] text-muted">
            The same letter means the same contents. A “?” couldn’t be checked.
          </p>
        </section>
      )}

      {checked && (
        <p className="px-1 text-[12.5px] text-faint">
          Finds exact copies only. Photos that only look alike come later.
        </p>
      )}
    </div>
  );
}

/** Two cards meeting while the files are compared. */
function Comparing() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1.5">
      {[0, 1].map((side) => (
        <span
          key={side}
          className={cn(
            'grid h-14 w-11 place-items-center rounded-[9px] bg-ink/[.06] shadow-[inset_0_0_0_1px_var(--color-line)]',
            side === 0 ? 'fx-pair-l' : 'fx-pair-r',
          )}
        >
          <span className="size-5 rounded-[5px]" style={{ background: ACCENT }} />
        </span>
      ))}
    </span>
  );
}

/**
 * One set of copies, drawn together: the kept card lit, the extras dashed and marked. Tap a card to
 * keep that one instead.
 */
function GroupCard({
  group,
  index,
  keep,
  suggested,
  keepRule,
  onKeep,
}: {
  group: DuplicateGroup;
  index: number;
  keep: number;
  suggested: number;
  keepRule: KeepRule;
  onKeep: (fileId: number) => void;
}) {
  const kind = kindOf(group.files[0].name);
  // The suggested keeper leads and its copies are drawn to it; a tap moves "Keep", not the cards.
  const files = [...group.files].sort(
    (a, b) => Number(b.id === suggested) - Number(a.id === suggested),
  );
  return (
    <li
      className="fx-rise rounded-[24px] bg-surface p-2.5 shadow-card sm:p-3"
      style={{ '--i': Math.min(index, 8) } as CSSProperties}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1.5 pt-0.5 pb-2">
        <p className="text-[14px] font-semibold text-ink">
          {plural(group.files.length, 'copy', 'copies')}{' '}
          <span className="font-normal text-muted">· {formatSize(group.size)} each</span>
        </p>
        <p className="mono-num text-[13px] font-semibold text-[var(--accent-ink)]">
          {formatSize(group.wasted)} to free
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Which copy to keep"
        className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]"
      >
        {files.map((file, position) => {
          const kept = file.id === keep;
          return (
            <button
              key={file.id}
              type="button"
              role="radio"
              aria-checked={kept}
              onClick={() => onKeep(file.id)}
              className={cn(
                'fx-move relative flex min-h-[124px] min-w-0 flex-col items-start gap-2 rounded-[18px] p-3 text-left active:scale-[.97]',
                position % 2 ? 'fx-pair-r' : 'fx-pair-l',
                kept
                  ? 'fx-ping bg-surface shadow-[inset_0_0_0_2px_var(--accent-ink),0_12px_26px_-16px_var(--accent)]'
                  : 'bg-ink/[.035] outline-[1.5px] outline-offset-[-1.5px] outline-[var(--color-line-strong)] outline-dashed hover:bg-ink/[.06]',
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-[10px] text-[#2a1b0e]',
                    !kept && 'opacity-60',
                  )}
                  style={{ background: kind.tint }}
                >
                  <Icon name={kind.icon} size={17} />
                </span>
                <span
                  className={cn(
                    'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold',
                    kept ? 'text-[var(--on-accent,#12110d)]' : 'bg-ink/[.07] text-muted',
                  )}
                  style={kept ? { background: ACCENT } : undefined}
                >
                  <Icon name={kept ? 'check' : 'trash'} size={12} strokeWidth={kept ? 3 : 2} />
                  {kept ? 'Keep' : 'Extra copy'}
                </span>
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span
                  className={cn(
                    'line-clamp-2 text-[14px] font-semibold [overflow-wrap:anywhere]',
                    kept ? 'text-ink' : 'text-ink-2',
                  )}
                >
                  {file.name}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted">
                  <Icon name="folder-open" size={12} className="shrink-0" />
                  <span className="truncate">{folderOf(file.path) || 'Chosen on its own'}</span>
                </span>
                <span className="text-[12px] text-muted">{when.format(file.modified)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="px-1.5 pt-2 text-[12.5px] text-muted">
        {keep === suggested ? (
          `Keeping ${keepRule === 'oldest' ? 'the oldest' : 'the shortest path'}.`
        ) : (
          <>
            Your pick.{' '}
            <button
              type="button"
              onClick={() => onKeep(suggested)}
              className="inline-flex min-h-11 items-center font-medium text-ink-2 underline underline-offset-2 hover:text-ink lg:min-h-0"
            >
              Back to the suggestion
            </button>
          </>
        )}
      </p>
    </li>
  );
}
