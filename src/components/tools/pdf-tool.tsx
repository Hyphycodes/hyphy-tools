'use client';
import Link from 'next/link';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import { SaveProgress, useSaveToFiles } from '@/components/files/save-to-files';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { useOptionalWorkspace } from '@/components/shell/workspace-context';
import { AttachPicker } from './attach-picker';
import { formatBytes, plural } from '@/lib/platform/format';
import { formatRange, parseRange } from '@/lib/tools/pdf';
import { ActionBar, ActionButton, MoreOptions, SampleButton } from './kit';
import { PdfOrganize, PdfSplit } from './pdf-pages';
import type { PdfPreview } from '@/lib/tools/pdf-preview';

/*
 * PDF tools. Merge is Hyphy Studio's PDF Merge (src/components/pdf-merger.tsx) with the same
 * limits and error handling; Extract is new. Everything runs on this device: pdf-lib builds the
 * file, PDF.js draws the page thumbnails. Both load only when a PDF is chosen.
 */

const MAX_FILES = 20;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 500;
/** Extract draws this many page thumbnails; longer files show numbered pages after that. */
const MAX_THUMBS = 120;

type Entry = { id: number; file: File; pages?: number; thumb?: string; unreadable?: boolean };
type Result = {
  url: string;
  name: string;
  pages: number;
  size: number;
  covers: string[];
  /** The PDF itself, kept so Save to Files stores these exact bytes. */
  blob: Blob;
};

async function preview(file: File, width: number) {
  const { openPdf } = await import('@/lib/tools/pdf-preview');
  return openPdf(file, width);
}

/** A page as it looks: the thumbnail when it's drawn, a blank sheet until then. */
function Sheet({ src, label, className }: { src?: string; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        'relative block aspect-[8.5/11] overflow-hidden rounded-[6px] bg-white shadow-[0_0_0_1px_rgb(22_21_15/.08),0_6px_16px_-8px_rgb(22_21_15/.35)]',
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="block h-full w-full animate-fade object-cover object-top"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center">
          {label ? (
            <span className="mono-num text-[12px] text-faint">{label}</span>
          ) : (
            <span className="skeleton absolute inset-2.5" />
          )}
        </span>
      )}
    </span>
  );
}

type PdfMode = 'merge' | 'organize' | 'extract' | 'split';

/** Little pages, drawn: what each job does to them. */
function JobArt({ mode }: { mode: PdfMode }) {
  const sheet = (x: number, y: number, key: string | number, dim = false, turn = 0) => (
    <rect
      key={key}
      x={x}
      y={y}
      width="15"
      height="20"
      rx="2.5"
      transform={turn ? `rotate(${turn} ${x + 7.5} ${y + 10})` : undefined}
      className={cn('fill-white stroke-[rgb(0_0_0/.14)]', dim && 'opacity-35')}
    />
  );
  const accent = { fill: 'var(--accent)' };
  return (
    <svg viewBox="0 0 72 36" aria-hidden="true" className="h-9 w-[72px] overflow-visible">
      {mode === 'merge' && (
        <>
          {sheet(2, 2, 'a', false, -8)}
          {sheet(2, 14, 'b', false, 6)}
          <path d="M22 18h14" className="stroke-[var(--accent)]" strokeWidth="2.2" />
          <path d="M33 14l4 4-4 4" className="fill-none stroke-[var(--accent)]" strokeWidth="2.2" />
          {sheet(47, 5, 'c')}
          {sheet(50, 8, 'd')}
          <rect x="53" y="11" width="15" height="20" rx="2.5" style={accent} />
        </>
      )}
      {mode === 'organize' && (
        <>
          {sheet(4, 8, 'a')}
          <rect
            x="28"
            y="6"
            width="15"
            height="20"
            rx="2.5"
            transform="rotate(12 35.5 16)"
            style={accent}
          />
          {sheet(52, 8, 'c')}
          <path
            d="M12 33c8 4 16 4 23 0"
            className="fill-none stroke-[var(--accent)]"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
      {mode === 'extract' && (
        <>
          {[0, 1, 2, 3].map((index) =>
            index % 2 ? (
              sheet(index * 18, 8, index, true)
            ) : (
              <g key={index}>
                <rect x={index * 18} y="8" width="15" height="20" rx="2.5" style={accent} />
                <path
                  d={`M${index * 18 + 4} 18l3 3 5-6`}
                  className="fill-none stroke-[#12110d]"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ),
          )}
        </>
      )}
      {mode === 'split' && (
        <>
          {sheet(4, 8, 'a')}
          <path
            d="M24 18h10"
            className="stroke-[var(--accent)]"
            strokeWidth="2.2"
            strokeDasharray="3 3"
          />
          <rect
            x="40"
            y="2"
            width="15"
            height="20"
            rx="2.5"
            transform="rotate(-8 47.5 12)"
            style={accent}
          />
          {sheet(52, 14, 'c', false, 8)}
        </>
      )}
    </svg>
  );
}

/** The four jobs, as pictures to pick from. */
const JOBS: { value: PdfMode; label: string; hint: string }[] = [
  { value: 'merge', label: 'Merge', hint: 'Many PDFs into one' },
  { value: 'organize', label: 'Organize', hint: 'Reorder, turn, remove' },
  { value: 'extract', label: 'Keep pages', hint: 'Pull out the ones you need' },
  { value: 'split', label: 'Split', hint: 'One PDF into several' },
];

/**
 * What to do with the PDFs: big picture cards to start, a slim row of chips once there's a file
 * (picking another job starts it fresh).
 */
function JobPicker({
  value,
  onChange,
  compact,
}: {
  value: PdfMode;
  onChange: (mode: PdfMode) => void;
  compact: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="What to do"
      className={cn(
        compact
          ? 'scroller -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0'
          : 'grid grid-cols-2 gap-2.5 sm:grid-cols-4',
      )}
    >
      {JOBS.map((job) => {
        const on = job.value === value;
        return compact ? (
          <button
            key={job.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onChange(job.value)}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[14.5px] font-medium whitespace-nowrap transition-[background-color,color,transform] active:scale-[.97] lg:min-h-10 lg:text-[14px]',
              on ? 'text-[#12110d]' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
            )}
            style={on ? { background: 'var(--accent)' } : undefined}
          >
            {job.label}
          </button>
        ) : (
          <button
            key={job.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(job.value)}
            className={cn(
              'flex min-w-0 flex-col items-start gap-2 rounded-[18px] p-3.5 text-left transition-[background-color,box-shadow,transform] active:scale-[.98]',
              on
                ? 'bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] shadow-[inset_0_0_0_2px_var(--accent)]'
                : 'bg-well shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.09]',
            )}
          >
            <JobArt mode={job.value} />
            <span className="text-[15.5px] leading-tight font-semibold text-ink">{job.label}</span>
            <span className="-mt-1.5 text-[12.5px] leading-snug text-muted">{job.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Runs anywhere. Inside a Space (`slug`, `canSave`) merged and extracted PDFs can also be saved to
 * Files and attached to a project; in the public world it's the tool alone, and nothing leaves
 * the device.
 */
export function PdfTool({ slug = '', canSave = false }: { slug?: string; canSave?: boolean }) {
  const [mode, setMode] = useState<PdfMode>('merge');
  const [started, setStarted] = useState(false);
  const pick = (next: PdfMode) => {
    setMode(next);
    setStarted(false);
  };
  const picker = <JobPicker value={mode} onChange={pick} compact={started} />;
  return (
    // The tool's own color, even inside a Space where there's no world around it.
    <div style={{ '--pdf': 'var(--accent, #ff6a3d)' } as CSSProperties}>
      <div style={{ '--accent': 'var(--pdf)' } as CSSProperties}>
        {mode === 'organize' || mode === 'split' ? (
          <div className="min-w-0 rounded-[22px] bg-surface p-4 shadow-card sm:p-5">
            {picker}
            <div className="mt-4">
              {mode === 'organize' ? (
                <PdfOrganize onStarted={setStarted} />
              ) : (
                <PdfSplit onStarted={setStarted} />
              )}
            </div>
          </div>
        ) : (
          <PdfCombine
            key={mode}
            slug={slug}
            canSave={canSave}
            mode={mode}
            picker={picker}
            onStarted={setStarted}
          />
        )}
      </div>
    </div>
  );
}

/** Merge (Hyphy Studio's PDF Merge) and Extract: many files in, or one file's chosen pages out. */
function PdfCombine({
  slug,
  canSave,
  mode,
  picker,
  onStarted,
}: {
  slug: string;
  canSave: boolean;
  mode: 'merge' | 'extract';
  picker: ReactNode;
  onStarted: (started: boolean) => void;
}) {
  const id = useId();
  const toast = useToast();
  const [files, setFiles] = useState<Entry[]>([]);
  const [thumbs, setThumbs] = useState<(string | undefined)[]>([]);
  const [keep, setKeep] = useState<number[]>([]);
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const saver = useSaveToFiles(slug);
  const saving = saver.busy;
  const [saved, setSaved] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const workspace = useOptionalWorkspace();
  const savable = canSave && workspace !== null;
  const nextId = useRef(0);
  const resultUrl = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const resultCard = useRef<HTMLDivElement>(null);
  const open = useRef<PdfPreview | null>(null);
  const generation = useRef(0);

  useEffect(
    () => () => {
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      open.current?.close();
    },
    [],
  );

  useEffect(() => onStarted(files.length > 0), [files.length, onStarted]);

  // On a phone the new PDF lands below the pages: bring its Download button into view.
  useEffect(() => {
    if (!result || !window.matchMedia('(max-width: 1023px)').matches) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resultCard.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'end' });
  }, [result]);

  function clearResult() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setResult(null);
    setSaved(null);
    saver.reset();
    setMessage('');
  }

  function patch(entryId: number, change: Partial<Entry>) {
    setFiles((current) =>
      current.map((item) => (item.id === entryId ? { ...item, ...change } : item)),
    );
  }

  /** Merge: each file's page count and first page. */
  async function describe(entry: Entry) {
    try {
      const doc = await preview(entry.file, 200);
      patch(entry.id, { pages: doc.pages });
      patch(entry.id, { thumb: await doc.thumb(0) });
      doc.close();
    } catch {
      patch(entry.id, { unreadable: true });
    }
  }

  /** Extract: every page, drawn in order so the first ones appear first. */
  async function drawPages(entry: Entry) {
    const run = ++generation.current;
    open.current?.close();
    setThumbs([]);
    try {
      const doc = await preview(entry.file, 150);
      if (run !== generation.current) return doc.close();
      open.current = doc;
      patch(entry.id, { pages: doc.pages });
      setThumbs(Array.from({ length: doc.pages }, () => undefined));
      const count = Math.min(doc.pages, MAX_THUMBS);
      for (const index of Array.from({ length: count }, (_, position) => position)) {
        const src = await doc.thumb(index);
        if (run !== generation.current) return;
        setThumbs((current) => current.map((item, position) => (position === index ? src : item)));
      }
    } catch {
      patch(entry.id, { unreadable: true });
    }
  }

  function add(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (incoming.some((file) => !file.name.toLowerCase().endsWith('.pdf'))) {
      setMessage('Please choose PDF files only.');
      return;
    }
    const limit = mode === 'extract' ? 1 : MAX_FILES;
    const next =
      mode === 'extract'
        ? incoming.slice(0, 1)
        : [...files.map((entry) => entry.file), ...incoming];
    if (next.length > limit || next.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) {
      setMessage(`Choose up to ${MAX_FILES} PDFs, totaling no more than 50 MB.`);
      return;
    }
    clearResult();
    const entries = incoming.slice(0, limit).map((file) => ({ file, id: nextId.current++ }));
    if (mode === 'extract') {
      setFiles(entries);
      setKeep([]);
      setRange('');
      void drawPages(entries[0]);
    } else {
      setFiles((current) => [...current, ...entries]);
      entries.forEach((entry) => void describe(entry));
    }
  }

  // Files picked before the page finished loading never reached the change handler: take them now.
  useEffect(() => {
    const element = input.current;
    if (!element?.files?.length) return;
    const picked = element.files;
    queueMicrotask(() => {
      add(picked);
      element.value = '';
    });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= files.length) return;
    clearResult();
    const next = [...files];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setFiles(next);
  }

  function toggle(index: number) {
    clearResult();
    const next = keep.includes(index)
      ? keep.filter((item) => item !== index)
      : [...keep, index].sort((a, b) => a - b);
    setKeep(next);
    setRange(formatRange(next));
  }

  function typeRange(text: string) {
    clearResult();
    setRange(text);
    const pages = files[0]?.pages;
    const parsed = pages ? parseRange(text, pages) : null;
    setKeep(parsed ?? []);
  }

  /** No PDF handy: make a few on this device so the tool can be felt right away. */
  async function trySamples() {
    setBusy(true);
    try {
      const { samplePdfs } = await import('@/lib/tools/pdf-samples');
      add(await samplePdfs(mode));
    } catch {
      setMessage('We couldn’t make the samples here. Choose your own PDFs instead.');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    clearResult();
    setBusy(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const output = await PDFDocument.create();
      const load = async (entry: Entry) => {
        try {
          return await PDFDocument.load(await entry.file.arrayBuffer());
        } catch {
          throw new Error(
            `“${entry.file.name}” could not be read. Use an unencrypted, undamaged PDF.`,
          );
        }
      };
      let name = 'hyphy-merged.pdf';
      let covers: string[] = [];
      if (mode === 'merge') {
        for (const entry of files) {
          const input = await load(entry);
          if (output.getPageCount() + input.getPageCount() > MAX_PAGES)
            throw new Error('This batch has more than 500 pages. Please use a smaller batch.');
          const pages = await output.copyPages(input, input.getPageIndices());
          pages.forEach((page) => output.addPage(page));
        }
        name = `${files[0].file.name.replace(/\.pdf$/i, '')}-merged.pdf`;
        covers = files.map((entry) => entry.thumb).filter(Boolean) as string[];
      } else {
        const input = await load(files[0]);
        const indexes = keep.length ? keep : parseRange(range, input.getPageCount());
        if (!indexes?.length)
          throw new Error(`Pick pages, or type them — pages go from 1 to ${input.getPageCount()}.`);
        const pages = await output.copyPages(input, indexes);
        pages.forEach((page) => output.addPage(page));
        name = `${files[0].file.name.replace(/\.pdf$/i, '')}-pages-${formatRange(indexes).replace(/\s+/g, '').replace(/,/g, '_')}.pdf`;
        covers = indexes.map((index) => thumbs[index]).filter(Boolean) as string[];
      }
      const bytes = await output.save();
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      resultUrl.current = url;
      setResult({ url, name, pages: output.getPageCount(), size: blob.size, covers, blob });
      setMessage(
        `Ready: ${plural(output.getPageCount(), 'page')}${mode === 'merge' ? ', in the order shown' : ''}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'We couldn’t make that PDF. Try a smaller batch.',
      );
    } finally {
      setBusy(false);
    }
  }

  const saveToFiles = async () => {
    if (!result) return;
    const saved = await saver.save(result.blob, result.name, {
      purpose: 'file',
      source: 'pdf',
      folder: 'Made with PDF',
      pages: result.pages,
      attachTo: projectId ? { type: 'project', id: projectId } : null,
    });
    if (!saved) return;
    setSaved(saved.fileId);
    toast({
      title: saved.name,
      description: projectId
        ? `Saved to Files · ${workspace?.options.projects.find((item) => item.id === projectId)?.name}`
        : 'Saved to Files',
      href: workspace?.href(`/files?file=${saved.fileId}`),
      action: 'Open',
    });
  };

  const totalPages = files.reduce((sum, entry) => sum + (entry.pages ?? 0), 0);
  const ready = mode === 'merge' ? files.length >= 2 : files.length === 1 && keep.length > 0;
  const rangeInvalid = mode === 'extract' && range.trim() !== '' && keep.length === 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-[22px] bg-surface p-4 shadow-card sm:p-5">
        {picker}
        <input
          ref={input}
          id={`${id}-files`}
          type="file"
          accept=".pdf,application/pdf"
          multiple={mode === 'merge'}
          disabled={busy}
          className="sr-only"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = '';
          }}
        />

        <div className="mt-4">
          {files.length === 0 && (
            <>
              <DropZone htmlFor={`${id}-files`} mode={mode} busy={busy} onFiles={add} />
              <SampleButton onClick={trySamples} disabled={busy} className="mt-2">
                {mode === 'merge' ? 'No PDFs handy? Try three samples' : 'Try a 7-page sample'}
              </SampleButton>
            </>
          )}

          {mode === 'merge' && files.length > 0 && (
            <>
              <p className="mb-3 flex items-center gap-2 text-[12.5px] text-muted">
                <Icon name="grip" size={14} /> Drag to reorder — they’re merged left to right
              </p>
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {files.map((entry, index) => (
                  <li
                    key={entry.id}
                    draggable={!busy}
                    onDragStart={(event) => {
                      setDragging(index);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => {
                      if (dragging === null) return;
                      event.preventDefault();
                      if (dragging !== index) {
                        reorder(dragging, index);
                        setDragging(index);
                      }
                    }}
                    className={cn(
                      'group relative animate-rise cursor-grab rounded-[16px] p-2 transition-all active:cursor-grabbing',
                      dragging === index
                        ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] opacity-70'
                        : 'hover:bg-subtle',
                    )}
                  >
                    <div className="relative px-1.5 pt-1.5">
                      {(entry.pages ?? 1) > 1 && (
                        <span
                          className="absolute inset-x-3 top-0 bottom-2 rotate-[3deg] rounded-[6px] bg-white shadow-[0_0_0_1px_rgb(22_21_15/.08)]"
                          aria-hidden="true"
                        />
                      )}
                      <Sheet
                        src={entry.thumb}
                        label={entry.unreadable ? 'Can’t preview' : undefined}
                        className="relative"
                      />
                      <span className="mono-num absolute top-3 left-3 grid size-6 place-items-center rounded-full bg-ink text-[11px] font-medium text-on-ink shadow-lift">
                        {index + 1}
                      </span>
                    </div>
                    <p
                      className="mt-2 truncate px-1 text-[13px] font-medium"
                      title={entry.file.name}
                    >
                      {entry.file.name}
                    </p>
                    <p className="px-1 text-[12px] text-muted">
                      {entry.pages ? plural(entry.pages, 'page') : '…'} ·{' '}
                      {formatBytes(entry.file.size)}
                    </p>
                    <div className="mt-1.5 flex gap-0.5 px-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                      <button
                        type="button"
                        disabled={busy || index === 0}
                        aria-label={`Move ${entry.file.name} earlier`}
                        onClick={() => reorder(index, index - 1)}
                        className="grid size-10 place-items-center rounded-[8px] text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30 lg:size-8"
                      >
                        <Icon name="arrow-left" size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={busy || index === files.length - 1}
                        aria-label={`Move ${entry.file.name} later`}
                        onClick={() => reorder(index, index + 1)}
                        className="grid size-10 place-items-center rounded-[8px] text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30 lg:size-8"
                      >
                        <Icon name="arrow-right" size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove ${entry.file.name}`}
                        onClick={() => {
                          clearResult();
                          setFiles(files.filter((item) => item.id !== entry.id));
                        }}
                        className="ml-auto grid size-10 place-items-center rounded-[8px] text-muted hover:bg-critical-soft hover:text-critical lg:size-8"
                      >
                        <Icon name="x" size={15} />
                      </button>
                    </div>
                  </li>
                ))}
                {files.length < MAX_FILES && (
                  <li className="p-2">
                    <DropZone
                      htmlFor={`${id}-files`}
                      mode={mode}
                      busy={busy}
                      onFiles={add}
                      compact
                    />
                  </li>
                )}
              </ol>
            </>
          )}

          {mode === 'extract' && files.length === 1 && (
            <>
              <div className="mb-3 flex items-center gap-3 rounded-[14px] bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
                <Icon name="pdf" size={18} className="ml-1 text-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">
                    {files[0].file.name}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {files[0].pages ? plural(files[0].pages, 'page') : 'Reading…'} ·{' '}
                    {formatBytes(files[0].file.size)}
                  </span>
                </span>
                <label
                  htmlFor={`${id}-files`}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-[9px] px-3 text-[14px] font-medium text-ink-2 hover:bg-ink/5 lg:min-h-9 lg:text-[13px]"
                >
                  Change
                </label>
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-medium text-ink">
                  {keep.length ? `Keeping ${plural(keep.length, 'page')}` : 'Tap the pages to keep'}
                </p>
                <button
                  type="button"
                  disabled={!files[0].pages}
                  onClick={() => {
                    const all = Array.from({ length: files[0].pages ?? 0 }, (_, index) => index);
                    setKeep(keep.length === all.length ? [] : all);
                    setRange(keep.length === all.length ? '' : formatRange(all));
                    clearResult();
                  }}
                  className="inline-flex min-h-11 items-center rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-45 lg:min-h-9 lg:text-[13.5px]"
                >
                  {keep.length && keep.length === files[0].pages ? 'Select none' : 'Select all'}
                </button>
              </div>
              <ol className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 xl:grid-cols-5">
                {thumbs.map((src, index) => {
                  const on = keep.includes(index);
                  return (
                    <li key={index}>
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`Page ${index + 1}`}
                        onClick={() => toggle(index)}
                        className={cn(
                          'group relative block w-full rounded-[10px] p-1.5 transition-all',
                          on
                            ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]'
                            : 'hover:bg-subtle',
                        )}
                      >
                        <Sheet
                          src={src}
                          label={index >= MAX_THUMBS ? String(index + 1) : undefined}
                          className={cn(
                            'transition-[opacity,transform] duration-200',
                            keep.length > 0 && !on && 'opacity-45',
                            on && 'shadow-[0_0_0_2px_var(--accent),0_8px_18px_-8px_var(--accent)]',
                          )}
                        />
                        <span
                          className={cn(
                            'absolute top-3 right-3 grid size-5 place-items-center rounded-full transition-all',
                            on
                              ? 'scale-100 bg-[var(--accent)] text-[#12110d]'
                              : 'scale-90 bg-white/90 text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
                          )}
                          aria-hidden="true"
                        >
                          <Icon name="check" size={12} strokeWidth={3} />
                        </span>
                        <span
                          className={cn(
                            'mono-num mt-1 block text-center text-[11px]',
                            on ? 'font-semibold text-ink' : 'text-muted',
                          )}
                        >
                          {index + 1}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <MoreOptions
                label="Type page numbers instead"
                summary={range || undefined}
                className="mt-3"
              >
                <label
                  htmlFor={`${id}-range`}
                  className="mb-1.5 block text-[13px] font-medium text-ink-2"
                >
                  Pages to keep{' '}
                  {files[0].pages ? (
                    <span className="font-normal text-muted">(1–{files[0].pages})</span>
                  ) : null}
                </label>
                <Input
                  id={`${id}-range`}
                  value={range}
                  inputMode="numeric"
                  enterKeyHint="done"
                  autoComplete="off"
                  onChange={(event) => typeRange(event.target.value)}
                  placeholder="Like 1-3, 5"
                  aria-invalid={rangeInvalid}
                  className={cn(rangeInvalid && '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]')}
                />
              </MoreOptions>
            </>
          )}
        </div>

        {files.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            {mode === 'merge' && totalPages > 0 && (
              <p className="mb-2 text-[12.5px] text-muted">{plural(totalPages, 'page')} in total</p>
            )}
            <ActionBar
              className={cn('!mt-0', workspace && '!static !mx-0 !bg-none !px-0 !pt-0 !pb-0')}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <ActionButton
                  onClick={run}
                  disabled={!ready || busy}
                  icon={busy ? 'loader' : mode === 'merge' ? 'file-stack' : 'check'}
                  className={cn(busy && '[&>svg]:animate-spin')}
                >
                  {busy
                    ? 'Working…'
                    : mode === 'merge'
                      ? `Merge ${files.length >= 2 ? `${files.length} PDFs` : 'PDFs'}`
                      : `Extract ${keep.length ? plural(keep.length, 'page') : 'pages'}`}
                </ActionButton>
                <ActionButton
                  variant="quiet"
                  disabled={busy}
                  className="!w-auto"
                  onClick={() => {
                    generation.current += 1;
                    clearResult();
                    setFiles([]);
                    setThumbs([]);
                    setKeep([]);
                    setRange('');
                  }}
                >
                  Start over
                </ActionButton>
              </div>
            </ActionBar>
          </div>
        )}
        <p
          role="status"
          className={cn('mt-2 text-[13px] text-muted', files.length ? 'min-h-5' : 'text-center')}
        >
          {message ||
            (mode === 'merge'
              ? files.length === 1
                ? 'Add one more PDF to merge.'
                : ''
              : files.length && !keep.length
                ? 'Tap the pages you want to keep.'
                : '')}
        </p>
      </div>

      <div
        className={cn(
          'content-start gap-4 lg:sticky lg:top-6 lg:grid lg:self-start',
          result ? 'grid' : 'hidden',
        )}
      >
        <div
          ref={resultCard}
          className={cn(
            'scroll-mt-24 scroll-mb-4 rounded-[24px] p-6 transition-colors duration-300',
            result
              ? 'bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]'
              : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
          )}
        >
          {result ? (
            <div className="animate-rise">
              <div className="relative mx-auto h-[190px] w-[150px]">
                {(result.covers.length ? result.covers.slice(0, 3) : [undefined])
                  .map((src, index) => ({ src, index }))
                  .reverse()
                  .map(({ src, index }) => (
                    // Fanned out, first page on top.
                    <span
                      key={index}
                      className="absolute inset-x-0 top-0 transition-transform duration-500"
                      style={{
                        transform: `translateX(${[0, 14, -14][index]}px) rotate(${[0, 5, -5][index]}deg)`,
                      }}
                    >
                      <Sheet src={src} />
                    </span>
                  ))}
                <span className="absolute -right-3 -bottom-2 rounded-full bg-ink px-2.5 py-1 text-[12px] font-medium text-on-ink shadow-lift">
                  {plural(result.pages, 'page')}
                </span>
              </div>
              <p className="mt-6 text-center font-display text-[24px] leading-tight font-bold tracking-[-0.02em] text-ink">
                Your PDF is ready
              </p>
              <p className="mt-1 truncate text-center text-[14px] font-medium text-ink-2">
                {result.name}
              </p>
              <p className="text-center text-[13px] text-ink/60">
                {plural(result.pages, 'page')} · {formatBytes(result.size)}
              </p>
              <div className="mt-5 grid gap-2">
                <a
                  href={result.url}
                  download={result.name}
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-[16px] bg-[var(--accent)] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent)] transition-transform active:scale-[.985] sm:h-13 sm:text-[16px]"
                >
                  <Icon name="download" size={19} /> Download PDF
                </a>
                {savable &&
                  (saved !== null ? (
                    <Link
                      href={workspace!.href(`/files?file=${saved}`)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-positive-soft px-4 text-[15px] font-medium text-positive lg:h-10 lg:text-[14px]"
                    >
                      <Icon name="check" size={16} /> Saved to Files · Open
                    </Link>
                  ) : (
                    <>
                      <AttachPicker value={projectId} onChange={setProjectId} />
                      <Button onClick={saveToFiles} disabled={saving}>
                        <Icon name="files" size={16} />
                        {saving ? 'Saving…' : 'Save to Files'}
                      </Button>
                      <SaveProgress state={saver.state} className="text-center" />
                    </>
                  ))}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center">
              <div className="relative mx-auto h-[120px] w-[96px] opacity-70">
                <span className="absolute inset-0 rotate-[-6deg] rounded-[6px] bg-white shadow-card" />
                <span className="absolute inset-0 rotate-[4deg] rounded-[6px] bg-white shadow-card" />
                <span className="absolute inset-0 grid place-items-center rounded-[6px] bg-white shadow-card">
                  <Icon name="pdf" size={28} className="text-faint" />
                </span>
              </div>
              <p className="mt-5 text-[14px] font-medium">Your new PDF appears here</p>
              <p className="mt-1 text-[13px] text-muted">
                {savable ? 'Download it, or save it to Files.' : 'Ready to download in a moment.'}
              </p>
            </div>
          )}
        </div>
        {result && (
          <p className="px-1 text-[12.5px] leading-relaxed text-muted">
            Pages are copied as they are. Form fields, bookmarks and signatures may not carry over,
            so keep your originals.
          </p>
        )}
      </div>
    </div>
  );
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

/** Where PDFs go in: a big target to start, a page-sized tile once there are files. */
function DropZone({
  htmlFor,
  mode,
  busy,
  onFiles,
  compact = false,
}: {
  htmlFor: string;
  mode: 'merge' | 'extract';
  busy: boolean;
  onFiles: (files: FileList | null) => void;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={htmlFor}
      onDragEnter={(event) => {
        if (!hasFiles(event) || busy) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => hasFiles(event) && event.preventDefault()}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(false);
        onFiles(event.dataTransfer.files);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed text-center transition-colors',
        compact ? 'aspect-[8.5/11] px-2' : 'px-4 py-9',
        over
          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]'
          : 'border-line-strong bg-subtle hover:bg-well/60',
      )}
    >
      <span
        className={cn(
          'grid place-items-center rounded-full bg-[var(--accent)] text-[#12110d] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]',
          compact ? 'size-9' : 'size-12',
        )}
      >
        <Icon name={compact ? 'plus' : 'pdf'} size={compact ? 18 : 22} />
      </span>
      <span
        className={cn(
          'font-semibold',
          compact
            ? 'text-[13px]'
            : 'mt-1 inline-flex h-12 items-center rounded-[13px] bg-ink px-6 text-[16px] text-on-ink shadow-card',
        )}
      >
        {over
          ? 'Drop to add'
          : compact
            ? 'Add PDFs'
            : mode === 'merge'
              ? 'Choose PDFs to merge'
              : 'Choose a PDF'}
      </span>
      {!compact && (
        <span className="text-[13px] text-muted">
          {mode === 'merge'
            ? 'Two or more, in any order: you can rearrange them next'
            : 'Then tap the pages you want to keep'}
        </span>
      )}
    </label>
  );
}
