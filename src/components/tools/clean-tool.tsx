'use client';
import {
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { download, downloadText, slugName } from '@/lib/files/download';
import { zip, type ZipEntry } from '@/lib/files/zip';
import { formatBytes, plural } from '@/lib/platform/format';
import {
  diffNames,
  folderOf,
  MAX_BYTES,
  MAX_FILES,
  newRule,
  planRenames,
  PRESETS,
  presetRules,
  renameList,
  RULE_TYPES,
  splitName,
  START_RULES,
  suggestPreset,
  type DiffPart,
  type Order,
  type PresetId,
  type Problem,
  type RenameRow,
  type Rule,
  type RuleType,
} from '@/lib/tools/rename';
import {
  ActionBar,
  Advanced,
  CopyButton,
  CountUp,
  DropObject,
  IconButton,
  Payoff,
  PillButton,
  SampleButton,
} from './kit';
import { AddMore } from './clean-add-more';

/*
 * Clean: messy names in, tidy names out. A likely fix is picked from the names themselves, every
 * new name flips into place as the rules change, and the result is renamed copies in a zip (plus
 * a CSV of old → new): browsers can't rename files where they sit. Files are only read here.
 */

const ACCENT = 'var(--accent, #c7b5ff)';
/** A counting number in the headline's own type (CountUp is monospaced by default). */
const DISPLAY_NUMBER =
  '![font-family:inherit] ![font-variation-settings:inherit] ![letter-spacing:inherit]';
/** Rows shown before "Show all": enough to check, light enough to stay quick. */
const SHOWN = 200;
/** Rows that flip one after another; the rest flip together. */
const STAGGER = 14;

type Item = { id: number; file: File; folder: string };

const RULES: Record<RuleType, { title: string; icon: IconName }> = {
  replace: { title: 'Find & replace', icon: 'replace' },
  strip: { title: 'Drop odd characters', icon: 'sparkles' },
  spaces: { title: 'Tidy spaces', icon: 'wrench' },
  case: { title: 'Change case', icon: 'type' },
  prefix: { title: 'Add to the start', icon: 'arrow-left' },
  suffix: { title: 'Add to the end', icon: 'arrow-right' },
  number: { title: 'Number them', icon: 'list-ordered' },
  date: { title: 'Add the date', icon: 'calendar' },
  extension: { title: 'Extension case', icon: 'file-text' },
};

const ORDERS: { value: Order; label: string; short: string }[] = [
  { value: 'name', label: 'By name', short: 'by name' },
  { value: 'modified', label: 'Oldest first', short: 'oldest first' },
  { value: 'size', label: 'Smallest first', short: 'smallest first' },
  { value: 'added', label: 'As added', short: 'as added' },
];

const SEPARATORS = [
  { value: ' ', label: 'Space' },
  { value: '-', label: '-' },
  { value: '_', label: '_' },
  { value: ' - ', label: '␣-␣' },
  { value: '', label: 'None' },
];

const PROBLEMS: Record<Problem, { label: string; detail: string }> = {
  duplicate: {
    label: 'Numbered to avoid a clash',
    detail: 'Another file would get the same name, so (2), (3)… was added.',
  },
  empty: {
    label: 'Kept its old name',
    detail: 'The rules left nothing of the name, so it keeps its old one.',
  },
  long: {
    label: 'Very long',
    detail: 'Over 200 characters. Some systems can’t open names that long.',
  },
  chars: {
    label: 'Characters replaced',
    detail:
      'Some systems reject / \\ : * ? " < > | and dots or spaces at the very end, so those became _ or were dropped.',
  },
  reserved: {
    label: 'Reserved on Windows',
    detail: 'Windows keeps names like CON, NUL and COM1 for itself, so it won’t open this one.',
  },
};

/** What Clean does, before any files are chosen. */
const EXAMPLES = [
  ['IMG_2041.JPG', '2026-05-03 img-2041.jpg'],
  ['Party 🎉 invite FINAL.pdf', 'party-invite-final.pdf'],
  ['notes   from  rosa .TXT', 'notes-from-rosa.txt'],
].map(([before, after]) => ({ key: before, ...diffNames(before, after) }));

/** Messy names flipping into tidy ones: the whole tool, as a picture. */
function CleanArt() {
  return (
    <ol aria-hidden="true" className="mx-auto grid max-w-[420px] gap-2 text-left">
      {EXAMPLES.map((example, index) => (
        <li
          key={example.key}
          className={cn(
            'flex min-w-0 items-center gap-3 rounded-[14px] bg-ink/[.04] px-3 py-2.5',
            index === 2 && 'max-sm:hidden',
          )}
        >
          <span
            className="grid size-8 shrink-0 place-items-center rounded-[9px] text-[var(--on-accent,#12110d)]"
            style={{ background: ACCENT }}
          >
            <Icon name={index === 0 ? 'image' : 'file-text'} size={16} />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate text-[12.5px] text-muted line-through decoration-faint/70">
              {example.before.map((part) => part.text).join('')}
            </span>
            <span
              className="fx-flip truncate text-[14.5px] font-medium text-ink"
              style={{ '--i': 6 + index * 4 } as CSSProperties}
            >
              <DiffText parts={example.after} />
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A new name with what the rules added lit up. */
function DiffText({ parts }: { parts: DiffPart[] }) {
  return parts.map((part, index) =>
    part.changed ? (
      <ins
        key={index}
        className="rounded-[4px] px-px text-[var(--accent-ink)] no-underline"
        style={{ background: `color-mix(in oklab, ${ACCENT} 34%, transparent)` }}
      >
        {part.text}
      </ins>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

/** A small shoot's worth of messy names, made on this device: real images and notes. */
const SAMPLES: { path: string; modified: string; color?: string }[] = [
  { path: 'Sample shoot/IMG_2041.JPG', modified: '2026-05-03T09:14', color: '#c7b5ff' },
  { path: 'Sample shoot/IMG_2042.JPG', modified: '2026-05-03T09:21', color: '#9fb2ff' },
  { path: 'Sample shoot/IMG_2.JPG', modified: '2026-05-01T17:40', color: '#ffc53d' },
  { path: 'Sample shoot/IMG_10.JPG', modified: '2026-05-02T08:05', color: '#ff9e7a' },
  {
    path: 'Sample shoot/Screenshot 2026-05-04 at 10.12.45.png',
    modified: '2026-05-04T10:12',
    color: '#7ce0c3',
  },
  { path: 'Sample shoot/Salt & Ember 🎉 menu_FINAL.TXT', modified: '2026-05-05T12:30' },
  { path: 'Sample shoot/notes   from  rosa .TXT', modified: '2026-05-05T18:02' },
  { path: 'Sample shoot/Café  receipt.jpeg', modified: '2026-05-06T13:45', color: '#ff8ad8' },
  { path: 'Sample shoot/Day 2/IMG_2041.JPG', modified: '2026-05-07T07:58', color: '#b8f35a' },
];

async function drawSample(color: string, type: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  const light = context.createLinearGradient(0, 0, 480, 360);
  light.addColorStop(0, color);
  light.addColorStop(1, '#16150f');
  context.fillStyle = light;
  context.fillRect(0, 0, 480, 360);
  context.fillStyle = 'rgb(255 255 255 / .18)';
  context.beginPath();
  context.arc(330, 130, 70, 0, Math.PI * 2);
  context.fill();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('No sample');
  return blob;
}

async function sampleFiles() {
  return Promise.all(
    SAMPLES.map(async (sample) => {
      const name = sample.path.slice(sample.path.lastIndexOf('/') + 1);
      const extension = splitName(name).extension.toLowerCase();
      const blob = sample.color
        ? await drawSample(sample.color, extension === 'png' ? 'image/png' : 'image/jpeg')
        : new Blob(['A sample note made by Hyphy Clean. Nothing important inside.\n'], {
            type: 'text/plain',
          });
      const file = new File([blob], name, {
        type: blob.type,
        lastModified: new Date(sample.modified).getTime(),
      });
      return { file, folder: folderOf(sample.path) };
    }),
  );
}

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

function list(names: string[]) {
  const quoted = names.map((name) => `“${name}”`);
  if (quoted.length <= 2) return quoted.join(' and ');
  return `${quoted[0]}, ${quoted[1]} and ${quoted.length - 2} more`;
}

/** Typed text for a one-line summary, with spaces you can see. */
const asTyped = (text: string) => (text.trim() ? `“${text}”` : text === ' ' ? 'a space' : 'spaces');

function summary(rule: Rule, error?: string) {
  if (error) return 'Skipped until the pattern is fixed';
  switch (rule.type) {
    case 'replace':
      if (!rule.find) return 'Type what to find';
      return `${asTyped(rule.find)} → ${rule.with ? asTyped(rule.with) : 'nothing'}${
        rule.pattern ? ' · pattern' : ''
      }${rule.matchCase ? ' · match case' : ''}`;
    case 'strip':
      return rule.plain
        ? 'Emoji and symbols go · é becomes e'
        : 'Emoji, symbols and invisible characters go';
    case 'spaces':
      return rule.to === ' ' ? 'Trimmed, single spaces' : `Spaces become ${rule.to}`;
    case 'case':
      return {
        lower: 'lowercase',
        upper: 'UPPERCASE',
        title: 'Title Case',
        sentence: 'Sentence case',
      }[rule.to];
    case 'prefix':
      return rule.text ? `“${rule.text}” before each name` : 'Type what to add';
    case 'suffix':
      return rule.text ? `“${rule.text}” after each name` : 'Type what to add';
    case 'number': {
      const digits = rule.digits || 2;
      const first = String(rule.start).padStart(digits, '0');
      const second = String(rule.start + rule.step).padStart(digits, '0');
      const order = ORDERS.find((option) => option.value === rule.order)?.short;
      return `${rule.name.trim() ? `“${rule.name.trim()}” ` : ''}${first}, ${second}… ${order}`;
    }
    case 'date':
      return `Date modified ${rule.at === 'start' ? 'first' : 'last'} · 2026-05-03`;
    case 'extension':
      return { keep: 'Left as it is', lower: 'Lowercase: .jpg', upper: 'Uppercase: .JPG' }[rule.to];
  }
}

export function CleanTool() {
  const id = useId();
  const [items, setItems] = useState<Item[]>([]);
  // Empty until files arrive: then a likely quick fix is picked from their names.
  const [rules, setRules] = useState<Rule[]>([]);
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [suggested, setSuggested] = useState<PresetId | null>(null);
  const [undo, setUndo] = useState<{ rules: Rule[]; preset: PresetId | null } | null>(null);
  const [keepFolders, setKeepFolders] = useState(true);
  const [filter, setFilter] = useState<'all' | 'changed' | 'attention'>('all');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [done, setDone] = useState<{ name: string; count: number } | null>(null);
  const nextItem = useRef(0);
  const nextRule = useRef(0);

  const files = useMemo(
    () =>
      items.map(({ file, folder }) => ({
        name: file.name,
        folder,
        size: file.size,
        modified: file.lastModified,
      })),
    [items],
  );
  const folders = useMemo(() => new Set(files.map((file) => file.folder).filter(Boolean)), [files]);
  const tops = new Set(files.map((file) => file.folder.split('/')[0]));
  const topFolder = tops.size === 1 ? [...tops][0] : '';
  const zipFolders = folders.size > 0 && keepFolders;
  const plan = useMemo(
    () => planRenames(files, rules, { keepFolders: zipFolders }),
    [files, rules, zipFolders],
  );
  // The list trails typing a little on big batches, so the rule being edited stays quick.
  const view = useDeferredValue(plan);
  const csvText = useMemo(() => renameList(view), [view]);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const rows = view.rows.filter((row) =>
    filter === 'all' ? true : filter === 'changed' ? row.changed : row.problems.length > 0,
  );
  const visibleRows = showAll ? rows : rows.slice(0, SHOWN);
  const problemsHere = new Set(view.rows.flatMap((row) => row.problems));
  const skipped = Object.keys(plan.errors).length;

  /** A fresh batch starts with the quick fix its names suggest. */
  function startWith(names: string[], batch: string) {
    if (rules.length && JSON.stringify(rules) !== JSON.stringify(START_RULES)) return;
    const pick = suggestPreset(names);
    setRules(presetRules(pick, batch || 'Batch'));
    setPreset(pick);
    setSuggested(pick);
  }

  async function add(incoming: File[]) {
    if (busy || !incoming.length) return;
    const keyOf = (file: File, folder: string) =>
      `${folder}/${file.name}/${file.size}/${file.lastModified}`;
    const known = new Set(items.map((item) => keyOf(item.file, item.folder)));
    let bytes = items.reduce((sum, item) => sum + item.file.size, 0);
    const accepted: Item[] = [];
    const folderEntries: string[] = [];
    let repeats = 0;
    let over = 0;
    for (const file of incoming) {
      const folder = folderOf(file.webkitRelativePath);
      const key = keyOf(file, folder);
      if (known.has(key)) repeats += 1;
      // Only a drop can hand over a folder itself (a folder pick lists what's inside).
      else if (
        !file.webkitRelativePath &&
        !file.type &&
        !splitName(file.name).extension &&
        !(await readable(file))
      )
        folderEntries.push(file.name);
      else if (items.length + accepted.length >= MAX_FILES || bytes + file.size > MAX_BYTES)
        over += 1;
      else {
        known.add(key);
        bytes += file.size;
        accepted.push({ id: nextItem.current++, file, folder });
      }
    }
    if (accepted.length) {
      setItems((current) => [...current, ...accepted]);
      setShowAll(false);
      setStatus('');
      setDone(null);
      const batchTops = new Set(accepted.map((item) => item.folder.split('/')[0]));
      startWith(
        accepted.map((item) => item.file.name),
        !items.length && batchTops.size === 1 ? [...batchTops][0] : '',
      );
    }
    const notes: string[] = [];
    if (accepted.length && items.length) notes.push(`Added ${plural(accepted.length, 'file')}.`);
    if (repeats)
      notes.push(`${plural(repeats, 'file')} ${repeats === 1 ? 'was' : 'were'} already here.`);
    if (over)
      notes.push(
        `Clean takes up to 1,000 files and 1 GB at a time, so ${plural(over, 'file')} ${
          over === 1 ? 'wasn’t' : 'weren’t'
        } added.`,
      );
    if (folderEntries.length)
      notes.push(
        `${list(folderEntries)} ${folderEntries.length === 1 ? 'is a folder' : 'are folders'}: use A folder to add what’s inside.`,
      );
    setNote(notes.join(' '));
  }

  async function trySample() {
    setBusy(true);
    setNote('');
    try {
      const samples = await sampleFiles();
      setItems(samples.map((sample) => ({ id: nextItem.current++, ...sample })));
      setDone(null);
      startWith(
        samples.map((sample) => sample.file.name),
        'Sample shoot',
      );
    } catch {
      setNote('We couldn’t make samples here. Choose a few of your own files instead.');
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setItems([]);
    setRules([]);
    setPreset(null);
    setSuggested(null);
    setUndo(null);
    setNote('');
    setStatus('');
    setDone(null);
    setFilter('all');
  }

  /** Any hand-made change: the rules are no longer exactly a quick fix. */
  const edit = (next: Rule[]) => {
    setRules(next);
    setPreset(null);
  };
  const changeRule = (next: Rule) => edit(rules.map((rule) => (rule.id === next.id ? next : rule)));
  const addRule = (type: RuleType) => {
    edit([...rules, newRule(type, `r${++nextRule.current}`)]);
    setUndo(null);
  };
  /** A rule chip: tap to turn it on (added the first time), tap again to turn it off. */
  const toggleRule = (type: RuleType) => {
    const own = rules.filter((rule) => rule.type === type);
    if (!own.length) return addRule(type);
    const on = !own.some((rule) => rule.on);
    edit(rules.map((rule) => (rule.type === type ? { ...rule, on } : rule)));
  };
  const moveRule = (index: number, by: -1 | 1) => {
    const next = [...rules];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    edit(next);
  };
  const applyPreset = (pick: PresetId) => {
    if (pick === preset) return;
    setUndo({ rules, preset });
    // Number a batch names it after the chosen folder, when there is one.
    setRules(presetRules(pick, topFolder || 'Batch'));
    setPreset(pick);
  };

  async function downloadZip() {
    setBusy(true);
    setStatus(`Checking ${plural(plan.rows.length, 'file')}…`);
    try {
      const entries: ZipEntry[] = [];
      const unreadable: string[] = [];
      for (const row of plan.rows) {
        const { file } = items[row.index];
        if (await readable(file))
          entries.push({ name: row.path, data: file, modified: new Date(file.lastModified) });
        else unreadable.push(file.name);
      }
      if (!entries.length)
        throw new Error(
          'None of these files can be read any more. They may have been moved or deleted: choose them again.',
        );
      setStatus(`Making your zip of ${plural(entries.length, 'renamed copy', 'renamed copies')}…`);
      const name = topFolder ? `${slugName(topFolder)}-renamed.zip` : 'renamed-files.zip';
      download(await zip(entries), name);
      setStatus(
        unreadable.length
          ? `${list(unreadable)} couldn’t be read (moved or deleted?), so ${
              unreadable.length === 1 ? 'it’s' : 'they’re'
            } not in the zip.`
          : '',
      );
      setDone({ name, count: plan.changed });
    } catch (error) {
      setStatus(
        // A file that changes or moves mid-zip surfaces as a DOMException from the browser.
        error instanceof DOMException
          ? 'A file changed or moved while the zip was being made. Choose the files again, then download.'
          : error instanceof Error
            ? error.message
            : 'We couldn’t make the zip. Try fewer files.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!items.length)
    return (
      <div className="mx-auto grid w-full max-w-[640px] gap-3 pt-2 pb-6 sm:pt-4">
        <DropObject
          shape="files"
          multiple
          folder
          onFiles={add}
          art={<CleanArt />}
          title="Drop your messy files"
        >
          <SampleButton onClick={trySample} disabled={busy}>
            Try a messy sample
          </SampleButton>
        </DropObject>
        {note && (
          <p role="status" className="text-center text-[13.5px] leading-relaxed text-ink-2">
            {note}
          </p>
        )}
      </div>
    );

  if (done)
    return (
      <div className="mx-auto w-full max-w-[720px] pt-2 pb-6">
        <Payoff
          headline={
            <>
              <Icon name="check" size={16} strokeWidth={3} /> {done.name}
            </>
          }
          value={<CountUp value={done.count} duration={500} className={DISPLAY_NUMBER} />}
          caption={done.count === 1 ? 'filename cleaned' : 'filenames cleaned'}
          action={{ label: 'Download again', icon: 'download', onClick: downloadZip }}
          secondary={
            <PillButton icon="sliders" onClick={() => setDone(null)}>
              Change the rules
            </PillButton>
          }
          onReset={startOver}
          resetLabel="Clean more files"
        >
          <ol className="mx-auto grid max-w-[520px] gap-1.5 text-left">
            {view.rows
              .filter((row) => row.changed)
              .slice(0, 5)
              .map((row, index) => (
                <FlipRow key={row.index} row={row} index={index + 3} compact />
              ))}
          </ol>
          {status && <p className="mt-3 text-[13px] text-caution">{status}</p>}
        </Payoff>
      </div>
    );

  const activeTypes = RULE_TYPES.filter((type) =>
    rules.some((rule) => rule.type === type && rule.on),
  );
  const onRules = rules.filter((rule) => rule.on);

  return (
    <div className="flex flex-col gap-5 pb-2 lg:grid lg:grid-cols-[minmax(0,.92fr)_minmax(0,1.08fr)] lg:items-start lg:gap-x-8">
      {/* What's here */}
      <div className="order-1 flex min-w-0 items-center gap-3 lg:col-start-1 lg:row-start-1">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-[13px] text-[var(--on-accent,#12110d)]"
          style={{ background: ACCENT }}
        >
          <Icon name="files" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">
            {plural(items.length, 'file')} · {formatBytes(totalBytes)}
          </p>
          <p className="truncate text-[13px] text-muted">
            {folders.size
              ? `${topFolder ? `From “${topFolder}”` : 'From several folders'} · ${plural(folders.size, 'folder')}`
              : 'Chosen one by one'}
          </p>
        </div>
        {items.length < MAX_FILES && <AddMore onFiles={add} disabled={busy} />}
        <button
          type="button"
          disabled={busy}
          onClick={startOver}
          className="h-11 shrink-0 rounded-full px-3.5 text-[14px] font-medium text-ink-2 hover:bg-ink/[.06] hover:text-ink disabled:opacity-45 lg:h-10 lg:text-[13.5px]"
        >
          Start over
        </button>
      </div>
      {note && (
        <p role="status" className="order-1 text-[13px] leading-relaxed text-ink-2 lg:col-start-1">
          {note}
        </p>
      )}

      {/* Quick fixes: outcomes, the likely one already on */}
      <section
        aria-labelledby={`${id}-presets`}
        className="order-2 grid min-w-0 gap-2.5 lg:col-start-1"
      >
        <div className="flex min-h-7 items-center justify-between gap-3">
          <h2 id={`${id}-presets`} className="text-[15px] font-semibold text-ink">
            Quick fixes
          </h2>
          {undo && (
            <button
              type="button"
              onClick={() => {
                setRules(undo.rules);
                setPreset(undo.preset);
                setUndo(null);
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-ink-2 hover:bg-ink/[.06] hover:text-ink"
            >
              <Icon name="undo" size={14} /> Undo
            </button>
          )}
        </div>
        <div
          role="radiogroup"
          aria-label="Quick fixes"
          className="scroller -mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0"
        >
          {PRESETS.map((option) => {
            const on = option.id === preset;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => applyPreset(option.id)}
                className={cn(
                  'fx-move relative grid min-h-[76px] w-[62vw] max-w-[240px] shrink-0 snap-start content-start gap-1 rounded-[16px] px-3.5 py-3 text-left active:scale-[.97] sm:w-auto sm:max-w-none',
                  on
                    ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent-ink),0_14px_28px_-18px_var(--accent)]'
                    : 'bg-ink/[.045] shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.07]',
                )}
              >
                <span className="flex items-center gap-1.5 pr-5 text-[14px] font-semibold text-ink">
                  {option.name}
                </span>
                <span className="mono-num truncate text-[11.5px] text-muted">{option.example}</span>
                {on ? (
                  <span
                    aria-hidden="true"
                    className="fx-pop absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full text-[var(--on-accent,#12110d)]"
                    style={{ background: ACCENT }}
                  >
                    <Icon name="check" size={12} strokeWidth={3} />
                  </span>
                ) : (
                  option.id === suggested && (
                    <span className="absolute top-2.5 right-2.5 text-[10.5px] font-bold tracking-[.06em] text-[var(--accent-ink)] uppercase">
                      Best
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* The object: every name, flipping from old to new */}
      <section
        aria-label="New names"
        className="order-3 grid min-w-0 gap-3 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-4 lg:row-start-1"
      >
        <div className="rounded-[26px] bg-surface p-3 shadow-lift sm:p-4">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-1.5 pt-1">
            <p aria-live="polite" className="min-w-0">
              <span
                className="font-display text-[44px] leading-[.9] font-extrabold tracking-[-0.045em] text-ink sm:text-[52px]"
                style={{ fontVariationSettings: "'wdth' 112" }}
              >
                <CountUp value={view.changed} duration={350} className={DISPLAY_NUMBER} />
              </span>
              <span className="ml-2 text-[15px] font-medium text-ink-2">
                of {plural(view.rows.length, 'name')} cleaned
              </span>
            </p>
            <div role="group" aria-label="Show" className="flex gap-1">
              {(
                [
                  ['all', 'All'],
                  ['changed', 'Changed'],
                  ...(view.attention ? [['attention', `Check ${view.attention}`]] : []),
                ] as ['all' | 'changed' | 'attention', string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value);
                    setShowAll(false);
                  }}
                  className={cn(
                    'h-10 rounded-full px-3 text-[13px] font-medium transition-colors lg:h-9',
                    filter === value
                      ? 'bg-ink text-on-ink'
                      : value === 'attention'
                        ? 'bg-caution-soft text-caution'
                        : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {skipped > 0 && (
            <p className="mx-1.5 mt-3 flex items-start gap-2 rounded-[12px] bg-caution-soft px-3 py-2 text-[13px] text-caution">
              <Icon name="alert" size={14} className="mt-[3px] shrink-0" />A find & replace pattern
              doesn’t work yet, so it’s skipped.
            </p>
          )}

          <div className="mt-3 max-h-[min(54vh,520px)] overflow-y-auto rounded-[18px] bg-ink/[.03] lg:max-h-[calc(100dvh-22rem)] lg:min-h-[240px]">
            {visibleRows.length ? (
              <ol className="row-divide">
                {visibleRows.map((row, index) => (
                  <FlipRow
                    // A new name is a new face: the row flips over to it.
                    key={`${row.index}:${row.after}`}
                    row={row}
                    index={Math.min(index, STAGGER)}
                    showFolder={folders.size > 0 && row.folder !== topFolder}
                  />
                ))}
              </ol>
            ) : (
              <p className="px-4 py-8 text-center text-[14px] text-muted">
                {filter === 'changed' ? 'Nothing changes yet. Pick a quick fix.' : 'All clear.'}
              </p>
            )}
            {rows.length > visibleRows.length && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="flex h-11 w-full items-center justify-center gap-1.5 border-t border-line text-[13.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink"
              >
                Show all {rows.length.toLocaleString('en-US')}
              </button>
            )}
          </div>

          {problemsHere.size > 0 && (
            <ul className="mt-3 grid gap-1.5 px-1.5 text-[12.5px] leading-relaxed text-muted">
              {[...problemsHere].map((problem) => (
                <li key={problem} className="flex gap-2">
                  <Icon name="alert" size={14} className="mt-[3px] shrink-0 text-caution" />
                  <span>
                    <span className="font-medium text-ink-2">{PROBLEMS[problem].label}:</span>{' '}
                    {PROBLEMS[problem].detail}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <ActionBar className="-mx-3 !mt-3 from-surface px-3 sm:mx-0 sm:px-0">
            <button
              type="button"
              onClick={downloadZip}
              disabled={busy}
              className="fx-move inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-5 text-[16.5px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_14px_32px_-16px_var(--accent,transparent)] active:scale-[.97] disabled:opacity-45"
              style={{ background: ACCENT }}
            >
              <Icon
                name={busy ? 'loader' : 'download'}
                size={19}
                className={cn(busy && 'animate-spin')}
              />
              Download renamed copies
            </button>
          </ActionBar>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
            <CopyButton
              text={csvText}
              label="Copy the list"
              what="Rename list copied, as CSV"
              className="!h-10 !rounded-full !bg-transparent hover:!bg-ink/[.06]"
            />
            <button
              type="button"
              onClick={() => downloadText(csvText, 'rename-list.csv', 'text/csv')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink lg:text-[13.5px]"
            >
              <Icon name="file-text" size={15} /> List (CSV)
            </button>
          </div>
          <p
            role="status"
            className="px-1.5 text-center text-[13px] leading-relaxed text-ink-2 empty:hidden"
          >
            {status}
          </p>
        </div>
      </section>

      {/* Fine-tune: every rule a chip, its choices right under it */}
      <section
        aria-labelledby={`${id}-rules`}
        className="order-4 grid min-w-0 gap-3 lg:col-start-1 lg:row-start-3"
      >
        <h2 id={`${id}-rules`} className="text-[15px] font-semibold text-ink">
          Fine-tune
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {RULE_TYPES.map((type) => {
            const on = activeTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={on}
                onClick={() => toggleRule(type)}
                className={cn(
                  'fx-move inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium active:scale-[.95] lg:min-h-10 lg:text-[13.5px]',
                  on
                    ? 'text-[var(--on-accent,#12110d)] shadow-[0_8px_18px_-12px_var(--accent)]'
                    : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10 hover:text-ink',
                )}
                style={on ? { background: ACCENT } : undefined}
              >
                <Icon name={on ? 'check' : RULES[type].icon} size={15} />
                {RULES[type].title}
              </button>
            );
          })}
        </div>

        {onRules.length > 0 && (
          <ul className="grid gap-2">
            {onRules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                error={plan.errors[rule.id]}
                baseId={`${id}-${rule.id}`}
                onChange={changeRule}
                onRemove={
                  rule.type === 'replace' &&
                  rules.filter((item) => item.type === 'replace').length > 1
                    ? () => edit(rules.filter((item) => item.id !== rule.id))
                    : undefined
                }
                onAnother={rule.type === 'replace' ? () => addRule('replace') : undefined}
              />
            ))}
          </ul>
        )}

        <Advanced summary={rules.length > 1 ? 'Order, folders' : undefined}>
          <div className="grid gap-4">
            {rules.length > 1 && (
              <div className="grid gap-1.5">
                <p className="text-[13.5px] font-medium text-ink-2">
                  Order: changes run top to bottom
                </p>
                <ol className="grid gap-1">
                  {rules.map((rule, index) => (
                    <li
                      key={rule.id}
                      className={cn(
                        'flex min-h-11 items-center gap-2 rounded-[12px] bg-ink/[.04] pl-3',
                        !rule.on && 'opacity-55',
                      )}
                    >
                      <span className="mono-num text-[11px] text-faint">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                        {RULES[rule.type].title}
                        {!rule.on && <span className="ml-1.5 text-[12px] text-muted">· off</span>}
                      </span>
                      <IconButton
                        icon="arrow-up"
                        label={`Move ${RULES[rule.type].title} up`}
                        disabled={index === 0}
                        onClick={() => moveRule(index, -1)}
                        className="max-lg:!size-11"
                      />
                      <IconButton
                        icon="arrow-down"
                        label={`Move ${RULES[rule.type].title} down`}
                        disabled={index === rules.length - 1}
                        onClick={() => moveRule(index, 1)}
                        className="max-lg:!size-11"
                      />
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {folders.size > 0 && (
              <Toggle
                on={keepFolders}
                onChange={setKeepFolders}
                label="Keep the folders in the zip"
                hint={
                  keepFolders
                    ? 'Each copy goes in the same folder as its original.'
                    : 'Every copy side by side; names that clash get (2).'
                }
              />
            )}
            <p className="text-[12.5px] leading-relaxed text-muted">
              Rules change the name, never the extension (.jpg, .pdf), except Extension case.
            </p>
          </div>
        </Advanced>
      </section>
    </div>
  );
}

/** An old name flipping over to its new one: what went struck, what came lit. */
function FlipRow({
  row,
  index,
  showFolder = false,
  compact = false,
}: {
  row: RenameRow;
  index: number;
  showFolder?: boolean;
  compact?: boolean;
}) {
  const diff = useMemo(() => diffNames(row.before, row.after), [row.before, row.after]);
  return (
    <li
      className={cn(
        'grid min-w-0 gap-0.5 px-3.5 py-2.5',
        compact && 'rounded-[14px] bg-ink/[.04] py-2',
      )}
    >
      {showFolder && row.folder && (
        <span className="flex items-center gap-1 truncate text-[11.5px] text-faint">
          <Icon name="folder-open" size={12} className="shrink-0" /> {row.folder}
        </span>
      )}
      <span className="min-w-0 text-[12.5px] whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">
        {row.changed ? (
          <>
            <span className="sr-only">From </span>
            {diff.before.map((part, position) =>
              part.changed ? (
                <del
                  key={position}
                  className="rounded-[3px] bg-critical-soft px-px text-ink-2 decoration-critical/60"
                >
                  {part.text}
                </del>
              ) : (
                <span key={position}>{part.text}</span>
              ),
            )}
          </>
        ) : (
          <span className="text-faint">Stays as it is</span>
        )}
      </span>
      <span
        className={cn(
          'min-w-0 text-[14.5px] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]',
          row.changed && 'fx-flip font-medium',
        )}
        style={{ '--i': index } as CSSProperties}
      >
        {row.changed && <span className="sr-only">to </span>}
        {row.changed ? <DiffText parts={diff.after} /> : row.before}
      </span>
      {row.problems.length > 0 && (
        <span className="flex flex-wrap gap-1 pt-0.5">
          {row.problems.map((problem) => (
            <span
              key={problem}
              title={PROBLEMS[problem].detail}
              className="inline-flex items-center gap-1 rounded-full bg-caution-soft px-2 py-0.5 text-[11.5px] font-medium text-caution"
            >
              <Icon name="alert" size={12} /> {PROBLEMS[problem].label}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

/** A switch with its words beside it. */
function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-11 w-full items-center gap-3 rounded-[12px] text-left"
    >
      <span
        className={cn('fx-move relative h-6 w-10 shrink-0 rounded-full', on ? '' : 'bg-ink/[.12]')}
        style={on ? { background: 'var(--accent-ink)' } : undefined}
      >
        <span
          className={cn(
            'fx-move absolute top-1 left-1 size-4 rounded-full bg-surface shadow-card',
            on && 'translate-x-4',
          )}
        />
      </span>
      <span className="min-w-0 text-[14px] text-ink">
        {label}
        {hint && <span className="block text-[12.5px] text-muted">{hint}</span>}
      </span>
    </button>
  );
}

/** Pick one, tapped: a compact segmented row. */
function Pills<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex max-w-full flex-wrap gap-1 rounded-[16px] bg-ink/[.05] p-1"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'fx-move min-h-10 min-w-11 rounded-[12px] px-3 text-[13.5px] font-medium lg:min-h-9',
              on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A small on/off chip for a rule's option ("é → e", "Match case"). */
function OptionChip({
  on,
  onChange,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn(
        'fx-move inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium active:scale-[.95]',
        on
          ? 'bg-ink text-on-ink'
          : 'bg-ink/[.05] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink',
      )}
    >
      <Icon name={on ? 'check' : 'plus'} size={14} />
      {children}
    </button>
  );
}

function TextBox({
  id,
  label,
  value,
  placeholder,
  mono,
  invalid,
  describedBy,
  maxLength = 100,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
  invalid?: boolean;
  describedBy?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="grid min-w-0 gap-1">
      <span className="text-[12.5px] font-medium text-muted">{label}</span>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-11 w-full min-w-0 rounded-[12px] bg-surface px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--accent-ink)] lg:h-10 lg:text-[14px]',
          mono && 'font-mono',
        )}
      />
    </label>
  );
}

/** A whole number, nudged with − and + (typing still works). */
function Nudge({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div role="group" aria-label={label} className="grid gap-1">
      <span className="text-[12.5px] font-medium text-muted">{label}</span>
      <span className="flex items-center rounded-[12px] bg-ink/[.05] p-0.5">
        <button
          type="button"
          aria-label={`${label}: less`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="grid size-10 place-items-center rounded-[10px] text-ink-2 hover:bg-surface disabled:opacity-35"
        >
          <Icon name="minus" size={15} />
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          autoComplete="off"
          value={text ?? String(value)}
          onFocus={() => setText(String(value))}
          onBlur={() => setText(null)}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
          }}
          className="mono-num h-10 w-full min-w-0 bg-transparent text-center text-[15px] text-ink outline-none"
        />
        <button
          type="button"
          aria-label={`${label}: more`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="grid size-10 place-items-center rounded-[10px] text-ink-2 hover:bg-surface disabled:opacity-35"
        >
          <Icon name="plus" size={15} />
        </button>
      </span>
    </div>
  );
}

const INLINE: RuleType[] = ['strip', 'spaces', 'case', 'extension'];

/** An active rule: its name, what it does now, and its choices right there. */
function RuleCard({
  rule,
  error,
  baseId,
  onChange,
  onRemove,
  onAnother,
}: {
  rule: Rule;
  error?: string;
  baseId: string;
  onChange: (rule: Rule) => void;
  onRemove?: () => void;
  onAnother?: () => void;
}) {
  const { title, icon } = RULES[rule.type];
  // A rule that's one tap of a choice sits on one line; the choice says what it does.
  const inline = INLINE.includes(rule.type);
  return (
    <li
      className={cn(
        'fx-pop grid gap-2.5 rounded-[18px] bg-surface/70 p-3 shadow-[inset_0_0_0_1px_var(--color-line)]',
        inline && 'sm:flex sm:items-center sm:justify-between sm:gap-3 sm:py-2',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-ink/[.06] text-ink-2">
          <Icon name={icon} size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-ink">{title}</span>
          {!inline && (
            <span
              className={cn('block truncate text-[12.5px]', error ? 'text-critical' : 'text-muted')}
            >
              {summary(rule, error)}
            </span>
          )}
        </span>
        {onRemove && <IconButton icon="x" label={`Remove this ${title}`} onClick={onRemove} />}
      </div>
      <RuleFields rule={rule} error={error} baseId={baseId} onChange={onChange} />
      {onAnother && (
        <button
          type="button"
          onClick={onAnother}
          className="inline-flex h-10 items-center gap-1.5 justify-self-start rounded-full px-2.5 text-[13.5px] font-medium text-ink-2 hover:bg-ink/[.06] hover:text-ink"
        >
          <Icon name="plus" size={14} /> Another find & replace
        </button>
      )}
    </li>
  );
}

function RuleFields({
  rule,
  error,
  baseId,
  onChange,
}: {
  rule: Rule;
  error?: string;
  baseId: string;
  onChange: (rule: Rule) => void;
}) {
  switch (rule.type) {
    case 'replace':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <TextBox
              id={`${baseId}-find`}
              label={rule.pattern ? 'Find (pattern)' : 'Find'}
              value={rule.find}
              maxLength={200}
              mono={rule.pattern}
              placeholder={rule.pattern ? '^IMG_(\\d+)' : 'IMG_'}
              invalid={!!error}
              describedBy={error ? `${baseId}-error` : undefined}
              onChange={(find) => onChange({ ...rule, find })}
            />
            <TextBox
              id={`${baseId}-with`}
              label="With"
              value={rule.with}
              maxLength={200}
              mono={rule.pattern}
              placeholder={rule.pattern ? 'Photo $1' : 'Nothing'}
              onChange={(value) => onChange({ ...rule, with: value })}
            />
          </div>
          {error && (
            <p
              id={`${baseId}-error`}
              aria-live="polite"
              className="rounded-[10px] bg-critical-soft px-3 py-2 text-[13px] leading-relaxed text-critical"
            >
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <OptionChip
              on={rule.matchCase}
              onChange={(matchCase) => onChange({ ...rule, matchCase })}
            >
              Match case
            </OptionChip>
            <OptionChip on={rule.pattern} onChange={(pattern) => onChange({ ...rule, pattern })}>
              Pattern (regex)
            </OptionChip>
          </div>
          {rule.pattern && (
            <p className="text-[12.5px] text-muted">Use $1, $2… for what each bracket found.</p>
          )}
        </>
      );
    case 'strip':
      return (
        <div className="flex flex-wrap gap-1.5">
          <OptionChip on={rule.plain} onChange={(plain) => onChange({ ...rule, plain })}>
            Plain letters too: é → e
          </OptionChip>
        </div>
      );
    case 'spaces':
      return (
        <Pills
          label="Spaces"
          value={rule.to}
          onChange={(to) => onChange({ ...rule, to })}
          options={[
            { value: ' ', label: 'Keep spaces' },
            { value: '-', label: 'Into -' },
            { value: '_', label: 'Into _' },
          ]}
        />
      );
    case 'case':
      return (
        <Pills
          label="Make names"
          value={rule.to}
          onChange={(to) => onChange({ ...rule, to })}
          options={[
            { value: 'lower', label: 'lower' },
            { value: 'upper', label: 'UPPER' },
            { value: 'title', label: 'Title' },
            { value: 'sentence', label: 'Sentence' },
          ]}
        />
      );
    case 'prefix':
    case 'suffix':
      return (
        <TextBox
          id={`${baseId}-text`}
          label={rule.type === 'prefix' ? 'Before each name' : 'After each name'}
          value={rule.text}
          placeholder={rule.type === 'prefix' ? 'Kitchen ' : ' final'}
          onChange={(text) => onChange({ ...rule, text })}
        />
      );
    case 'number':
      return (
        <>
          <TextBox
            id={`${baseId}-name`}
            label="One name for all (optional)"
            value={rule.name}
            placeholder="Keep each name"
            onChange={(name) => onChange({ ...rule, name })}
          />
          <div className="flex flex-wrap gap-2">
            <Pills
              label="Where"
              value={rule.at}
              onChange={(at) => onChange({ ...rule, at })}
              options={[
                { value: 'start', label: 'Before' },
                { value: 'end', label: 'After' },
              ]}
            />
            <Pills
              label="Number them"
              value={rule.order}
              onChange={(order) => onChange({ ...rule, order })}
              options={ORDERS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </div>
          <Advanced>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Nudge
                  label="Start at"
                  value={rule.start}
                  min={0}
                  max={999_999}
                  onChange={(start) => onChange({ ...rule, start })}
                />
                <Nudge
                  label="Count by"
                  value={rule.step}
                  min={1}
                  max={1000}
                  onChange={(step) => onChange({ ...rule, step })}
                />
              </div>
              <div className="grid gap-1">
                <span className="text-[12.5px] font-medium text-muted">Digits</span>
                <Pills
                  label="Digits"
                  value={String(rule.digits)}
                  onChange={(digits) => onChange({ ...rule, digits: Number(digits) })}
                  options={[
                    { value: '0', label: 'Auto' },
                    { value: '1', label: '1' },
                    { value: '2', label: '01' },
                    { value: '3', label: '001' },
                    { value: '4', label: '0001' },
                    { value: '5', label: '00001' },
                  ]}
                />
              </div>
              <div className="grid gap-1">
                <span className="text-[12.5px] font-medium text-muted">
                  Between name and number
                </span>
                <Pills
                  label="Between name and number"
                  value={rule.separator}
                  onChange={(separator) => onChange({ ...rule, separator })}
                  options={SEPARATORS}
                />
              </div>
            </div>
          </Advanced>
        </>
      );
    case 'date':
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <Pills
              label="Where"
              value={rule.at}
              onChange={(at) => onChange({ ...rule, at })}
              options={[
                { value: 'start', label: 'Date first' },
                { value: 'end', label: 'Date last' },
              ]}
            />
            <Pills
              label="Between name and date"
              value={rule.separator}
              onChange={(separator) => onChange({ ...rule, separator })}
              options={SEPARATORS}
            />
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted">
            The date each file was last changed. For photos that’s not always the day taken.
          </p>
        </>
      );
    case 'extension':
      return (
        <Pills
          label="Extensions"
          value={rule.to}
          onChange={(to) => onChange({ ...rule, to })}
          options={[
            { value: 'keep', label: 'As they are' },
            { value: 'lower', label: '.jpg' },
            { value: 'upper', label: '.JPG' },
          ]}
        />
      );
  }
}
