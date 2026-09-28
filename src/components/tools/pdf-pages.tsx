'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { formatBytes, plural } from '@/lib/platform/format';
import { everyParts, formatRange, parseParts, parseRange } from '@/lib/tools/pdf';
import type { PdfPreview } from '@/lib/tools/pdf-preview';
import { Advanced } from './kit';
import {
  DeskBar,
  DeskButton,
  DeskIcon,
  GrabNumber,
  JobArt,
  PageSheet,
  SETTLE,
  type Cover,
} from './pdf-parts';
import { useSortable } from './pdf-sortable';

/*
 * One PDF, every page on the desk as it really looks. Three things to do with them, picked by
 * tapping, not by filling in a form:
 *
 * - Arrange: drag pages into a new order, turn the sideways ones, take out the ones you don't need.
 * - Keep pages: tap the pages to pull out into their own PDF.
 * - Split: tap between two pages to cut there (or pick "every 2 pages"); each piece is a file.
 *
 * All three work on the same arrangement, so a page turned in Arrange stays turned when it's
 * kept or split. pdf-lib builds the files and PDF.js draws the pages, both only once a PDF is
 * chosen, and both on this device.
 */

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 500;
/** Pages drawn as thumbnails; longer files show numbered sheets after that. */
const MAX_THUMBS = 120;
const THUMB_WIDTH = 220;

export type PageJob = 'arrange' | 'keep' | 'split';
export type MadeFile = { name: string; blob: Blob; pages: number; covers: Cover[] };

/** A page on the desk: which page of the original, how far it's turned, and whether it stays. */
type Page = { index: number; turn: number; removed: boolean };

const upright = (count: number): Page[] =>
  Array.from({ length: count }, (_, index) => ({ index, turn: 0, removed: false }));
const angle = (turn: number) => ((turn % 360) + 360) % 360;

async function open(file: File, width: number) {
  const { openPdf } = await import('@/lib/tools/pdf-preview');
  return openPdf(file, width);
}

export function baseName(file: File) {
  return file.name.replace(/\.pdf$/i, '') || 'document';
}

/** Loads one PDF and draws its pages in order, first ones first. */
function usePdf() {
  const [pages, setPages] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<(string | undefined)[]>([]);
  const [error, setError] = useState('');
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
    setPages(null);
    if (file.size > MAX_BYTES) {
      setError('That PDF is over 50 MB. Try a smaller one.');
      return;
    }
    try {
      const preview = await open(file, THUMB_WIDTH);
      if (token !== run.current) return preview.close();
      if (preview.pages > MAX_PAGES) {
        preview.close();
        setError(`That PDF has ${preview.pages} pages. Up to ${MAX_PAGES} at a time.`);
        return;
      }
      doc.current = preview;
      setPages(preview.pages);
      setThumbs(Array.from({ length: preview.pages }, () => undefined));
      for (let index = 0; index < Math.min(preview.pages, MAX_THUMBS); index += 1) {
        const src = await preview.thumb(index);
        if (token !== run.current) return;
        setThumbs((current) => current.map((item, position) => (position === index ? src : item)));
      }
    } catch {
      if (token === run.current)
        setError('That PDF couldn’t be read. Password-protected or damaged files can’t be opened.');
    }
  };

  return { pages, thumbs, error, load };
}

async function loadSource(file: File) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(await file.arrayBuffer());
  } catch {
    throw new Error(`“${file.name}” couldn’t be read. Use an unencrypted, undamaged PDF.`);
  }
}

const JOBS: { value: PageJob; label: string }[] = [
  { value: 'arrange', label: 'Arrange' },
  { value: 'keep', label: 'Keep pages' },
  { value: 'split', label: 'Split' },
];

/** What to do with the pages: three chips with a little picture each. */
function JobChips({ value, onChange }: { value: PageJob; onChange: (job: PageJob) => void }) {
  return (
    <div role="radiogroup" aria-label="What to do" className="grid grid-cols-3 gap-2 sm:flex">
      {JOBS.map((job) => {
        const on = job.value === value;
        return (
          <button
            key={job.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(job.value)}
            className={cn(
              'flex min-h-[68px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[18px] px-2 text-[14.5px] font-semibold whitespace-nowrap transition-[background-color,box-shadow,color,transform] active:scale-[.97] sm:min-h-12 sm:flex-row sm:gap-2.5 sm:rounded-full sm:pr-5 sm:pl-3.5 sm:text-[15px]',
              on
                ? 'bg-surface text-ink shadow-[inset_0_0_0_2px_var(--accent-ink),0_10px_24px_-16px_var(--accent)]'
                : 'bg-ink/[.05] text-ink-2 hover:bg-ink/[.09] hover:text-ink',
            )}
          >
            <JobArt job={job.value} />
            {job.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pieces for Split: the kept pages, cut after each page in `cuts`. */
function piecesFrom(order: Page[], cuts: Set<number>) {
  const pieces: Page[][] = [];
  let current: Page[] = [];
  order.forEach((page, position) => {
    current.push(page);
    if (cuts.has(page.index) || position === order.length - 1) {
      pieces.push(current);
      current = [];
    }
  });
  return pieces;
}

/** Cuts that make pieces of `size` pages. */
function cutsEvery(order: Page[], size: number) {
  return new Set(
    everyParts(order.length, size)
      .slice(0, -1)
      .map((part) => order[part[part.length - 1]].index),
  );
}

const tints = ['var(--accent)', 'var(--glow, #c8a27a)', 'var(--third, #8c8177)'];

export function PdfPages({
  file,
  onMade,
  onError,
  top,
  fixedBar = true,
}: {
  file: File;
  /** A new PDF (or several) is ready. */
  onMade: (job: PageJob, files: MadeFile[]) => void;
  onError?: (message: string) => void;
  /** Above the pages, beside the file: back, add, start over. */
  top?: ReactNode;
  /** The bar sticks to the bottom of the screen (not inside a Space, where the tab bar is). */
  fixedBar?: boolean;
}) {
  const id = useId();
  const pdf = usePdf();
  const [job, setJob] = useState<PageJob>('arrange');
  const [pages, setPages] = useState<Page[]>([]);
  const [keep, setKeep] = useState<number[]>([]);
  const [range, setRange] = useState('');
  const [cuts, setCuts] = useState<Set<number>>(new Set());
  const [every, setEvery] = useState(1);
  const [ranges, setRanges] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // The file is this view's whole reason to exist: read it when it opens.
  const { load } = pdf;
  useEffect(() => {
    void load(file);
    // A new file comes with a new view (it's keyed by the file); `load` is a fresh function each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // A new document starts upright, in its own order, cut after every page for Split.
  const total = pdf.pages ?? 0;
  const [seen, setSeen] = useState<number | null>(null);
  if (pdf.pages !== null && seen !== pdf.pages) {
    setSeen(pdf.pages);
    const fresh = upright(pdf.pages);
    setPages(fresh);
    setCuts(cutsEvery(fresh, 1));
  }

  const kept = pages.filter((page) => !page.removed);
  const changed = pages.some(
    (page, position) => page.index !== position || angle(page.turn) || page.removed,
  );
  const keepSet = new Set(keep);
  const typedParts = ranges.trim() && total ? parseParts(ranges, total) : null;
  const pieces = piecesFrom(kept, cuts);
  const splitCount = typedParts ? typedParts.length : pieces.length;
  const everyOptions = [1, 2, 5, 10].filter((size) => size < kept.length);

  const sort = useSortable({
    keys: pages.map((page) => page.index),
    disabled: busy || job !== 'arrange',
    onMove: (from, to) => {
      const next = [...pages];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setPages(next);
    },
  });

  const turn = (target: Page, by: number) =>
    setPages(pages.map((page) => (page === target ? { ...page, turn: page.turn + by } : page)));
  const toggleRemoved = (target: Page) =>
    setPages(pages.map((page) => (page === target ? { ...page, removed: !page.removed } : page)));

  function toggleKeep(index: number) {
    const next = keepSet.has(index)
      ? keep.filter((item) => item !== index)
      : [...keep, index].sort((a, b) => a - b);
    setKeep(next);
    setRange(formatRange(next));
  }

  function typeRange(text: string) {
    setRange(text);
    const parsed = total ? parseRange(text, total) : null;
    const removed = new Set(pages.filter((page) => page.removed).map((page) => page.index));
    setKeep((parsed ?? []).filter((index) => !removed.has(index)));
  }

  function toggleCut(index: number) {
    const next = new Set(cuts);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setCuts(next);
  }

  /** Builds one PDF from pages of the original, each turned as set. */
  async function build(list: Page[], name: string): Promise<MadeFile> {
    const { PDFDocument, degrees } = await import('pdf-lib');
    const source = await loadSource(file);
    const output = await PDFDocument.create();
    const copied = await output.copyPages(
      source,
      list.map((page) => page.index),
    );
    copied.forEach((copy, position) => {
      const by = angle(list[position].turn);
      if (by) copy.setRotation(degrees((copy.getRotation().angle + by) % 360));
      output.addPage(copy);
    });
    const bytes = await output.save();
    return {
      name,
      blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
      pages: list.length,
      covers: list.slice(0, 3).map((page) => ({ src: pdf.thumbs[page.index], turn: page.turn })),
    };
  }

  async function make() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    const base = baseName(file);
    try {
      if (job === 'arrange') {
        onMade('arrange', [await build(kept, `${base}-organized.pdf`)]);
      } else if (job === 'keep') {
        const list = kept.filter((page) => keepSet.has(page.index));
        if (!list.length) throw new Error('Tap the pages you want to keep.');
        const name = `${base}-pages-${formatRange(list.map((page) => page.index))
          .replace(/\s+/g, '')
          .replace(/,/g, '_')}.pdf`;
        onMade('keep', [await build(list, name)]);
      } else {
        const byIndex = new Map(pages.map((page) => [page.index, page]));
        const parts = typedParts
          ? typedParts.map((part) => part.map((index) => byIndex.get(index)!))
          : pieces;
        const width = String(parts.length).length;
        const made: MadeFile[] = [];
        for (const [position, part] of parts.entries()) {
          const pageNames = formatRange(part.map((page) => page.index))
            .replace(/\s+/g, '')
            .replace(/,/g, '_');
          made.push(
            await build(
              part,
              `${base}-part-${String(position + 1).padStart(width, '0')}-pages-${pageNames}.pdf`,
            ),
          );
        }
        onMade('split', made);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'That PDF couldn’t be rebuilt.';
      setMessage(text);
      onError?.(text);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="grid size-11 shrink-0 place-items-center rounded-[12px] text-[var(--on-accent,#12110d)]"
        style={{ background: 'var(--accent)' }}
      >
        <Icon name="pdf" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-semibold text-ink">{file.name}</span>
        <span className="block text-[13px] text-muted">
          {pdf.pages === null ? 'Reading…' : plural(total, 'page')} · {formatBytes(file.size)}
        </span>
      </span>
      {top}
    </div>
  );

  if (pdf.error)
    return (
      <div className="grid gap-4">
        {header}
        <p className="rounded-[16px] bg-caution-soft px-4 py-3.5 text-[14.5px] text-caution">
          <Icon name="alert" size={16} className="mr-2 inline -translate-y-px" />
          {pdf.error}
        </p>
      </div>
    );

  const grid =
    job === 'arrange'
      ? 'grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6'
      : job === 'keep'
        ? 'grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7'
        : 'grid-cols-3 gap-x-5 gap-y-4 pr-[22px] sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7';

  // Parts of a split, for the colored band under each page.
  const pieceOf = new Map<number, number>();
  pieces.forEach((piece, position) => piece.forEach((page) => pieceOf.set(page.index, position)));

  const shown = job === 'arrange' ? pages : kept;
  const selected = kept.filter((page) => keepSet.has(page.index)).length;

  return (
    <div className="grid min-w-0 gap-4">
      {header}
      <JobChips
        value={job}
        onChange={(next) => {
          setJob(next);
          setMessage('');
        }}
      />

      {/* What this job needs, in one quiet row. */}
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        {job === 'arrange' && (
          <>
            <p className="mr-auto flex items-center gap-2 text-[14px] text-muted">
              <Icon name="grip" size={15} />
              Drag to reorder
            </p>
            <QuietChip
              icon="rotate-cw"
              disabled={!total}
              onClick={() => setPages(pages.map((page) => ({ ...page, turn: page.turn + 90 })))}
            >
              Turn all
            </QuietChip>
            {changed && (
              <QuietChip
                icon="undo"
                onClick={() => {
                  setPages(upright(total));
                  setMessage('');
                }}
              >
                Undo all
              </QuietChip>
            )}
          </>
        )}
        {job === 'keep' && (
          <>
            <p className="mr-auto text-[14px] text-muted">
              {selected ? (
                <span className="font-semibold text-ink">{plural(selected, 'page')} picked</span>
              ) : (
                'Tap the pages to keep'
              )}
            </p>
            <QuietChip
              disabled={!total}
              onClick={() => {
                const all = kept.map((page) => page.index).sort((a, b) => a - b);
                const next = selected === kept.length ? [] : all;
                setKeep(next);
                setRange(formatRange(next));
              }}
            >
              {selected && selected === kept.length ? 'Select none' : 'Select all'}
            </QuietChip>
          </>
        )}
        {job === 'split' && (
          <div role="radiogroup" aria-label="Where to cut" className="flex flex-1 flex-wrap gap-2">
            {[...everyOptions, ...(kept.length >= 4 ? ['half' as const] : [])].map((option) => {
              const preset =
                option === 'half'
                  ? new Set([kept[Math.ceil(kept.length / 2) - 1]?.index])
                  : cutsEvery(kept, option);
              const on =
                !typedParts &&
                preset.size === cuts.size &&
                [...preset].every((index) => cuts.has(index));
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setCuts(preset);
                    setRanges('');
                  }}
                  className={cn(
                    'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[14.5px] font-medium whitespace-nowrap transition-[background-color,color,transform] active:scale-[.97]',
                    on
                      ? 'text-[var(--on-accent,#12110d)]'
                      : 'bg-ink/[.05] text-ink-2 hover:bg-ink/[.09] hover:text-ink',
                  )}
                  style={on ? { background: 'var(--accent)' } : undefined}
                >
                  {option === 'half'
                    ? 'In half'
                    : option === 1
                      ? 'Every page'
                      : `Every ${option} pages`}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {pdf.pages === null ? (
        <ol aria-label="Pages" className={cn('grid', grid)}>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <li key={index}>
              <PageSheet />
            </li>
          ))}
        </ol>
      ) : (
        <ol
          aria-label="Pages"
          className={cn('grid', grid, typedParts && job === 'split' && 'opacity-50')}
        >
          {shown.map((page, position) => {
            const src = pdf.thumbs[page.index];
            const label = page.index >= MAX_THUMBS ? String(page.index + 1) : undefined;
            const number = page.index + 1;

            if (job === 'keep') {
              const on = keepSet.has(page.index);
              return (
                <li key={page.index}>
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`Page ${number}`}
                    onClick={() => toggleKeep(page.index)}
                    className={cn(
                      'relative block w-full rounded-[14px] p-1 transition-[background-color,transform] active:scale-[.97]',
                      on
                        ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]'
                        : 'hover:bg-ink/[.04]',
                    )}
                  >
                    <PageSheet src={src} label={label} turn={page.turn} dim={selected > 0 && !on} />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute top-2 right-2 grid size-6 place-items-center rounded-full transition-[transform,background-color]',
                        on
                          ? 'scale-100 text-[var(--on-accent,#12110d)]'
                          : 'scale-90 bg-surface text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
                      )}
                      style={{ ...SETTLE, ...(on ? { background: 'var(--accent)' } : {}) }}
                    >
                      <Icon name="check" size={13} strokeWidth={3} />
                    </span>
                    <span
                      className={cn(
                        'mono-num block pb-0.5 text-center text-[12px]',
                        on ? 'font-semibold text-ink' : 'text-muted',
                      )}
                    >
                      {number}
                    </span>
                  </button>
                </li>
              );
            }

            if (job === 'split') {
              const piece = pieceOf.get(page.index) ?? 0;
              const last = position === shown.length - 1;
              const cut = cuts.has(page.index) && !last;
              const starts = position === 0 || cuts.has(shown[position - 1].index);
              return (
                <li key={page.index} className="relative">
                  <PageSheet src={src} label={label} turn={page.turn} />
                  <span
                    aria-hidden="true"
                    className="mt-1 block h-1.5 rounded-full transition-colors motion-reduce:transition-none"
                    style={{ ...SETTLE, background: tints[piece % tints.length] }}
                  />
                  <span className="mt-1 flex items-center justify-between gap-1 text-[12px] text-muted">
                    <span className="mono-num">{number}</span>
                    {starts && !typedParts && (
                      <span className="truncate font-semibold text-ink-2">File {piece + 1}</span>
                    )}
                  </span>
                  {!last && (
                    <button
                      type="button"
                      aria-pressed={cut}
                      aria-label={`Cut after page ${number}`}
                      onClick={() => {
                        toggleCut(page.index);
                        setRanges('');
                      }}
                      className="group/cut absolute top-0 -right-[22px] z-10 grid h-[calc(100%-26px)] w-[24px] place-items-center"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute inset-y-[6%] left-1/2 w-0 border-l-2 transition-opacity',
                          cut
                            ? 'border-dashed border-[var(--accent-ink)] opacity-100'
                            : 'border-dotted border-ink/25 opacity-0 group-hover/cut:opacity-100',
                        )}
                      />
                      <span
                        className={cn(
                          'relative grid size-8 place-items-center rounded-full transition-[transform,background-color,color] group-active/cut:scale-90',
                          cut
                            ? 'text-[var(--on-accent,#12110d)] shadow-[0_6px_14px_-8px_var(--accent)]'
                            : 'bg-surface text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] group-hover/cut:text-ink',
                        )}
                        style={{ ...SETTLE, ...(cut ? { background: 'var(--accent)' } : {}) }}
                      >
                        <Icon name="scissors" size={15} />
                      </span>
                    </button>
                  )}
                </li>
              );
            }

            // Arrange: pick it up, turn it, take it out.
            const up = sort.lifted === page.index;
            const resting = sort.pending === page.index;
            return (
              <li
                key={page.index}
                {...sort.item(page.index)}
                className={cn(
                  'group relative min-w-0',
                  !busy && 'cursor-grab active:cursor-grabbing',
                )}
              >
                <div
                  className={cn(
                    'relative rounded-[16px] transition-[scale,rotate,background-color,box-shadow] motion-reduce:transition-none',
                    up
                      ? 'scale-[1.06] rotate-[-2deg] bg-surface shadow-[0_28px_44px_-22px_rgb(42_37_33/.55)]'
                      : resting
                        ? 'scale-[.97]'
                        : 'hover:bg-ink/[.035]',
                  )}
                  style={SETTLE}
                >
                  <PageSheet src={src} label={label} turn={page.turn} dim={page.removed}>
                    {page.removed && (
                      <span className="absolute inset-x-0 top-[42%] text-center">
                        <span className="rounded-full bg-critical-soft px-2.5 py-1 text-[12px] font-semibold text-critical">
                          Removed
                        </span>
                      </span>
                    )}
                  </PageSheet>
                  <GrabNumber handle={sort.handle(page.index)} label={`Move page ${number}`}>
                    {page.removed ? '—' : kept.indexOf(page) + 1}
                  </GrabNumber>
                </div>
                <div
                  data-no-drag=""
                  className="mt-1 flex items-center justify-center gap-0.5 transition-opacity lg:opacity-60 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100"
                >
                  <PageButton
                    icon="restore"
                    label={`Turn page ${number} left`}
                    disabled={page.removed}
                    onClick={() => turn(page, -90)}
                  />
                  <span className="mono-num min-w-7 text-center text-[12px] text-muted">
                    {number}
                  </span>
                  <PageButton
                    icon="rotate-cw"
                    label={`Turn page ${number} right`}
                    disabled={page.removed}
                    onClick={() => turn(page, 90)}
                  />
                  <PageButton
                    icon={page.removed ? 'undo' : 'trash'}
                    danger={!page.removed}
                    label={page.removed ? `Keep page ${number}` : `Remove page ${number}`}
                    onClick={() => toggleRemoved(page)}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {job === 'keep' && total > 0 && (
        <Advanced summary={range || undefined}>
          <label
            htmlFor={`${id}-range`}
            className="mb-1.5 block text-[13.5px] font-medium text-ink-2"
          >
            Pages to keep <span className="font-normal text-muted">(1–{total})</span>
          </label>
          <Input
            id={`${id}-range`}
            value={range}
            inputMode="numeric"
            enterKeyHint="done"
            autoComplete="off"
            onChange={(event) => typeRange(event.target.value)}
            placeholder="Like 1-3, 5"
            aria-invalid={range.trim() !== '' && keep.length === 0}
            className={cn(
              range.trim() !== '' &&
                keep.length === 0 &&
                '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]',
            )}
          />
        </Advanced>
      )}
      {job === 'split' && total > 1 && (
        <Advanced summary={typedParts ? ranges : undefined}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span id={`${id}-every`} className="text-[13.5px] font-medium text-ink-2">
                Pages in each file
              </span>
              <Stepper
                labelledBy={`${id}-every`}
                value={every}
                min={1}
                max={Math.max(1, kept.length)}
                onChange={(size) => {
                  setEvery(size);
                  setCuts(cutsEvery(kept, size));
                  setRanges('');
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-ranges`} className="text-[13.5px] font-medium text-ink-2">
                By page ranges <span className="font-normal text-muted">(pages 1–{total})</span>
              </label>
              <Input
                id={`${id}-ranges`}
                value={ranges}
                placeholder={`1-3, 4-6, 7-${total}`}
                autoComplete="off"
                aria-invalid={ranges.trim() !== '' && !typedParts}
                onChange={(event) => setRanges(event.target.value)}
                className={cn(
                  ranges.trim() !== '' &&
                    !typedParts &&
                    '!shadow-[inset_0_0_0_1.5px_var(--color-caution)]',
                )}
              />
              <p className="text-[12.5px] text-muted">
                One file per range; a page can go in more than one.
              </p>
            </div>
          </div>
        </Advanced>
      )}

      <DeskBar
        fixed={fixedBar}
        summary={
          <span role="status" className="block truncate">
            {message ||
              (job === 'arrange'
                ? !kept.length
                  ? 'Keep at least one page.'
                  : changed
                    ? `${plural(kept.length, 'page')} in the new order`
                    : 'Drag, turn or remove pages'
                : job === 'keep'
                  ? selected
                    ? `Pages ${formatRange(kept.filter((page) => keepSet.has(page.index)).map((page) => page.index))}`
                    : 'Nothing picked yet'
                  : ranges.trim() && !typedParts
                    ? `Use pages 1 to ${total}, like 1-3, 5.`
                    : `${plural(splitCount, 'file')} from ${plural(kept.length, 'page')}`)}
          </span>
        }
      >
        {job === 'arrange' && changed && (
          <DeskIcon icon="undo" label="Undo all changes" onClick={() => setPages(upright(total))} />
        )}
        <DeskButton
          busy={busy}
          onClick={make}
          icon={job === 'split' ? 'scissors' : job === 'keep' ? 'check' : 'file-stack'}
          disabled={
            !total ||
            (job === 'arrange' && (!changed || !kept.length)) ||
            (job === 'keep' && !selected) ||
            (job === 'split' && (splitCount < 2 || (ranges.trim() !== '' && !typedParts)))
          }
        >
          {busy
            ? 'Working…'
            : job === 'arrange'
              ? `Save PDF · ${plural(kept.length, 'page')}`
              : job === 'keep'
                ? `Extract ${selected ? plural(selected, 'page') : 'pages'}`
                : splitCount > 1
                  ? `Split into ${splitCount} files`
                  : 'Split'}
        </DeskButton>
      </DeskBar>
    </div>
  );
}

function QuietChip({
  children,
  icon,
  onClick,
  disabled,
}: {
  children: ReactNode;
  icon?: Parameters<typeof Icon>[0]['name'];
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink/[.05] px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/[.09] hover:text-ink disabled:opacity-40 lg:min-h-10"
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

/** Turn and remove, under a page: big enough for a thumb, quiet until wanted. */
function PageButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-[background-color,color,transform] active:scale-90 disabled:opacity-30 lg:size-9',
        danger ? 'hover:bg-critical-soft hover:text-critical' : 'hover:bg-ink/[.07] hover:text-ink',
      )}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

/** A number without typing: minus, the number, plus. */
function Stepper({
  value,
  min,
  max,
  onChange,
  labelledBy,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  labelledBy: string;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="inline-flex h-12 w-fit items-center gap-1 rounded-full bg-ink/[.05] p-1"
    >
      <button
        type="button"
        aria-label="Fewer"
        disabled={value <= min}
        onClick={() => set(value - 1)}
        className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-surface disabled:opacity-35"
      >
        <Icon name="minus" size={16} />
      </button>
      <span
        className="mono-num min-w-10 text-center text-[16px] font-semibold text-ink"
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="More"
        disabled={value >= max}
        onClick={() => set(value + 1)}
        className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-surface disabled:opacity-35"
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
