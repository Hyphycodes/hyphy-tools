'use client';
import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { SaveProgress, useSaveToFiles } from '@/components/files/save-to-files';
import { useOptionalWorkspace } from '@/components/shell/workspace-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { download } from '@/lib/files/download';
import { zip } from '@/lib/files/zip';
import { formatBytes, plural } from '@/lib/platform/format';
import { AttachPicker } from './attach-picker';
import { DropObject, Payoff, PillButton, SampleButton } from './kit';
import { PdfPages, type MadeFile, type PageJob } from './pdf-pages';
import {
  DeskBar,
  DeskButton,
  CornerButton,
  DocStack,
  GrabNumber,
  PagesArt,
  ResultStack,
  SETTLE,
  type Cover,
} from './pdf-parts';
import { useSortable } from './pdf-sortable';

/*
 * PDF: drop PDFs first, and the tool works out the job. Several PDFs become a stack to put in
 * order and merge (Hyphy Studio's PDF Merge, with the same limits and error handling); one PDF
 * opens onto the desk page by page, to arrange, keep pages from, or split (pdf-pages.tsx).
 * Everything runs on this device: pdf-lib builds the files and PDF.js draws the pages, and both
 * load only once a PDF is chosen.
 */

const MAX_FILES = 20;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 500;

type Doc = { id: number; file: File; pages?: number; thumb?: string; unreadable?: boolean };
type Job = PageJob | 'merge';
type Made = { job: Job; files: (MadeFile & { url: string })[]; from: number };

const STAMP: Record<Job, string> = {
  merge: 'Merged',
  arrange: 'Arranged',
  keep: 'Extracted',
  split: 'Split',
};

const isPdf = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

async function firstPage(file: File) {
  const { openPdf } = await import('@/lib/tools/pdf-preview');
  const doc = await openPdf(file, 220);
  try {
    return { pages: doc.pages, thumb: await doc.thumb(0) };
  } finally {
    doc.close();
  }
}

/**
 * Runs anywhere. Inside a Space (`slug`, `canSave`) a finished PDF can also be saved to Files and
 * attached to a project; in the public world it's the tool alone, and nothing leaves the device.
 */
export function PdfTool({ slug = '', canSave = false }: { slug?: string; canSave?: boolean }) {
  return (
    // The tool's own clay, even inside a Space where there's no world around it.
    <div
      style={
        {
          '--pdf': 'var(--accent, #ff6a3d)',
          '--pdf-ink': 'var(--accent-ink, #b8421b)',
        } as CSSProperties
      }
    >
      <div
        className="min-w-0"
        style={{ '--accent': 'var(--pdf)', '--accent-ink': 'var(--pdf-ink)' } as CSSProperties}
      >
        <PdfDesk slug={slug} canSave={canSave} />
      </div>
    </div>
  );
}

function PdfDesk({ slug, canSave }: { slug: string; canSave: boolean }) {
  const id = useId();
  const workspace = useOptionalWorkspace();
  const [docs, setDocs] = useState<Doc[]>([]);
  /** The one PDF open page by page; null shows the stack (or the way in). */
  const [focus, setFocus] = useState<number | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [message, setMessage] = useState('');
  const [over, setOver] = useState(false);
  const nextId = useRef(0);
  const urls = useRef<string[]>([]);
  const payoff = useRef<HTMLDivElement>(null);

  const working = docs.length > 0;
  const focused = docs.find((doc) => doc.id === focus) ?? null;

  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  function clearMade() {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
    setMade(null);
  }

  function show(job: Job, files: MadeFile[]) {
    clearMade();
    const withUrls = files.map((file) => ({ ...file, url: URL.createObjectURL(file.blob) }));
    urls.current = withUrls.map((file) => file.url);
    setMade({ job, files: withUrls, from: job === 'merge' ? docs.length : 1 });
    setMessage('');
    void fillCovers(withUrls);
  }

  /** Pages that weren't drawn yet (a quick merge, a long file) are drawn from the result itself. */
  async function fillCovers(files: Made['files']) {
    const { openPdf } = await import('@/lib/tools/pdf-preview');
    for (const file of files.slice(0, 24)) {
      if (file.covers.length && file.covers.every((cover) => cover.src)) continue;
      try {
        const doc = await openPdf(file.blob, 220);
        const covers: Cover[] = [];
        for (let index = 0; index < Math.min(3, doc.pages); index += 1)
          covers.push({ src: await doc.thumb(index) });
        doc.close();
        setMade((current) =>
          current && current.files.includes(file)
            ? {
                ...current,
                files: current.files.map((item) => (item === file ? { ...item, covers } : item)),
              }
            : current,
        );
      } catch {
        // The stack keeps its blank sheets.
      }
    }
  }

  // The result takes the stage: bring it into view.
  useEffect(() => {
    if (!made) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    payoff.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }, [made]);

  function patch(docId: number, change: Partial<Doc>) {
    setDocs((current) => current.map((doc) => (doc.id === docId ? { ...doc, ...change } : doc)));
  }

  async function describe(doc: Doc) {
    try {
      patch(doc.id, await firstPage(doc.file));
    } catch {
      patch(doc.id, { unreadable: true });
    }
  }

  /** PDFs in: one opens page by page, more than one makes a stack to merge. */
  function add(list: File[]) {
    if (!list.length || busy) return;
    const pdfs = list.filter(isPdf);
    if (!pdfs.length) {
      setMessage('Those aren’t PDFs. Choose PDF files.');
      return;
    }
    const next = [...docs.map((doc) => doc.file), ...pdfs];
    if (next.length > MAX_FILES || next.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) {
      setMessage(`Up to ${MAX_FILES} PDFs, 50 MB in all.`);
      return;
    }
    clearMade();
    setMessage(pdfs.length < list.length ? 'Only the PDFs were added.' : '');
    const entries = pdfs.map((file) => ({ file, id: nextId.current++ }));
    const all = [...docs, ...entries];
    setDocs(all);
    entries.forEach((entry) => void describe(entry));
    setFocus(all.length === 1 ? all[0].id : null);
  }

  // While working, a PDF dropped anywhere on the page joins the others.
  const latestAdd = useRef(add);
  useLayoutEffect(() => {
    latestAdd.current = add;
  });
  useEffect(() => {
    if (!working) return;
    let depth = 0;
    const has = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
    const enter = (event: DragEvent) => {
      if (!has(event)) return;
      depth += 1;
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (!has(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const dragOver = (event: DragEvent) => {
      if (has(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      depth = 0;
      setOver(false);
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      latestAdd.current(Array.from(event.dataTransfer.files));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', dragOver);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', dragOver);
      window.removeEventListener('drop', drop);
    };
  }, [working]);

  function startOver() {
    clearMade();
    setDocs([]);
    setFocus(null);
    setMessage('');
  }

  async function trySamples(kind: 'merge' | 'extract') {
    setSampling(true);
    try {
      const { samplePdfs } = await import('@/lib/tools/pdf-samples');
      add(await samplePdfs(kind));
    } catch {
      setMessage('We couldn’t make the samples here. Choose your own PDFs instead.');
    } finally {
      setSampling(false);
    }
  }

  async function merge() {
    if (docs.length < 2 || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const output = await PDFDocument.create();
      for (const doc of docs) {
        let input;
        try {
          input = await PDFDocument.load(await doc.file.arrayBuffer());
        } catch {
          throw new Error(
            `“${doc.file.name}” could not be read. Use an unencrypted, undamaged PDF.`,
          );
        }
        if (output.getPageCount() + input.getPageCount() > MAX_PAGES)
          throw new Error('This batch has more than 500 pages. Please use a smaller batch.');
        const pages = await output.copyPages(input, input.getPageIndices());
        pages.forEach((page) => output.addPage(page));
      }
      const bytes = await output.save();
      show('merge', [
        {
          name: `${docs[0].file.name.replace(/\.pdf$/i, '')}-merged.pdf`,
          blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
          pages: output.getPageCount(),
          covers: docs.map((doc) => ({ src: doc.thumb })),
        },
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'We couldn’t make that PDF. Try a smaller batch.',
      );
    } finally {
      setBusy(false);
    }
  }

  // One way to add files while working: a label for this input (only one file input on the page).
  const addInput = working && (
    <input
      id={`${id}-add`}
      type="file"
      accept=".pdf,application/pdf"
      multiple
      disabled={busy}
      className="sr-only"
      onChange={(event) => {
        add(Array.from(event.target.files ?? []));
        event.target.value = '';
      }}
    />
  );
  const addLabel = (text: string) => (
    <label
      htmlFor={`${id}-add`}
      className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-ink/[.05] px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/[.09] hover:text-ink lg:min-h-10"
    >
      <Icon name="plus" size={15} />
      {text}
    </label>
  );
  const closeButton = (
    <button
      type="button"
      onClick={startOver}
      aria-label="Start over"
      title="Start over"
      className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[.06] hover:text-ink lg:size-10"
    >
      <Icon name="x" size={18} />
    </button>
  );

  return (
    <div className="min-w-0">
      {!working && (
        <div className="mx-auto max-w-[620px] py-2 sm:py-6">
          <DropObject
            shape="pages"
            accept=".pdf,application/pdf"
            multiple
            onFiles={add}
            art={<PagesArt />}
            title="Drop your PDFs"
            hint="One to fix up, or a few to merge."
          >
            <SampleButton onClick={() => trySamples('merge')} disabled={sampling}>
              Try three samples
            </SampleButton>
            <SampleButton onClick={() => trySamples('extract')} disabled={sampling}>
              Try a 7-page sample
            </SampleButton>
          </DropObject>
          {message && (
            <p role="status" className="mt-4 text-center text-[14px] text-caution">
              {message}
            </p>
          )}
        </div>
      )}

      {addInput}

      {working && over && (
        <div
          aria-hidden="true"
          className="fx-pop pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-[28px] border-2 border-dashed border-[var(--accent-ink)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
        >
          <span className="rounded-full bg-surface px-5 py-2.5 text-[16px] font-semibold text-ink shadow-lift">
            Let go to add
          </span>
        </div>
      )}

      {working && (
        <div hidden={made !== null}>
          {focused ? (
            <PdfPages
              key={focused.id}
              file={focused.file}
              fixedBar={!workspace}
              onMade={show}
              top={
                <div className="flex shrink-0 items-center gap-1.5">
                  {docs.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setFocus(null)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink/[.05] px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/[.09] hover:text-ink lg:min-h-10"
                    >
                      <Icon name="chevron-left" size={15} />
                      All {docs.length}
                    </button>
                  ) : (
                    addLabel('Add PDFs')
                  )}
                  {closeButton}
                </div>
              }
            />
          ) : (
            <PdfStack
              docs={docs}
              busy={busy}
              fixedBar={!workspace}
              message={message}
              addLabel={addLabel}
              closeButton={closeButton}
              onMerge={merge}
              onOpen={(doc) => setFocus(doc.id)}
              onReorder={setDocs}
              onRemove={(doc) => {
                const rest = docs.filter((item) => item.id !== doc.id);
                if (!rest.length) startOver();
                else setDocs(rest);
              }}
            />
          )}
        </div>
      )}

      {made && (
        <div ref={payoff} className="scroll-mt-24">
          <PdfPayoff
            made={made}
            slug={slug}
            canSave={canSave}
            onBack={clearMade}
            onReset={startOver}
            onOpenPages={(file) => {
              clearMade();
              const doc = { id: nextId.current++, file };
              setDocs([doc]);
              setFocus(doc.id);
              void describe(doc);
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------- Several PDFs: the stack ---------------- */

function PdfStack({
  docs,
  busy,
  fixedBar,
  message,
  addLabel,
  closeButton,
  onMerge,
  onOpen,
  onReorder,
  onRemove,
}: {
  docs: Doc[];
  busy: boolean;
  fixedBar: boolean;
  message: string;
  addLabel: (text: string) => React.ReactNode;
  closeButton: React.ReactNode;
  onMerge: () => void;
  onOpen: (doc: Doc) => void;
  onReorder: (docs: Doc[]) => void;
  onRemove: (doc: Doc) => void;
}) {
  const sort = useSortable({
    keys: docs.map((doc) => doc.id),
    disabled: busy,
    onMove: (from, to) => {
      const next = [...docs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onReorder(next);
    },
  });
  const totalPages = docs.reduce((sum, doc) => sum + (doc.pages ?? 0), 0);
  const reading = docs.some((doc) => doc.pages === undefined && !doc.unreadable);

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2
            className="font-display text-[28px] leading-[1.02] font-bold tracking-[-0.03em] text-ink sm:text-[34px]"
            style={{ fontVariationSettings: "'wdth' 108" }}
          >
            {docs.length === 1 ? '1 PDF' : `${docs.length} PDFs ready`}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-[14.5px] text-muted">
            {docs.length > 1 ? (
              <>
                <Icon name="grip" size={15} /> Drag to reorder
              </>
            ) : (
              'Add one more to merge'
            )}
          </p>
        </div>
        {closeButton}
      </div>

      <ol
        aria-label="PDFs, in order"
        className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5"
      >
        {docs.map((doc, index) => {
          const up = sort.lifted === doc.id;
          const resting = sort.pending === doc.id;
          return (
            <li
              key={doc.id}
              {...sort.item(doc.id)}
              className={cn(
                'group relative min-w-0',
                !busy && 'cursor-grab active:cursor-grabbing',
              )}
            >
              <div
                className={cn(
                  'relative rounded-[18px] p-1 transition-[scale,rotate,background-color,box-shadow] motion-reduce:transition-none',
                  up
                    ? 'scale-[1.06] rotate-[-2deg] bg-surface shadow-[0_28px_44px_-22px_rgb(42_37_33/.55)]'
                    : resting
                      ? 'scale-[.97]'
                      : busy
                        ? 'scale-[.97] opacity-70'
                        : 'hover:bg-ink/[.035]',
                )}
                style={SETTLE}
              >
                <DocStack src={doc.thumb} pages={doc.pages} problem={doc.unreadable} />
                <GrabNumber handle={sort.handle(doc.id)} label={`Move ${doc.file.name}`}>
                  {index + 1}
                </GrabNumber>
                <CornerButton
                  icon="x"
                  label={`Remove ${doc.file.name}`}
                  disabled={busy}
                  onClick={() => onRemove(doc)}
                />
              </div>
              <div className="mt-1.5 flex min-w-0 items-start gap-1 px-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink" title={doc.file.name}>
                    {doc.file.name}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {doc.unreadable
                      ? 'Can’t be opened'
                      : doc.pages
                        ? plural(doc.pages, 'page')
                        : 'Reading…'}
                    <span className="max-sm:hidden"> · {formatBytes(doc.file.size)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  data-no-drag=""
                  disabled={busy || doc.unreadable}
                  onClick={() => onOpen(doc)}
                  aria-label={`Open the pages of ${doc.file.name}`}
                  title="Its pages"
                  className="-mr-1 grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[.07] hover:text-ink disabled:opacity-30 lg:size-9"
                >
                  <Icon name="layers" size={16} />
                </button>
              </div>
            </li>
          );
        })}
        {docs.length < MAX_FILES && (
          <li className="min-w-0">
            <div className="grid aspect-[5/6] place-items-center rounded-[18px] border-[1.5px] border-dashed border-line-strong p-2">
              {addLabel('Add PDFs')}
            </div>
          </li>
        )}
      </ol>

      <DeskBar
        fixed={fixedBar}
        summary={
          <span role="status" className="block truncate">
            {message ||
              (docs.length < 2
                ? 'Add one more PDF to merge.'
                : reading
                  ? 'Reading…'
                  : `${plural(totalPages, 'page')} in total`)}
          </span>
        }
      >
        {docs.length === 1 && (
          <button
            type="button"
            onClick={() => onOpen(docs[0])}
            disabled={docs[0].unreadable}
            className="inline-flex h-14 items-center gap-2 rounded-[16px] bg-ink/[.05] px-5 text-[15px] font-semibold text-ink-2 hover:bg-ink/10 hover:text-ink disabled:opacity-40 sm:h-13"
          >
            <Icon name="layers" size={17} /> Its pages
          </button>
        )}
        <DeskButton busy={busy} icon="merge" onClick={onMerge} disabled={docs.length < 2}>
          {busy ? 'Merging…' : docs.length >= 2 ? `Merge ${docs.length} PDFs` : 'Merge PDFs'}
        </DeskButton>
      </DeskBar>
    </div>
  );
}

/* ---------------- The payoff ---------------- */

function PdfPayoff({
  made,
  slug,
  canSave,
  onBack,
  onReset,
  onOpenPages,
}: {
  made: Made;
  slug: string;
  canSave: boolean;
  onBack: () => void;
  onReset: () => void;
  onOpenPages: (file: File) => void;
}) {
  const toast = useToast();
  const workspace = useOptionalWorkspace();
  const saver = useSaveToFiles(slug);
  const [saved, setSaved] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [zipping, setZipping] = useState(false);
  const savable = canSave && workspace !== null;
  const [only] = made.files;
  const many = made.files.length > 1;
  const pages = made.files.reduce((sum, file) => sum + file.pages, 0);
  const weight = made.files.reduce((sum, file) => sum + file.blob.size, 0);

  const headline =
    made.job === 'merge'
      ? `✓ ${made.from} PDFs merged`
      : made.job === 'keep'
        ? `✓ ${plural(pages, 'page')} pulled out`
        : made.job === 'split'
          ? `✓ Split into ${made.files.length} files`
          : '✓ Pages arranged';

  const saveToFiles = async () => {
    const result = await saver.save(only.blob, only.name, {
      purpose: 'file',
      source: 'pdf',
      folder: 'Made with PDF',
      pages: only.pages,
      attachTo: projectId ? { type: 'project', id: projectId } : null,
    });
    if (!result) return;
    setSaved(result.fileId);
    toast({
      title: result.name,
      description: projectId
        ? `Saved to Files · ${workspace?.options.projects.find((item) => item.id === projectId)?.name}`
        : 'Saved to Files',
      href: workspace?.href(`/files?file=${result.fileId}`),
      action: 'Open',
    });
  };

  const downloadAll = async () => {
    setZipping(true);
    try {
      const base = only.name.replace(/-part-\d+-pages-.*$/, '') || 'split';
      download(
        await zip(made.files.map((file) => ({ name: file.name, data: file.blob }))),
        `${base}-split.zip`,
      );
    } finally {
      setZipping(false);
    }
  };

  return (
    <Payoff
      headline={headline}
      action={
        many
          ? {
              label: zipping ? 'Zipping…' : `Download all (.zip)`,
              icon: 'download',
              onClick: downloadAll,
            }
          : { label: 'Download PDF', icon: 'download', href: only.url, download: only.name }
      }
      secondary={
        <>
          <PillButton icon="undo" onClick={onBack}>
            Make changes
          </PillButton>
          {made.job === 'merge' && (
            <PillButton
              icon="layers"
              onClick={() =>
                onOpenPages(new File([only.blob], only.name, { type: 'application/pdf' }))
              }
            >
              Arrange its pages
            </PillButton>
          )}
        </>
      }
      onReset={onReset}
    >
      {many ? (
        <div className="grid gap-5">
          <ol
            aria-label="Your files"
            className="mx-auto flex w-full max-w-[880px] flex-wrap justify-center gap-x-4 gap-y-6"
          >
            {made.files.slice(0, 24).map((file, index) => (
              <li
                key={file.url}
                className="fx-settle flex w-[calc(50%-8px)] min-w-0 flex-col items-center sm:w-[180px]"
                style={{ '--i': index } as CSSProperties}
              >
                <ResultStack
                  size="sm"
                  covers={file.covers}
                  pages={file.pages}
                  stamp={index === 0 ? STAMP.split : undefined}
                />
                <div className="mt-3 flex w-full min-w-0 items-center gap-1">
                  <p
                    className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink"
                    title={file.name}
                  >
                    File {index + 1}
                    <span className="block truncate text-[12px] font-normal text-muted">
                      {formatBytes(file.blob.size)}
                    </span>
                  </p>
                  <a
                    href={file.url}
                    download={file.name}
                    aria-label={`Download ${file.name}`}
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-ink/[.05] text-ink-2 hover:bg-ink/10 hover:text-ink"
                  >
                    <Icon name="download" size={16} />
                  </a>
                </div>
              </li>
            ))}
          </ol>
          {made.files.length > 24 && (
            <p className="text-[13.5px] text-muted">
              …and {made.files.length - 24} more in the zip
            </p>
          )}
          <p className="text-[13.5px] text-muted tabular-nums">
            {plural(pages, 'page')} · {formatBytes(weight)}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <ResultStack covers={only.covers} pages={only.pages} stamp={STAMP[made.job]} />
          <p className="mt-7 max-w-full truncate text-[16px] font-semibold text-ink">{only.name}</p>
          <p className="text-[13.5px] text-muted tabular-nums">
            {plural(only.pages, 'page')} · {formatBytes(only.blob.size)}
          </p>
          {savable && (
            <div className="mt-5 grid w-full max-w-[360px] gap-2">
              {saved !== null ? (
                <Link
                  href={workspace!.href(`/files?file=${saved}`)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-positive-soft px-5 text-[15px] font-semibold text-positive"
                >
                  <Icon name="check" size={16} /> Saved to Files · Open
                </Link>
              ) : (
                <>
                  <AttachPicker value={projectId} onChange={setProjectId} />
                  <Button onClick={saveToFiles} disabled={saver.busy}>
                    <Icon name="files" size={16} />
                    {saver.busy ? 'Saving…' : 'Save to Files'}
                  </Button>
                  <SaveProgress state={saver.state} className="text-center" />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Payoff>
  );
}
