'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useOptionalWorkspace } from '@/components/shell/workspace-context';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { download } from '@/lib/files/download';
import { zip } from '@/lib/files/zip';
import { formatBytes, plural } from '@/lib/platform/format';
import { everyParts, formatRange, parseParts } from '@/lib/tools/pdf';
import type { PdfPreview } from '@/lib/tools/pdf-preview';
import { ActionBar, ActionButton, FileDrop, IconButton, Note, SampleButton } from './kit';

/*
 * Organize and Split: one PDF at a time, every page shown as it looks. Organize puts pages in a
 * new order, turns sideways scans upright and drops the ones you don't need; Split makes several
 * files out of one. pdf-lib builds the results and PDF.js draws the pages, both on this device.
 */

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 500;
const MAX_THUMBS = 120;

type Page = { index: number; rotation: number; removed: boolean };
type Loaded = { file: File; pages: number };
type Output = { name: string; blob: Blob; url: string; pages: number };

async function open(file: File, width: number) {
  const { openPdf } = await import('@/lib/tools/pdf-preview');
  return openPdf(file, width);
}

function baseName(file: File) {
  return file.name.replace(/\.pdf$/i, '') || 'document';
}

/** Loads one PDF and draws its pages in order, first ones first. */
function usePdf(onLoad?: (loaded: Loaded) => void) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [thumbs, setThumbs] = useState<(string | undefined)[]>([]);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const run = useRef(0);
  const doc = useRef<PdfPreview | null>(null);

  useEffect(
    () => () => {
      run.current += 1;
      doc.current?.close();
    },
    [],
  );

  const load = async (file: File) => {
    const token = ++run.current;
    doc.current?.close();
    doc.current = null;
    setError('');
    setThumbs([]);
    setLoaded(null);
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setError('Please choose a PDF file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That PDF is over 50 MB. Try a smaller one.');
      return;
    }
    setReading(true);
    try {
      const preview = await open(file, 150);
      if (token !== run.current) return preview.close();
      if (preview.pages > MAX_PAGES) {
        preview.close();
        setError(`That PDF has ${preview.pages} pages. Up to ${MAX_PAGES} at a time.`);
        return;
      }
      doc.current = preview;
      setLoaded({ file, pages: preview.pages });
      onLoad?.({ file, pages: preview.pages });
      setThumbs(Array.from({ length: preview.pages }, () => undefined));
      setReading(false);
      for (let index = 0; index < Math.min(preview.pages, MAX_THUMBS); index += 1) {
        const src = await preview.thumb(index);
        if (token !== run.current) return;
        setThumbs((current) => current.map((item, position) => (position === index ? src : item)));
      }
    } catch {
      if (token === run.current)
        setError('That PDF couldn’t be read. Password-protected or damaged files can’t be opened.');
    } finally {
      if (token === run.current) setReading(false);
    }
  };

  const clear = () => {
    run.current += 1;
    doc.current?.close();
    doc.current = null;
    setLoaded(null);
    setThumbs([]);
    setError('');
  };

  return { loaded, thumbs, error, reading, load, clear };
}

function Sheet({
  src,
  label,
  rotation = 0,
  dim = false,
}: {
  src?: string;
  label?: string;
  rotation?: number;
  dim?: boolean;
}) {
  return (
    <span className="relative grid aspect-square place-items-center">
      <span
        className={cn(
          'relative block aspect-[8.5/11] w-[76%] overflow-hidden rounded-[5px] bg-white shadow-[0_0_0_1px_rgb(0_0_0/.12),0_8px_18px_-10px_rgb(0_0_0/.6)] transition-[transform,opacity] duration-300',
          dim && 'opacity-30',
        )}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="block h-full w-full object-cover object-top" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[12px] text-[#a19c91]">
            {label ?? <span className="skeleton absolute inset-2" />}
          </span>
        )}
      </span>
    </span>
  );
}

function Start({
  onFile,
  reading,
  error,
  verb,
  hint,
}: {
  onFile: (file: File) => void;
  reading: boolean;
  error: string;
  verb: string;
  hint: string;
}) {
  const [sampling, setSampling] = useState(false);
  return (
    <div className="grid gap-3">
      <FileDrop
        multiple={false}
        accept=".pdf,application/pdf"
        icon="pdf"
        accent="var(--accent)"
        title={reading ? 'Reading…' : `Choose a PDF to ${verb}`}
        hint={hint}
        disabled={reading}
        onFiles={([file]) => file && onFile(file)}
      />
      <SampleButton
        disabled={sampling || reading}
        onClick={async () => {
          setSampling(true);
          try {
            const { samplePdfs } = await import('@/lib/tools/pdf-samples');
            const [sample] = await samplePdfs('extract');
            onFile(sample);
          } finally {
            setSampling(false);
          }
        }}
      >
        Try a 7-page sample
      </SampleButton>
      {error && (
        <Note icon="alert" tone="caution">
          {error}
        </Note>
      )}
    </div>
  );
}

function Result({
  outputs,
  onClear,
  zipName,
}: {
  outputs: Output[];
  onClear: () => void;
  zipName: string;
}) {
  const [zipping, setZipping] = useState(false);
  if (!outputs.length) return null;
  const total = outputs.reduce((sum, output) => sum + output.blob.size, 0);
  return (
    <div className="grid animate-rise gap-3 rounded-[20px] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)] sm:p-5">
      <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
        {outputs.length === 1 ? 'Your PDF is ready' : `${outputs.length} PDFs are ready`}
        <span className="ml-2 text-[12.5px] font-normal text-muted">{formatBytes(total)}</span>
      </p>
      <ul className="grid gap-1.5">
        {outputs.map((output) => (
          <li
            key={output.url}
            className="flex items-center gap-3 rounded-[12px] bg-surface px-3 py-2 shadow-card"
          >
            <Icon name="pdf" size={17} className="shrink-0 text-[var(--accent)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">{output.name}</span>
              <span className="block text-[12px] text-muted">
                {plural(output.pages, 'page')} · {formatBytes(output.blob.size)}
              </span>
            </span>
            <a
              href={output.url}
              download={output.name}
              aria-label={`Download ${output.name}`}
              className="grid size-10 place-items-center rounded-[10px] text-ink-2 hover:bg-ink/5 hover:text-ink"
            >
              <Icon name="download" size={17} />
            </a>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {outputs.length > 1 && (
          <button
            type="button"
            disabled={zipping}
            onClick={async () => {
              setZipping(true);
              try {
                download(
                  await zip(outputs.map((output) => ({ name: output.name, data: output.blob }))),
                  zipName,
                );
              } finally {
                setZipping(false);
              }
            }}
            className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-[16px] bg-[var(--accent)] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent)] transition-transform active:scale-[.985] disabled:opacity-50 sm:h-13 sm:text-[16px]"
          >
            <Icon name="download" size={19} /> {zipping ? 'Zipping…' : `Download all (.zip)`}
          </button>
        )}
        {outputs.length === 1 && (
          <a
            href={outputs[0].url}
            download={outputs[0].name}
            className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-[16px] bg-[var(--accent)] px-5 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent)] transition-transform active:scale-[.985] disabled:opacity-50 sm:h-13 sm:text-[16px]"
          >
            <Icon name="download" size={19} /> Download PDF
          </a>
        )}
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-14 items-center rounded-[16px] px-4 text-[14.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink sm:h-13"
        >
          Make changes
        </button>
      </div>
    </div>
  );
}

/** Keeps object URLs for outputs and releases them when they're replaced. */
function useOutputs() {
  const [outputs, setOutputs] = useState<Output[]>([]);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const replace = (next: { name: string; blob: Blob; pages: number }[]) => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    const made = next.map((item) => ({ ...item, url: URL.createObjectURL(item.blob) }));
    urls.current = made.map((item) => item.url);
    setOutputs(made);
  };
  return { outputs, replace };
}

async function loadSource(file: File) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(await file.arrayBuffer());
  } catch {
    throw new Error(`“${file.name}” couldn’t be read. Use an unencrypted, undamaged PDF.`);
  }
}

/* ---------------- Organize ---------------- */

const upright = (count: number): Page[] =>
  Array.from({ length: count }, (_, index) => ({ index, rotation: 0, removed: false }));

export function PdfOrganize({ onStarted }: { onStarted?: (started: boolean) => void }) {
  // Inside a Space the tab bar holds the bottom of a phone screen: the action stays in place.
  const workspace = useOptionalWorkspace();
  const { outputs, replace } = useOutputs();
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState<number | null>(null);
  // A new PDF starts in its own order, upright as it came.
  const pdf = usePdf((loaded) => {
    setPages(upright(loaded.pages));
    replace([]);
    setMessage('');
  });
  const started = pdf.loaded !== null;
  useEffect(() => onStarted?.(started), [started, onStarted]);

  const change = (next: Page[]) => {
    setPages(next);
    if (outputs.length) replace([]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= pages.length || from === to) return;
    const next = [...pages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    change(next);
  };
  const kept = pages.filter((page) => !page.removed);
  const changed = pages.some(
    (page, position) => page.index !== position || page.rotation || page.removed,
  );

  const save = async () => {
    if (!pdf.loaded || !kept.length) return;
    setBusy(true);
    setMessage('');
    try {
      const { PDFDocument, degrees } = await import('pdf-lib');
      const source = await loadSource(pdf.loaded.file);
      const output = await PDFDocument.create();
      const copied = await output.copyPages(
        source,
        kept.map((page) => page.index),
      );
      copied.forEach((page, position) => {
        const turn = kept[position].rotation;
        if (turn) page.setRotation(degrees((page.getRotation().angle + turn + 360) % 360));
        output.addPage(page);
      });
      const bytes = await output.save();
      replace([
        {
          name: `${baseName(pdf.loaded.file)}-organized.pdf`,
          blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
          pages: kept.length,
        },
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That PDF couldn’t be rebuilt.');
    } finally {
      setBusy(false);
    }
  };

  if (!pdf.loaded)
    return (
      <Start
        onFile={pdf.load}
        reading={pdf.reading}
        error={pdf.error}
        verb="organize"
        hint="Then reorder, turn or remove its pages."
      />
    );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <Icon name="pdf" size={18} className="ml-1 text-[var(--accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">
            {pdf.loaded.file.name}
          </span>
          <span className="block text-[12px] text-muted">
            {plural(pdf.loaded.pages, 'page')} · {formatBytes(pdf.loaded.file.size)}
            {pages.some((page) => page.removed) && ` · keeping ${kept.length}`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            pdf.clear();
            setPages([]);
            replace([]);
          }}
          className="inline-flex min-h-11 items-center rounded-[9px] px-3 text-[14px] font-medium text-ink-2 hover:bg-ink/5 lg:min-h-9 lg:text-[13px]"
        >
          Change
        </button>
      </div>
      <p className="flex items-center gap-2 text-[12.5px] text-muted">
        <Icon name="grip" size={14} /> Drag pages to reorder, or use the arrows. Turn or remove any
        page.
      </p>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {pages.map((page, position) => (
          <li
            key={page.index}
            draggable={!busy}
            onDragStart={(event) => {
              setDragging(position);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              if (dragging !== position) {
                move(dragging, position);
                setDragging(position);
              }
            }}
            className={cn(
              'group rounded-[16px] p-2 transition-colors',
              dragging === position
                ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]'
                : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
            )}
          >
            <div className="relative cursor-grab active:cursor-grabbing">
              <Sheet
                src={pdf.thumbs[page.index]}
                label={page.index >= MAX_THUMBS ? String(page.index + 1) : undefined}
                rotation={page.rotation}
                dim={page.removed}
              />
              <span className="mono-num absolute top-1 left-1 grid h-6 min-w-6 place-items-center rounded-full bg-ink px-1.5 text-[11px] font-medium text-on-ink">
                {page.removed ? '—' : kept.indexOf(page) + 1}
              </span>
              {page.removed && (
                <span className="absolute inset-x-0 bottom-2 text-center text-[12px] font-semibold text-critical">
                  Removed
                </span>
              )}
            </div>
            <p className="mt-1 text-center text-[11.5px] text-muted">Page {page.index + 1}</p>
            <div className="mt-1 flex items-center justify-center gap-0.5">
              <IconButton
                size="sm"
                icon="arrow-left"
                label={`Move page ${page.index + 1} earlier`}
                disabled={position === 0}
                onClick={() => move(position, position - 1)}
              />
              <IconButton
                size="sm"
                icon="restore"
                label={`Turn page ${page.index + 1} left`}
                onClick={() =>
                  change(
                    pages.map((item) =>
                      item === page ? { ...item, rotation: (item.rotation + 270) % 360 } : item,
                    ),
                  )
                }
              />
              <IconButton
                size="sm"
                icon="rotate-cw"
                label={`Turn page ${page.index + 1} right`}
                onClick={() =>
                  change(
                    pages.map((item) =>
                      item === page ? { ...item, rotation: (item.rotation + 90) % 360 } : item,
                    ),
                  )
                }
              />
              <IconButton
                size="sm"
                icon={page.removed ? 'undo' : 'trash'}
                tone={page.removed ? 'default' : 'danger'}
                label={
                  page.removed ? `Keep page ${page.index + 1}` : `Remove page ${page.index + 1}`
                }
                onClick={() =>
                  change(
                    pages.map((item) =>
                      item === page ? { ...item, removed: !item.removed } : item,
                    ),
                  )
                }
              />
              <IconButton
                size="sm"
                icon="arrow-right"
                label={`Move page ${page.index + 1} later`}
                disabled={position === pages.length - 1}
                onClick={() => move(position, position + 1)}
              />
            </div>
          </li>
        ))}
      </ol>
      <div className="grid gap-2 border-t border-line pt-4">
        <ActionBar className={cn('!mt-0', workspace && '!static !mx-0 !bg-none !px-0 !pt-0 !pb-0')}>
          <ActionButton
            onClick={save}
            disabled={busy || !kept.length || !changed}
            icon="file-stack"
          >
            {busy ? 'Working…' : `Make the new PDF · ${plural(kept.length, 'page')}`}
          </ActionButton>
        </ActionBar>
        {changed && (
          <button
            type="button"
            onClick={() => change(upright(pages.length))}
            className="mx-auto inline-flex h-11 items-center rounded-[12px] px-3 text-[14px] text-muted hover:bg-ink/5 hover:text-ink lg:h-10"
          >
            Undo all changes
          </button>
        )}
        <p role="status" className="text-center text-[13px] text-muted">
          {message ||
            (!changed
              ? 'Reorder, turn or remove a page to begin.'
              : !kept.length
                ? 'Keep at least one page.'
                : '')}
        </p>
      </div>
      <Result
        outputs={outputs}
        onClear={() => replace([])}
        zipName={`${baseName(pdf.loaded.file)}.zip`}
      />
    </div>
  );
}

/* ---------------- Split ---------------- */

export function PdfSplit({ onStarted }: { onStarted?: (started: boolean) => void }) {
  const workspace = useOptionalWorkspace();
  const id = useId();
  const pdf = usePdf();
  const started = pdf.loaded !== null;
  useEffect(() => onStarted?.(started), [started, onStarted]);
  const { outputs, replace } = useOutputs();
  const [how, setHow] = useState<'every' | 'ranges'>('every');
  const [size, setSize] = useState(1);
  const [ranges, setRanges] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const total = pdf.loaded?.pages ?? 0;
  const parts = !total
    ? null
    : how === 'every'
      ? everyParts(total, size)
      : parseParts(ranges, total);

  const save = async () => {
    if (!pdf.loaded || !parts?.length) return;
    setBusy(true);
    setMessage('');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const source = await loadSource(pdf.loaded.file);
      const base = baseName(pdf.loaded.file);
      const width = String(parts.length).length;
      const made = [];
      for (const [index, part] of parts.entries()) {
        const output = await PDFDocument.create();
        const copied = await output.copyPages(source, part);
        copied.forEach((page) => output.addPage(page));
        const bytes = await output.save();
        made.push({
          name: `${base}-part-${String(index + 1).padStart(width, '0')}-pages-${formatRange(part).replace(/\s+/g, '').replace(/,/g, '_')}.pdf`,
          blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
          pages: part.length,
        });
      }
      replace(made);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That PDF couldn’t be split.');
    } finally {
      setBusy(false);
    }
  };

  if (!pdf.loaded)
    return (
      <Start
        onFile={pdf.load}
        reading={pdf.reading}
        error={pdf.error}
        verb="split"
        hint="Then choose where to cut it into separate files."
      />
    );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <Icon name="pdf" size={18} className="ml-1 text-[var(--accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">
            {pdf.loaded.file.name}
          </span>
          <span className="block text-[12px] text-muted">
            {plural(total, 'page')} · {formatBytes(pdf.loaded.file.size)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            pdf.clear();
            replace([]);
          }}
          className="inline-flex min-h-11 items-center rounded-[9px] px-3 text-[14px] font-medium text-ink-2 hover:bg-ink/5 lg:min-h-9 lg:text-[13px]"
        >
          Change
        </button>
      </div>

      <div role="radiogroup" aria-label="How to split" className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ['every', 'Every few pages', 'Each file gets the same number of pages.'],
            ['ranges', 'By page ranges', 'Say exactly which pages go in each file.'],
          ] as const
        ).map(([value, title, line]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={how === value}
            onClick={() => {
              setHow(value);
              replace([]);
            }}
            className={cn(
              'rounded-[14px] p-3.5 text-left transition-colors',
              how === value
                ? 'bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] shadow-[inset_0_0_0_2px_var(--accent)]'
                : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-well',
            )}
          >
            <span className="block text-[14.5px] font-semibold text-ink">{title}</span>
            <span className="block text-[12.5px] text-muted">{line}</span>
          </button>
        ))}
      </div>

      {how === 'every' ? (
        <div className="grid gap-2">
          <label htmlFor={`${id}-size`} className="text-[13.5px] font-medium text-ink-2">
            Pages in each file
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {[1, 2, 5, 10]
              .filter((option) => option < total)
              .map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={size === option}
                  onClick={() => {
                    setSize(option);
                    replace([]);
                  }}
                  className={cn(
                    'h-11 rounded-full px-4 text-[14px] transition-colors lg:h-9 lg:px-3.5 lg:text-[13.5px]',
                    size === option
                      ? 'bg-[var(--accent)] font-medium text-[#12110d]'
                      : 'bg-well text-ink-2 hover:bg-ink/10',
                  )}
                >
                  {option === 1 ? 'Every page' : `${option} pages`}
                </button>
              ))}
            <input
              id={`${id}-size`}
              type="number"
              inputMode="numeric"
              enterKeyHint="done"
              min={1}
              max={total}
              value={size}
              onChange={(event) => {
                setSize(Math.min(total, Math.max(1, Number(event.target.value) || 1)));
                replace([]);
              }}
              className="num h-11 w-20 rounded-full bg-subtle px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)] lg:h-9 lg:text-[14px]"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-ranges`} className="text-[13.5px] font-medium text-ink-2">
            Files, separated by commas{' '}
            <span className="font-normal text-muted">(pages 1–{total})</span>
          </label>
          <input
            id={`${id}-ranges`}
            value={ranges}
            placeholder={`1-3, 4-6, 7-${total}`}
            aria-invalid={ranges.trim() !== '' && !parts}
            onChange={(event) => {
              setRanges(event.target.value);
              replace([]);
            }}
            className="h-11 rounded-[11px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] aria-[invalid=true]:shadow-[inset_0_0_0_1.5px_var(--color-caution)] lg:h-10 lg:text-[14.5px]"
          />
          <p className="text-[12.5px] text-muted">
            “1-3, 4-6, 7-” makes three files; a page can go in more than one.
          </p>
        </div>
      )}

      {parts && parts.length > 0 && (
        <ol className="grid gap-2 sm:grid-cols-2" aria-label="The files you’ll get">
          {parts.slice(0, 40).map((part, index) => (
            <li
              key={index}
              className="flex items-center gap-3 rounded-[14px] bg-subtle p-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              <span className="w-12 shrink-0">
                <Sheet src={pdf.thumbs[part[0]]} label={String(part[0] + 1)} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-ink">File {index + 1}</span>
                <span className="block text-[12.5px] text-muted">
                  {part.length === 1 ? `Page ${part[0] + 1}` : `Pages ${formatRange(part)}`} ·{' '}
                  {plural(part.length, 'page')}
                </span>
              </span>
            </li>
          ))}
          {parts.length > 40 && (
            <li className="px-2 text-[13px] text-muted">…and {parts.length - 40} more</li>
          )}
        </ol>
      )}

      <div className="grid gap-2 border-t border-line pt-4">
        <ActionBar className={cn('!mt-0', workspace && '!static !mx-0 !bg-none !px-0 !pt-0 !pb-0')}>
          <ActionButton
            onClick={save}
            disabled={busy || !parts?.length || (parts.length === 1 && parts[0].length === total)}
            icon="scissors"
          >
            {busy
              ? 'Splitting…'
              : parts?.length
                ? `Split into ${plural(parts.length, 'file')}`
                : 'Split'}
          </ActionButton>
        </ActionBar>
        <p role="status" className="text-center text-[13px] text-muted">
          {message ||
            (how === 'ranges' && ranges.trim() && !parts
              ? `Use pages from 1 to ${total}, like 1-3, 5.`
              : '')}
        </p>
      </div>
      <Result
        outputs={outputs}
        onClear={() => replace([])}
        zipName={`${baseName(pdf.loaded.file)}-split.zip`}
      />
    </div>
  );
}
