'use client';
import { useDeferredValue, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
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
  type DiffPart,
  type Order,
  type PresetId,
  type Problem,
  type RenameRow,
  type Rule,
  type RuleType,
} from '@/lib/tools/rename';
import {
  CopyButton,
  FileDrop,
  IconButton,
  Label,
  Note,
  SampleButton,
  StartPanel,
  Surface,
} from './kit';

/*
 * Clean: a stack of renaming rules over the files a person chooses, with every new name previewed
 * before anything happens. Browsers can't rename files where they sit, so the result is renamed
 * copies in a zip (plus a CSV of old → new). The files are only ever read on this device.
 */

const ACCENT = 'var(--accent, #c7b5ff)';
/** Rows shown before "Show all": enough to check, light enough to stay quick. */
const SHOWN = 200;

type Item = { id: number; file: File; folder: string };

const RULES: Record<RuleType, { title: string; icon: IconName }> = {
  replace: { title: 'Find & replace', icon: 'replace' },
  strip: { title: 'Remove odd characters', icon: 'sparkles' },
  spaces: { title: 'Tidy spaces', icon: 'wrench' },
  case: { title: 'Change case', icon: 'type' },
  prefix: { title: 'Add to the start', icon: 'arrow-left' },
  suffix: { title: 'Add to the end', icon: 'arrow-right' },
  number: { title: 'Number', icon: 'list-ordered' },
  date: { title: 'Add the date', icon: 'calendar' },
  extension: { title: 'Extension case', icon: 'file-text' },
};

const ORDERS: { value: Order; label: string; short: string }[] = [
  { value: 'name', label: 'By name (2 before 10)', short: 'by name' },
  { value: 'modified', label: 'By date modified, oldest first', short: 'oldest first' },
  { value: 'size', label: 'By size, smallest first', short: 'smallest first' },
  { value: 'added', label: 'In the order they were added', short: 'as added' },
];

const SEPARATORS = [
  { value: ' ', label: 'A space' },
  { value: '-', label: 'A dash (-)' },
  { value: '_', label: 'An underscore (_)' },
  { value: ' - ', label: 'A spaced dash ( - )' },
  { value: '', label: 'Nothing' },
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

/** What Clean does, before any files are chosen: an example, plainly labelled. */
const EXAMPLES = [
  ['IMG_2041.JPG', '2026-05-03 img-2041.jpg'],
  ['Party 🎉 invite FINAL.pdf', 'party-invite-final.pdf'],
  ['notes   from  rosa .TXT', 'notes-from-rosa.txt'],
].map(([before, after]) => ({ key: before, ...diffNames(before, after) }));

/** Messy names in, tidy names out: the whole tool, as a picture. */
function CleanArt() {
  return (
    <ol aria-label="For example" className="grid gap-2 text-left">
      {EXAMPLES.map((example, index) => (
        <li
          key={example.key}
          className={cn(
            'flex min-w-0 animate-rise items-center gap-2.5 rounded-[14px] bg-well/70 px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--color-line)] sm:gap-3 sm:px-3.5 sm:py-2.5',
            // Two say it on a phone; the third waits for a wider screen.
            index === 2 && 'max-sm:hidden',
          )}
          style={{ animationDelay: `${index * 70}ms` }}
        >
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-[9px] text-[#12110d]"
            style={{ background: ACCENT }}
          >
            <Icon name={index === 0 ? 'image' : 'file-text'} size={16} />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate text-[12.5px] text-muted line-through decoration-faint/70">
              {example.before.map((part) => part.text).join('')}
            </span>
            <span className="truncate text-[14px] font-medium text-ink">
              {example.after.map((part, position) =>
                part.changed ? (
                  <span key={position} style={{ color: ACCENT }}>
                    {part.text}
                  </span>
                ) : (
                  <span key={position}>{part.text}</span>
                ),
              )}
            </span>
          </span>
        </li>
      ))}
    </ol>
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
  // No rules until one is picked: a rule's settings show only once it's added.
  const [rules, setRules] = useState<Rule[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [undo, setUndo] = useState<Rule[] | null>(null);
  const [keepFolders, setKeepFolders] = useState(true);
  const [filter, setFilter] = useState<'all' | 'changed' | 'attention'>('all');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
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
    }
    const notes: string[] = [];
    if (accepted.length) notes.push(`Added ${plural(accepted.length, 'file')}.`);
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
        `${list(folderEntries)} ${folderEntries.length === 1 ? 'is a folder' : 'are folders'}: use Choose a folder to add what’s inside.`,
      );
    setNote(notes.join(' '));
  }

  async function trySample() {
    setBusy(true);
    setNote('Making sample files…');
    try {
      const samples = await sampleFiles();
      setItems(samples.map((sample) => ({ id: nextItem.current++, ...sample })));
      // A fresh stack does nothing yet: start the sample off with a preset, to show the idea.
      if (!rules.length || JSON.stringify(rules) === JSON.stringify(START_RULES)) {
        setRules(presetRules('web'));
        setOpen([]);
        setNote(
          `Added ${SAMPLES.length} sample files, with “Clean for the web” to start. Change any rule and watch the names.`,
        );
      } else setNote(`Added ${SAMPLES.length} sample files.`);
    } catch {
      setNote('We couldn’t make samples here. Choose a few of your own files instead.');
    } finally {
      setBusy(false);
    }
  }

  const changeRule = (next: Rule) =>
    setRules((current) => current.map((rule) => (rule.id === next.id ? next : rule)));
  const addRule = (type: RuleType) => {
    const rule = newRule(type, `r${++nextRule.current}`);
    setRules((current) => [...current, rule]);
    setOpen((current) => [...current, rule.id]);
    setUndo(null);
  };
  /** A rule chip: tap to add it (its settings open), tap again to take it out. */
  const toggleRule = (type: RuleType) => {
    if (!rules.some((rule) => rule.type === type)) return addRule(type);
    setUndo(rules);
    setRules((current) => current.filter((rule) => rule.type !== type));
  };
  const moveRule = (index: number, by: -1 | 1) =>
    setRules((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved);
      return next;
    });
  const applyPreset = (preset: PresetId) => {
    setUndo(rules);
    // Number a batch names it after the chosen folder, when there is one.
    setRules(presetRules(preset, topFolder || 'Batch'));
    setOpen([]);
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
        `Downloading ${name}: ${plural(entries.length, 'renamed copy', 'renamed copies')}. Your originals haven’t changed.${
          unreadable.length
            ? ` ${list(unreadable)} couldn’t be read (moved or deleted?), so ${
                unreadable.length === 1 ? 'it’s' : 'they’re'
              } not in the zip.`
            : ''
        }`,
      );
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
      <StartPanel
        art={<CleanArt />}
        title="Tidy up messy file names"
        lead="Pick the rules, see every new name before anything happens, then download renamed copies."
        footer="Your originals stay exactly as they are. Nothing is uploaded."
      >
        <FileDrop
          folder
          onFiles={add}
          disabled={busy}
          icon="replace"
          accent={ACCENT}
          compact
          title="Choose the files to rename"
          hint="Or a whole folder: up to 1,000 files."
        />
        <SampleButton onClick={trySample} disabled={busy} className="mt-2">
          No files handy? Try a messy sample
        </SampleButton>
        {note && (
          <p role="status" className="mt-2 text-[13px] leading-relaxed text-ink-2">
            {note}
          </p>
        )}
      </StartPanel>
    );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
      <Surface className="grid grid-cols-1 gap-4 lg:col-start-1 lg:row-start-1">
        <>
          <div className="flex items-center gap-3">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-[12px] text-[#12110d]"
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
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setItems([]);
                setNote('');
                setStatus('');
              }}
              className="h-11 shrink-0 rounded-[11px] px-3.5 text-[14px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink disabled:opacity-45 lg:h-9 lg:text-[13.5px]"
            >
              Start over
            </button>
          </div>
          {items.length < MAX_FILES && (
            <FileDrop folder compact onFiles={add} disabled={busy} icon="plus" title="Add more" />
          )}
        </>
        {note && (
          <p role="status" className="text-[13px] leading-relaxed text-ink-2">
            {note}
          </p>
        )}
        {items.length > 0 && (
          <section aria-labelledby={`${id}-presets`} className="grid grid-cols-1 gap-2.5">
            <div className="flex min-h-6 items-center justify-between gap-3">
              <Label id={`${id}-presets`}>Pick a quick fix</Label>
              {undo && (
                <button
                  type="button"
                  onClick={() => {
                    setRules(undo);
                    setUndo(null);
                  }}
                  className="inline-flex h-11 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-9"
                >
                  <Icon name="undo" size={14} /> Undo
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className="grid min-h-11 min-w-0 content-start gap-0.5 rounded-[14px] bg-well px-3.5 py-3 text-left transition-colors hover:bg-ink/10"
                >
                  <span className="text-[14px] font-semibold text-ink">{preset.name}</span>
                  <span className="truncate text-[12px] text-muted">{preset.example}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </Surface>

      {items.length > 0 && (
        <Surface className="grid grid-cols-1 gap-6 max-lg:order-last lg:col-start-1 lg:row-start-2">
          <section aria-labelledby={`${id}-rules`} className="grid grid-cols-1 gap-3">
            <div className="flex min-h-6 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Label id={`${id}-rules`}>Or choose what to change</Label>
              {rules.length > 1 && (
                <span className="text-[12.5px] text-muted">Changes run top to bottom</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RULE_TYPES.map((type) => {
                const on = rules.some((rule) => rule.type === type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleRule(type)}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-[background-color,color,transform] active:scale-[.97] lg:min-h-9 lg:text-[13.5px]',
                      on ? 'text-[#12110d]' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
                    )}
                    style={on ? { background: ACCENT } : undefined}
                  >
                    <Icon name={on ? 'check' : RULES[type].icon} size={15} />
                    {RULES[type].title}
                  </button>
                );
              })}
            </div>
            {rules.length > 0 ? (
              <ol className="grid grid-cols-1 gap-2">
                {rules.map((rule, index) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    index={index}
                    count={rules.length}
                    open={open.includes(rule.id)}
                    error={plan.errors[rule.id]}
                    baseId={`${id}-${rule.id}`}
                    onToggle={() =>
                      setOpen((current) =>
                        current.includes(rule.id)
                          ? current.filter((item) => item !== rule.id)
                          : [...current, rule.id],
                      )
                    }
                    onChange={changeRule}
                    onMove={(by) => moveRule(index, by)}
                    onRemove={() =>
                      setRules((current) => current.filter((item) => item.id !== rule.id))
                    }
                  />
                ))}
              </ol>
            ) : (
              <p className="rounded-[14px] bg-subtle px-4 py-3.5 text-[13.5px] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
                Tap a change above and its settings open here. Or pick a quick fix.
              </p>
            )}
            {rules.some((rule) => rule.type === 'replace') && (
              <button
                type="button"
                onClick={() => addRule('replace')}
                className="inline-flex h-11 items-center gap-1.5 justify-self-start rounded-[10px] px-2.5 text-[13.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-9"
              >
                <Icon name="plus" size={14} /> Another find & replace
              </button>
            )}
            <p className="text-[12.5px] leading-relaxed text-muted">
              Changes touch the name, never the extension (.jpg, .pdf), except Extension case.
            </p>
          </section>
        </Surface>
      )}

      <aside
        id={`${id}-preview`}
        aria-label="New names"
        className="grid min-w-0 scroll-mt-24 gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
      >
        <Surface className="grid grid-cols-1 gap-4">
          <>
            <div className="flex items-end justify-between gap-3" aria-live="polite">
              <div className="min-w-0">
                <p className="label">Preview</p>
                <p className="mt-1.5 text-[15px] text-muted">
                  <span
                    className="mr-1.5 font-display text-[36px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                    style={{ fontVariationSettings: "'wdth' 110" }}
                  >
                    {view.changed}
                  </span>
                  of {plural(view.rows.length, 'name')} change
                </p>
              </div>
              <p className="shrink-0 text-right text-[12.5px] leading-relaxed text-muted">
                {plural(view.rows.length - view.changed, 'stays', 'stay')} as{' '}
                {view.rows.length - view.changed === 1 ? 'it is' : 'they are'}
                <br />
                {view.attention ? (
                  <span className="text-caution">
                    {view.attention} {view.attention === 1 ? 'needs' : 'need'} attention
                  </span>
                ) : (
                  'No problems'
                )}
              </p>
            </div>

            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', `All ${view.rows.length}`],
                  ['changed', `Changed ${view.changed}`],
                  ['attention', `Needs attention ${view.attention}`],
                ] as const
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
                    'h-11 rounded-full px-3.5 text-[13px] font-medium transition-colors lg:h-9 lg:px-3',
                    filter === value ? 'bg-ink text-on-ink' : 'bg-well text-ink-2 hover:bg-ink/10',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {skipped > 0 && (
              <Note icon="alert" tone="caution">
                A find & replace pattern doesn’t work yet, so that rule is skipped. Open it to see
                why.
              </Note>
            )}

            <div className="max-h-[min(62vh,560px)] overflow-y-auto rounded-[16px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] lg:max-h-[calc(100dvh-27rem)] lg:min-h-[220px]">
              {visibleRows.length ? (
                <ol className="row-divide">
                  {visibleRows.map((row) => (
                    <PreviewRow key={row.index} row={row} showFolder={folders.size > 0} />
                  ))}
                </ol>
              ) : (
                <p className="px-4 py-6 text-center text-[13.5px] text-muted">
                  {filter === 'changed'
                    ? 'No name changes yet. Pick a quick fix or choose what to change.'
                    : 'Nothing needs attention.'}
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
              <ul className="grid gap-1.5 text-[12.5px] leading-relaxed text-muted">
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

            <div className="grid gap-3 border-t border-line pt-4">
              {folders.size > 0 && (
                <Check checked={keepFolders} onChange={setKeepFolders}>
                  Keep the folders in the zip
                  <span className="block text-[12.5px] text-muted">
                    {keepFolders
                      ? 'Each copy goes in the same folder as its original.'
                      : 'Every copy sits side by side; names that clash get (2).'}
                  </span>
                </Check>
              )}
              <button
                type="button"
                onClick={downloadZip}
                disabled={busy}
                className="inline-flex h-14 items-center justify-center gap-2 rounded-[16px] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent,transparent)] transition-[transform,opacity] active:scale-[.985] disabled:opacity-45 sm:h-13 sm:text-[16px]"
                style={{ background: ACCENT }}
              >
                {busy ? (
                  <Icon name="loader" size={19} className="animate-spin" />
                ) : (
                  <Icon name="download" size={19} />
                )}
                Download renamed copies
              </button>
              <div className="grid grid-cols-2 gap-2">
                <CopyButton
                  text={csvText}
                  label="Copy the list"
                  what="Rename list copied, as CSV"
                  className="!h-11 lg:!h-10"
                />
                <button
                  type="button"
                  onClick={() => downloadText(csvText, 'rename-list.csv', 'text/csv')}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-well px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-10 lg:text-[13.5px]"
                >
                  <Icon name="file-text" size={15} /> List (CSV)
                </button>
              </div>
              <p role="status" className="min-h-5 text-[13px] leading-relaxed text-ink-2">
                {status}
              </p>
              <p className="text-[12.5px] leading-relaxed text-muted">
                You get renamed copies in one zip; your originals stay exactly as they are. The list
                has every old and new name.
              </p>
            </div>
          </>
        </Surface>
      </aside>
    </div>
  );
}

/** An old name and its new one, with what was removed and what was added marked. */
function Names({
  before,
  after,
  changed = true,
}: {
  before: DiffPart[];
  after: DiffPart[];
  changed?: boolean;
}) {
  return (
    <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)] sm:items-baseline">
      <span className="min-w-0 text-[13px] text-muted whitespace-pre-wrap [overflow-wrap:anywhere]">
        {before.map((part, index) =>
          part.changed && changed ? (
            <del
              key={index}
              className="rounded-[3px] bg-critical-soft text-ink-2 decoration-critical/60"
            >
              {part.text}
            </del>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </span>
      <Icon name="arrow-right" size={13} className="hidden text-faint sm:block" />
      <span className="sr-only">becomes</span>
      <span className="flex min-w-0 gap-1.5">
        <Icon name="arrow-right" size={13} className="mt-[4px] shrink-0 text-faint sm:hidden" />
        {changed ? (
          <span className="min-w-0 text-[14px] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">
            {after.map((part, index) =>
              part.changed ? (
                <ins
                  key={index}
                  className="rounded-[3px] text-ink underline decoration-[var(--accent,#c7b5ff)] decoration-2 underline-offset-[3px]"
                  style={{ background: `color-mix(in oklab, ${ACCENT} 24%, transparent)` }}
                >
                  {part.text}
                </ins>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </span>
        ) : (
          <span className="text-[13px] text-faint">No change</span>
        )}
      </span>
    </div>
  );
}

function PreviewRow({ row, showFolder }: { row: RenameRow; showFolder: boolean }) {
  const diff = useMemo(() => diffNames(row.before, row.after), [row.before, row.after]);
  return (
    <li className="grid gap-1 px-3.5 py-2.5">
      {showFolder && row.folder && (
        <span className="flex items-center gap-1 truncate text-[11.5px] text-faint">
          <Icon name="folder-open" size={12} className="shrink-0" /> {row.folder}
        </span>
      )}
      <Names before={diff.before} after={diff.after} changed={row.changed} />
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

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-1 text-[14px] text-ink-2 lg:min-h-9 lg:text-[13.5px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-[3px] size-[18px] shrink-0 accent-[var(--color-ink)]"
      />
      <span>{children}</span>
    </label>
  );
}

/** On or off, without losing the rule's settings. */
function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={on ? 'On' : 'Off'}
      onClick={() => onChange(!on)}
      className="grid h-11 w-14 shrink-0 place-items-center rounded-[12px] hover:bg-ink/5"
    >
      <span
        className={cn(
          'relative h-6 w-10 rounded-full transition-colors',
          on ? 'bg-ink' : 'bg-well shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-4 rounded-full transition-transform',
            on ? 'translate-x-4 bg-on-ink' : 'bg-muted',
          )}
        />
      </span>
    </button>
  );
}

/** A whole number typed freely, kept within bounds. */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
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
        className="num"
      />
    </Field>
  );
}

function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid min-w-0 gap-1.5">
      <legend className="mb-1.5 text-[13.5px] font-medium text-ink-2">{legend}</legend>
      <Segmented name={name} value={value} options={options} onChange={onChange} />
    </fieldset>
  );
}

function RuleCard({
  rule,
  index,
  count,
  open,
  error,
  baseId,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: {
  rule: Rule;
  index: number;
  count: number;
  open: boolean;
  error?: string;
  baseId: string;
  onToggle: () => void;
  onChange: (rule: Rule) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { title, icon } = RULES[rule.type];
  return (
    <li className="rounded-[16px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="flex items-center gap-1 p-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${baseId}-body`}
          onClick={onToggle}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-[12px] px-2.5 py-1.5 text-left transition-colors hover:bg-ink/5"
        >
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-[10px] bg-well text-ink-2',
              !rule.on && 'opacity-50',
            )}
          >
            <Icon name={icon} size={16} />
          </span>
          <span className={cn('min-w-0 flex-1', !rule.on && 'opacity-60')}>
            <span className="block text-[14.5px] font-medium text-ink">
              <span className="mono-num mr-1.5 text-[11px] text-faint">{index + 1}</span>
              {title}
              {!rule.on && <span className="ml-1.5 text-[12px] font-normal text-muted">· off</span>}
            </span>
            <span
              className={cn('block truncate text-[12.5px]', error ? 'text-critical' : 'text-muted')}
            >
              {summary(rule, error)}
            </span>
          </span>
          <Icon
            name="chevron-down"
            size={16}
            className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
          />
        </button>
        <Switch on={rule.on} onChange={(on) => onChange({ ...rule, on })} label={`Use ${title}`} />
      </div>
      {open && (
        <div
          id={`${baseId}-body`}
          className="grid animate-fade grid-cols-1 gap-3.5 border-t border-line px-3 pt-3.5 pb-1.5 sm:px-4"
        >
          <RuleFields rule={rule} error={error} baseId={baseId} onChange={onChange} />
          <div className="-mx-1 flex items-center gap-1 border-t border-line pt-1.5">
            <IconButton
              icon="arrow-up"
              label={`Move ${title} up`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="max-lg:!size-11"
            />
            <IconButton
              icon="arrow-down"
              label={`Move ${title} down`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
              className="max-lg:!size-11"
            />
            <button
              type="button"
              onClick={onRemove}
              className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-medium text-muted transition-colors hover:bg-critical-soft hover:text-critical lg:h-9"
            >
              <Icon name="trash" size={15} /> Remove
            </button>
          </div>
        </div>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={rule.pattern ? 'Find (pattern)' : 'Find'} htmlFor={`${baseId}-find`}>
              <Input
                id={`${baseId}-find`}
                value={rule.find}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                placeholder={rule.pattern ? '^IMG_(\\d+)' : 'IMG_'}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${baseId}-error` : undefined}
                onChange={(event) => onChange({ ...rule, find: event.target.value })}
                className={cn(rule.pattern && 'font-mono')}
              />
            </Field>
            <Field
              label="Replace with"
              htmlFor={`${baseId}-with`}
              hint={
                rule.pattern
                  ? 'Use $1, $2… for what each bracket found.'
                  : 'Leave it empty to remove what’s found.'
              }
            >
              <Input
                id={`${baseId}-with`}
                value={rule.with}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                placeholder={rule.pattern ? 'Photo $1' : 'Nothing'}
                onChange={(event) => onChange({ ...rule, with: event.target.value })}
                className={cn(rule.pattern && 'font-mono')}
              />
            </Field>
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
          <div className="flex flex-wrap gap-x-6">
            <Check
              checked={rule.matchCase}
              onChange={(matchCase) => onChange({ ...rule, matchCase })}
            >
              Match case
            </Check>
            <Check checked={rule.pattern} onChange={(pattern) => onChange({ ...rule, pattern })}>
              Pattern <span className="text-muted">(regular expression, for experts)</span>
            </Check>
          </div>
        </>
      );
    case 'strip':
      return (
        <>
          <p className="text-[13px] leading-relaxed text-muted">
            Removes emoji, symbols and invisible characters. Keeps letters (accents too), digits,
            spaces and <span className="mono-num text-ink-2">- _ . ( )</span>
          </p>
          <Check checked={rule.plain} onChange={(plain) => onChange({ ...rule, plain })}>
            Also turn accented letters into plain ones (é → e)
          </Check>
        </>
      );
    case 'spaces':
      return (
        <>
          <Choice
            legend="Spaces"
            name={`${baseId}-to`}
            value={rule.to}
            onChange={(to) => onChange({ ...rule, to })}
            options={[
              { value: ' ', label: 'Keep' },
              { value: '-', label: 'Into -' },
              { value: '_', label: 'Into _' },
            ]}
          />
          <p className="text-[12.5px] text-muted">
            Always trims the ends and turns runs of spaces into one.
          </p>
        </>
      );
    case 'case':
      return (
        <Choice
          legend="Make names"
          name={`${baseId}-to`}
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
        <Field
          label={
            rule.type === 'prefix' ? 'Text to add before each name' : 'Text to add after each name'
          }
          htmlFor={`${baseId}-text`}
          hint={
            rule.type === 'suffix' ? 'It goes before the extension: photo-final.jpg.' : undefined
          }
        >
          <Input
            id={`${baseId}-text`}
            value={rule.text}
            maxLength={100}
            autoComplete="off"
            placeholder={rule.type === 'prefix' ? 'Kitchen ' : ' final'}
            onChange={(event) => onChange({ ...rule, text: event.target.value })}
          />
        </Field>
      );
    case 'number':
      return (
        <>
          <Field
            label="New name"
            htmlFor={`${baseId}-name`}
            optional
            hint="Type one to give every file the same name plus its number: Kitchen 01, Kitchen 02… Leave it empty to number the names as they are."
          >
            <Input
              id={`${baseId}-name`}
              value={rule.name}
              maxLength={100}
              autoComplete="off"
              placeholder="Keep each name"
              onChange={(event) => onChange({ ...rule, name: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2.5">
            <NumberField
              id={`${baseId}-start`}
              label="Start at"
              value={rule.start}
              min={0}
              max={999_999}
              onChange={(start) => onChange({ ...rule, start })}
            />
            <NumberField
              id={`${baseId}-step`}
              label="Count by"
              value={rule.step}
              min={1}
              max={1000}
              onChange={(step) => onChange({ ...rule, step })}
            />
            <Field label="Digits" htmlFor={`${baseId}-digits`}>
              <Select
                id={`${baseId}-digits`}
                value={String(rule.digits)}
                onChange={(event) => onChange({ ...rule, digits: Number(event.target.value) })}
              >
                <option value="0">Auto</option>
                <option value="1">1</option>
                <option value="2">01</option>
                <option value="3">001</option>
                <option value="4">0001</option>
                <option value="5">00001</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)]">
            <Choice
              legend="Where"
              name={`${baseId}-at`}
              value={rule.at}
              onChange={(at) => onChange({ ...rule, at })}
              options={[
                { value: 'start', label: 'Before' },
                { value: 'end', label: 'After' },
              ]}
            />
            <Field label="Between name and number" htmlFor={`${baseId}-separator`}>
              <Select
                id={`${baseId}-separator`}
                value={rule.separator}
                onChange={(event) => onChange({ ...rule, separator: event.target.value })}
              >
                {SEPARATORS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Number them"
            htmlFor={`${baseId}-order`}
            hint="The preview lists files in this order too."
          >
            <Select
              id={`${baseId}-order`}
              value={rule.order}
              onChange={(event) => onChange({ ...rule, order: event.target.value as Order })}
            >
              {ORDERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      );
    case 'date':
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)]">
            <Choice
              legend="Where"
              name={`${baseId}-at`}
              value={rule.at}
              onChange={(at) => onChange({ ...rule, at })}
              options={[
                { value: 'start', label: 'Before' },
                { value: 'end', label: 'After' },
              ]}
            />
            <Field label="Between name and date" htmlFor={`${baseId}-separator`}>
              <Select
                id={`${baseId}-separator`}
                value={rule.separator}
                onChange={(event) => onChange({ ...rule, separator: event.target.value })}
              >
                {SEPARATORS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted">
            Each file’s last-modified date, as your device reports it (2026-05-03). For photos
            that’s not always the day they were taken.
          </p>
        </>
      );
    case 'extension':
      return (
        <Choice
          legend="Extensions"
          name={`${baseId}-to`}
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
