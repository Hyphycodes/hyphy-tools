'use client';
import { useEffect, useId, useRef, useState, useTransition, type DragEvent } from 'react';
import { addFiles } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Input, Segmented } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { formatBytes } from '@/lib/platform/format';
import { parseRange } from '@/lib/tools/pdf';

/*
 * PDF tools. Merge is Hyphy Studio's PDF Merge (src/components/pdf-merger.tsx) with the same
 * limits and error handling; Extract is new. Both run on this device with pdf-lib, loaded only
 * when needed.
 */

const MAX_FILES = 20;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 500;

type Entry = { id: number; file: File; pages?: number };
type Result = { url: string; name: string; pages: number; size: number; parts: number };

export function PdfTool({ slug, canSave }: { slug: string; canSave: boolean }) {
  const id = useId();
  const toast = useToast();
  const [mode, setMode] = useState<'merge' | 'extract'>('merge');
  const [files, setFiles] = useState<Entry[]>([]);
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [saving, startSaving] = useTransition();
  const nextId = useRef(0);
  const resultUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    },
    [],
  );

  function clearResult() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setResult(null);
    setMessage('');
  }

  async function countPages(entry: Entry) {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(await entry.file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      setFiles((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, pages: doc.getPageCount() } : item,
        ),
      );
    } catch {
      // Unreadable files are reported when merging.
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
    setFiles((current) => (mode === 'extract' ? entries : [...current, ...entries]));
    entries.forEach(countPages);
  }

  function move(index: number, direction: number) {
    clearResult();
    const next = [...files];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setFiles(next);
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
      if (mode === 'merge') {
        for (const entry of files) {
          const input = await load(entry);
          if (output.getPageCount() + input.getPageCount() > MAX_PAGES)
            throw new Error('This batch has more than 500 pages. Please use a smaller batch.');
          const pages = await output.copyPages(input, input.getPageIndices());
          pages.forEach((page) => output.addPage(page));
        }
      } else {
        const input = await load(files[0]);
        const indexes = parseRange(range, input.getPageCount());
        if (!indexes) throw new Error(`Pages go from 1 to ${input.getPageCount()}. Try “1-3, 5”.`);
        const pages = await output.copyPages(input, indexes);
        pages.forEach((page) => output.addPage(page));
        name = `${files[0].file.name.replace(/\.pdf$/i, '')}-pages-${range.replace(/\s+/g, '').replace(/,/g, '_')}.pdf`;
      }
      const bytes = await output.save();
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      resultUrl.current = url;
      setResult({ url, name, pages: output.getPageCount(), size: blob.size, parts: files.length });
      setMessage(
        `Ready: ${output.getPageCount()} pages${mode === 'merge' ? ', in the order shown' : ''}.`,
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
      toast(
        response.ok
          ? { title: result.name, description: 'Saved to Files' }
          : { title: response.error, icon: 'alert' },
      );
    });

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const totalPages = files.reduce((sum, entry) => sum + (entry.pages ?? 0), 0);
  const ready =
    mode === 'merge' ? files.length >= 2 : files.length === 1 && range.trim().length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="rounded-[20px] bg-surface p-5 shadow-card">
        <Segmented
          name={`${id}-mode`}
          value={mode}
          onChange={(value) => {
            setMode(value);
            setFiles([]);
            clearResult();
          }}
          options={[
            { value: 'merge', label: 'Merge PDFs' },
            { value: 'extract', label: 'Extract pages' },
          ]}
        />
        <input
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
        <label
          htmlFor={`${id}-files`}
          onDragEnter={(event) => {
            if (!hasFiles(event) || busy) return;
            event.preventDefault();
            setOver(true);
          }}
          onDragOver={(event) => hasFiles(event) && event.preventDefault()}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            add(event.dataTransfer.files);
          }}
          className={cn(
            'mt-4 flex flex-col items-center gap-2 rounded-[18px] border-[1.5px] border-dashed px-4 py-8 text-center transition-colors',
            over ? 'border-signal bg-signal-soft' : 'border-line-strong bg-subtle hover:bg-well/60',
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-tool-pdf text-ink shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]">
            <Icon name="pdf" size={22} />
          </span>
          <span className="text-[15px] font-semibold">
            {over ? 'Drop to add' : mode === 'merge' ? 'Choose PDFs to merge' : 'Choose one PDF'}
          </span>
          <span className="text-[13px] text-muted">
            {mode === 'merge'
              ? 'Up to 20 files · 50 MB · 500 pages'
              : 'Pull out just the pages you need'}
          </span>
        </label>

        {files.length > 0 && (
          <ol className="row-divide mt-4 rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line)]">
            {files.map((entry, index) => (
              <li key={entry.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="mono-num w-6 text-[11px] text-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <Icon name="pdf" size={18} className="text-tool-pdf" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{entry.file.name}</span>
                  <span className="block text-[12px] text-muted">
                    {formatBytes(entry.file.size)}
                    {entry.pages ? ` · ${entry.pages} pages` : ''}
                  </span>
                </span>
                {mode === 'merge' && (
                  <>
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      aria-label={`Move ${entry.file.name} up`}
                      onClick={() => move(index, -1)}
                      className="grid size-9 place-items-center rounded-[9px] text-muted hover:bg-ink/5 disabled:opacity-30"
                    >
                      <Icon name="chevron-down" size={16} className="rotate-180" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === files.length - 1}
                      aria-label={`Move ${entry.file.name} down`}
                      onClick={() => move(index, 1)}
                      className="grid size-9 place-items-center rounded-[9px] text-muted hover:bg-ink/5 disabled:opacity-30"
                    >
                      <Icon name="chevron-down" size={16} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${entry.file.name}`}
                  onClick={() => {
                    clearResult();
                    setFiles(files.filter((item) => item.id !== entry.id));
                  }}
                  className="grid size-9 place-items-center rounded-[9px] text-muted hover:bg-ink/5"
                >
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {mode === 'extract' && files.length === 1 && (
          <div className="mt-4">
            <label htmlFor={`${id}-range`} className="text-[13.5px] font-medium text-ink-2">
              Pages to keep{' '}
              {files[0].pages ? (
                <span className="font-normal text-muted">(1–{files[0].pages})</span>
              ) : null}
            </label>
            <Input
              id={`${id}-range`}
              value={range}
              onChange={(event) => {
                setRange(event.target.value);
                clearResult();
              }}
              placeholder="1-3, 5"
              className="mt-1.5"
            />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={run} disabled={!ready || busy}>
            {busy
              ? 'Working…'
              : mode === 'merge'
                ? `Merge ${files.length || ''} PDFs`
                : 'Extract pages'}
          </Button>
          {files.length > 0 && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                clearResult();
                setFiles([]);
              }}
            >
              Clear
            </Button>
          )}
          {mode === 'merge' && totalPages > 0 && (
            <span className="ml-auto text-[12.5px] text-muted">{totalPages} pages in total</span>
          )}
        </div>
        <p role="status" className="mt-3 min-h-5 text-[13px] text-muted">
          {message ||
            (mode === 'merge'
              ? 'Choose at least two PDFs to begin.'
              : 'Choose a PDF, then the pages to keep.')}
        </p>
      </div>

      <div className="grid content-start gap-4">
        <div
          className={cn(
            'rounded-[24px] p-6 transition-colors',
            result ? 'bg-tool-pdf/25' : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
          )}
        >
          {result ? (
            <div className="animate-rise">
              <div className="mx-auto w-40 rotate-[-2deg] rounded-[8px] bg-white p-4 shadow-lift">
                <p className="mb-3 h-2 w-1/2 rounded bg-tool-pdf" />
                {[90, 75, 85, 60, 80, 70].map((width, index) => (
                  <p
                    key={index}
                    className="mt-1.5 h-1.5 rounded bg-ink/10"
                    style={{ width: `${width}%` }}
                  />
                ))}
                <p className="mt-3 text-[10px] font-medium text-muted">{result.pages} pages</p>
              </div>
              <p className="mt-5 truncate text-center text-[15px] font-semibold">{result.name}</p>
              <p className="text-center text-[13px] text-ink/60">
                {result.pages} pages · {formatBytes(result.size)}
              </p>
              <div className="mt-5 grid gap-2">
                <a
                  href={result.url}
                  download={result.name}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-ink px-4 text-[15px] font-medium text-white lg:h-10 lg:text-[14px]"
                >
                  <Icon name="download" size={16} /> Download PDF
                </a>
                {canSave && (
                  <Button onClick={saveToFiles} disabled={saving}>
                    <Icon name="files" size={16} /> {saving ? 'Saving…' : 'Save to Files'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center">
              <Icon name="pdf" size={36} className="mx-auto text-faint" />
              <p className="mt-3 text-[14px] font-medium">Your PDF appears here</p>
              <p className="mt-1 text-[13px] text-muted">
                Download it, or save it to Files so it’s attached to your work.
              </p>
            </div>
          )}
        </div>
        <p className="px-1 text-[12.5px] leading-relaxed text-muted">
          Combines pages only: form fields, bookmarks and signatures may not carry over. Keep your
          originals.
        </p>
      </div>
    </div>
  );
}
