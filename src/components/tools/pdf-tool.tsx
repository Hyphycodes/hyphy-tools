'use client';
import { useEffect, useId, useRef, useState, useTransition, type DragEvent } from 'react';
import { addFiles } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Input, Segmented } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { formatBytes, plural } from '@/lib/platform/format';
import { formatRange, parseRange } from '@/lib/tools/pdf';
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
type Result = { url: string; name: string; pages: number; size: number; covers: string[] };

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

export function PdfTool({ slug, canSave }: { slug: string; canSave: boolean }) {
  const id = useId();
  const toast = useToast();
  const [mode, setMode] = useState<'merge' | 'extract'>('merge');
  const [files, setFiles] = useState<Entry[]>([]);
  const [thumbs, setThumbs] = useState<(string | undefined)[]>([]);
  const [keep, setKeep] = useState<number[]>([]);
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [saving, startSaving] = useTransition();
  const [saved, setSaved] = useState(false);
  const nextId = useRef(0);
  const resultUrl = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const open = useRef<PdfPreview | null>(null);
  const generation = useRef(0);

  useEffect(
    () => () => {
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      open.current?.close();
    },
    [],
  );

  function clearResult() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setResult(null);
    setSaved(false);
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

  function add(list: FileList | null) {
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
      setResult({ url, name, pages: output.getPageCount(), size: blob.size, covers });
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

  const saveToFiles = () =>
    result &&
    startSaving(async () => {
      const response = await addFiles(slug, {
        files: [
          { name: result.name, size: result.size, kind: 'pdf', pages: result.pages, source: 'pdf' },
        ],
        folder: 'Made with PDF',
      });
      if (response.ok) setSaved(true);
      toast(
        response.ok
          ? { title: result.name, description: 'Saved to Files' }
          : { title: response.error, icon: 'alert' },
      );
    });

  const totalPages = files.reduce((sum, entry) => sum + (entry.pages ?? 0), 0);
  const ready = mode === 'merge' ? files.length >= 2 : files.length === 1 && keep.length > 0;
  const rangeInvalid = mode === 'extract' && range.trim() !== '' && keep.length === 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-[22px] bg-surface p-4 shadow-card sm:p-5">
        <Segmented
          name={`${id}-mode`}
          value={mode}
          onChange={(value) => {
            generation.current += 1;
            open.current?.close();
            open.current = null;
            setMode(value);
            setFiles([]);
            setThumbs([]);
            setKeep([]);
            setRange('');
            clearResult();
          }}
          options={[
            { value: 'merge', label: 'Merge PDFs' },
            { value: 'extract', label: 'Extract pages' },
          ]}
        />
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
            <DropZone htmlFor={`${id}-files`} mode={mode} busy={busy} onFiles={add} />
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
                      dragging === index ? 'bg-signal-soft opacity-70' : 'hover:bg-subtle',
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
                      <span className="mono-num absolute top-3 left-3 grid size-6 place-items-center rounded-full bg-ink text-[11px] font-medium text-white shadow-lift">
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
                        className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30"
                      >
                        <Icon name="arrow-left" size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={busy || index === files.length - 1}
                        aria-label={`Move ${entry.file.name} later`}
                        onClick={() => reorder(index, index + 1)}
                        className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30"
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
                        className="ml-auto grid size-8 place-items-center rounded-[8px] text-muted hover:bg-critical-soft hover:text-critical"
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
                <Icon name="pdf" size={18} className="ml-1 text-tool-pdf" />
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
                  className="rounded-[9px] px-2.5 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-ink/5"
                >
                  Change
                </label>
              </div>
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <div className="min-w-[160px] flex-1">
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
                    onChange={(event) => typeRange(event.target.value)}
                    placeholder="Tap pages below, or type 1-3, 5"
                    aria-invalid={rangeInvalid}
                    className={cn(
                      rangeInvalid && '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]',
                    )}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!files[0].pages}
                  onClick={() => {
                    const all = Array.from({ length: files[0].pages ?? 0 }, (_, index) => index);
                    setKeep(keep.length === all.length ? [] : all);
                    setRange(keep.length === all.length ? '' : formatRange(all));
                    clearResult();
                  }}
                >
                  {keep.length && keep.length === files[0].pages ? 'Select none' : 'Select all'}
                </Button>
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
                          on ? 'bg-signal-soft' : 'hover:bg-subtle',
                        )}
                      >
                        <Sheet
                          src={src}
                          label={index >= MAX_THUMBS ? String(index + 1) : undefined}
                          className={cn(
                            'transition-[opacity,transform] duration-200',
                            keep.length > 0 && !on && 'opacity-45',
                            on &&
                              'shadow-[0_0_0_2px_var(--color-signal),0_8px_18px_-8px_rgb(50_64_255/.5)]',
                          )}
                        />
                        <span
                          className={cn(
                            'absolute top-3 right-3 grid size-5 place-items-center rounded-full transition-all',
                            on
                              ? 'scale-100 bg-signal text-white'
                              : 'scale-90 bg-white/90 text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
                          )}
                          aria-hidden="true"
                        >
                          <Icon name="check" size={12} strokeWidth={3} />
                        </span>
                        <span
                          className={cn(
                            'mono-num mt-1 block text-center text-[11px]',
                            on ? 'font-medium text-signal-ink' : 'text-muted',
                          )}
                        >
                          {index + 1}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" onClick={run} disabled={!ready || busy}>
            {busy ? (
              <>
                <span
                  className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden="true"
                />
                Working…
              </>
            ) : mode === 'merge' ? (
              `Merge ${files.length >= 2 ? `${files.length} PDFs` : 'PDFs'}`
            ) : (
              `Extract ${keep.length ? plural(keep.length, 'page') : 'pages'}`
            )}
          </Button>
          {files.length > 0 && (
            <Button
              variant="ghost"
              disabled={busy}
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
            </Button>
          )}
          {mode === 'merge' && totalPages > 0 && (
            <span className="ml-auto text-[12.5px] text-muted">
              {plural(totalPages, 'page')} in total
            </span>
          )}
        </div>
        <p role="status" className="mt-2 min-h-5 text-[13px] text-muted">
          {message ||
            (mode === 'merge'
              ? files.length === 1
                ? 'Add one more PDF to merge.'
                : files.length
                  ? ''
                  : 'Choose at least two PDFs to begin.'
              : files.length
                ? keep.length
                  ? ''
                  : 'Tap the pages you want to keep.'
                : 'Choose a PDF, then the pages to keep.')}
        </p>
      </div>

      <div className="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
        <div
          className={cn(
            'rounded-[24px] p-6 transition-colors duration-300',
            result ? 'bg-tool-pdf/25' : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
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
                <span className="absolute -right-3 -bottom-2 rounded-full bg-ink px-2.5 py-1 text-[12px] font-medium text-white shadow-lift">
                  {plural(result.pages, 'page')}
                </span>
              </div>
              <p className="mt-6 truncate text-center text-[15px] font-semibold">{result.name}</p>
              <p className="text-center text-[13px] text-ink/60">
                {plural(result.pages, 'page')} · {formatBytes(result.size)}
              </p>
              <div className="mt-5 grid gap-2">
                <a
                  href={result.url}
                  download={result.name}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-ink px-4 text-[15px] font-medium text-white transition-colors hover:bg-ink-2 lg:h-10 lg:text-[14px]"
                >
                  <Icon name="download" size={16} /> Download PDF
                </a>
                {canSave && (
                  <Button onClick={saveToFiles} disabled={saving || saved}>
                    <Icon name={saved ? 'check' : 'files'} size={16} />
                    {saving ? 'Saving…' : saved ? 'Saved to Files' : 'Save to Files'}
                  </Button>
                )}
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
                Download it, or save it to Files so it’s with the rest of your work.
              </p>
            </div>
          )}
        </div>
        <p className="px-1 text-[12.5px] leading-relaxed text-muted">
          Runs on this device — nothing is uploaded. Pages are combined as they are: form fields,
          bookmarks and signatures may not carry over, so keep your originals.
        </p>
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
        'flex flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed text-center transition-colors',
        compact ? 'aspect-[8.5/11] px-2' : 'px-4 py-10',
        over ? 'border-signal bg-signal-soft' : 'border-line-strong bg-subtle hover:bg-well/60',
      )}
    >
      <span
        className={cn(
          'grid place-items-center rounded-full bg-tool-pdf text-ink shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]',
          compact ? 'size-9' : 'size-12',
        )}
      >
        <Icon name={compact ? 'plus' : 'pdf'} size={compact ? 18 : 22} />
      </span>
      <span className={cn('font-semibold', compact ? 'text-[13px]' : 'text-[15px]')}>
        {over
          ? 'Drop to add'
          : compact
            ? 'Add PDFs'
            : mode === 'merge'
              ? 'Choose PDFs to merge'
              : 'Choose one PDF'}
      </span>
      {!compact && (
        <span className="text-[13px] text-muted">
          {mode === 'merge'
            ? 'Or drop them here · up to 20 files, 50 MB, 500 pages'
            : 'Then tap the pages you want to keep'}
        </span>
      )}
    </label>
  );
}
