'use client';
import { useEffect, useId, useRef, useState, useTransition, type DragEvent } from 'react';
import { addFiles } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input, Select } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { formatBytes } from '@/lib/platform/format';

/*
 * Image Resize, ported from Hyphy Studio (src/components/tools/image-tool.tsx). The conversion
 * pipeline and limits are unchanged. New here: images start converting the moment they're added
 * (1920 px wide by default), a file never comes back bigger than it went in, and results can be
 * saved to Files.
 */

const MAX_FILES = 20;
const MAX_BYTES = 40 * 1024 * 1024;
const PRESETS = [800, 1200, 1920];
const FORMATS = [
  { value: 'original', label: 'Same as original' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/png', label: 'PNG' },
] as const;
/** The formats a canvas can write: file extension and display name. */
const OUTPUTS: Record<string, { extension: string; name: string }> = {
  'image/jpeg': { extension: 'jpg', name: 'JPEG' },
  'image/png': { extension: 'png', name: 'PNG' },
  'image/webp': { extension: 'webp', name: 'WebP' },
};
const READABLE = /\.(jpe?g|png|webp|gif|avif|hei[cf])$/i;

type Format = (typeof FORMATS)[number]['value'];
type Size = { width: number; height: number };
type Result = Size & { size: number; url: string; name: string; kept?: boolean };
type Item = {
  id: number;
  file: File;
  /** The original, shown until the result is ready. */
  preview?: string;
  state: 'ready' | 'working' | 'done' | 'error';
  source?: Size;
  result?: Result;
  error?: string;
};

function change(from: number, to: number) {
  const percent = Math.round((to / from - 1) * 100);
  if (percent === 0) return '0%';
  return percent < 0 ? `−${-percent}%` : `+${percent}%`;
}

function list(names: string[]) {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

const readError = (name: string) => `Couldn’t read ${name}. Try JPG, PNG or WebP.`;

/** Canvas can write JPEG, PNG and WebP; GIF and AVIF sources get the nearest sensible format. */
function outputType(format: Format, file: File) {
  if (format !== 'original') return format;
  if (file.type in OUTPUTS) return file.type;
  if (file.type === 'image/gif') return 'image/png';
  return file.type === 'image/avif' ? 'image/webp' : 'image/jpeg';
}

async function convert(file: File, maxWidth: number | null, type: string, quality: number) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(readError(file.name));
  }
  const source = { width: bitmap.width, height: bitmap.height };
  const width = maxWidth && maxWidth < source.width ? maxWidth : source.width;
  const height = Math.max(1, Math.round((source.height * width) / source.width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) {
    // JPEG has no transparency; give see-through pixels a white backdrop instead of black.
    if (type === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
  }
  bitmap.close();
  const blob = context
    ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality / 100))
    : null;
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) {
    throw new Error(
      `Couldn’t save ${file.name}. It may be too large for this browser. ` +
        'Try a smaller max width.',
    );
  }
  return { source, width, height, blob };
}

export function ImageTool({ slug, canSave }: { slug: string; canSave: boolean }) {
  const toast = useToast();
  const [saving, startSaving] = useTransition();
  const id = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [maxWidth, setMaxWidth] = useState('1920');
  const [format, setFormat] = useState<Format>('original');
  const [quality, setQuality] = useState(80);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState('');
  const [applied, setApplied] = useState('');
  const settings = `${maxWidth}|${format}|${quality}`;
  const nextId = useRef(0);
  const run = useRef(0);
  const urls = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const created = urls.current;
    const runs = run;
    return () => {
      runs.current += 1; // stops a batch that is still running
      created.forEach((url) => URL.revokeObjectURL(url));
      created.clear();
    };
  }, []);

  const release = (url?: string) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  };
  const patch = (itemId: number, changes: Partial<Item>) =>
    setItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...changes } : item)),
    );

  async function convertAll(queue: Item[] = items) {
    const token = ++run.current;
    setApplied(settings);
    const parsed = Number.parseInt(maxWidth, 10);
    const limit = parsed > 0 ? parsed : null;
    queue.forEach((item) => item.result?.url !== item.preview && release(item.result?.url));
    setItems((current) =>
      current.map((item) => ({ ...item, state: 'ready', result: undefined, error: undefined })),
    );
    setBusy(true);
    const failures: string[] = [];
    const fallbacks = new Set<string>();
    let before = 0;
    let after = 0;
    let larger = 0;
    let kept = 0;
    for (const [index, item] of queue.entries()) {
      setMessage(`Working on ${index + 1} of ${queue.length}: ${item.file.name}`);
      patch(item.id, { state: 'working' });
      const type = outputType(format, item.file);
      try {
        const output = await convert(item.file, limit, type, quality);
        if (run.current !== token) return;
        if (output.blob.type !== type) fallbacks.add(OUTPUTS[type].name);
        // Same size and format, but heavier? Hand back the original rather than a worse file.
        const keep =
          output.blob.size >= item.file.size &&
          output.width === output.source.width &&
          output.blob.type === item.file.type;
        const blob = keep ? item.file : output.blob;
        const url = keep && item.preview ? item.preview : URL.createObjectURL(blob);
        urls.current.add(url);
        const base = item.file.name.replace(/\.[^.]+$/, '') || 'image';
        const extension = OUTPUTS[output.blob.type]?.extension ?? 'png';
        before += item.file.size;
        after += blob.size;
        if (blob.size > item.file.size) larger += 1;
        if (keep) kept += 1;
        patch(item.id, {
          state: 'done',
          source: output.source,
          result: {
            width: output.width,
            height: output.height,
            size: blob.size,
            url,
            name: keep ? item.file.name : `${base}-${output.width}w.${extension}`,
            kept: keep,
          },
        });
      } catch (error) {
        if (run.current !== token) return;
        const reason = error instanceof Error ? error.message : readError(item.file.name);
        failures.push(reason);
        patch(item.id, { state: 'error', error: reason });
      }
    }
    const done = queue.length - failures.length;
    const saved = `${formatBytes(before)} → ${formatBytes(after)} (${change(before, after)})`;
    const notes = [
      done === queue.length
        ? `Done. ${done} ${done === 1 ? 'image' : 'images'} · ${saved}.`
        : `Converted ${done} of ${queue.length}.`,
      ...failures,
    ];
    if (fallbacks.size) {
      const names = [...fallbacks].join(' or ');
      notes.push(`This browser can’t write ${names}, so those were saved as PNG.`);
    }
    if (kept) {
      const count = kept === 1 ? 'One image was' : `${kept} images were`;
      notes.push(
        `${count} already as small as it gets, so ${kept === 1 ? 'it’s' : 'they’re'} unchanged.`,
      );
    }
    if (larger) {
      const count = larger === 1 ? 'One file' : `${larger} files`;
      notes.push(`${count} came out larger than the original. Try WebP or a lower quality.`);
    }
    setBusy(false);
    setMessage(notes.join(' '));
  }

  function add(files: FileList | null) {
    if (!files?.length || busy) return;
    const accepted: File[] = [];
    const notImages: string[] = [];
    const tooBig: string[] = [];
    let skipped = 0;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/') && !READABLE.test(file.name)) notImages.push(file.name);
      else if (file.size > MAX_BYTES) tooBig.push(file.name);
      else if (items.length + accepted.length >= MAX_FILES) skipped += 1;
      else accepted.push(file);
    }
    const notes: string[] = [];
    let queue: Item[] | null = null;
    if (accepted.length) {
      const entries = accepted.map((file) => {
        const preview = URL.createObjectURL(file);
        urls.current.add(preview);
        return { id: nextId.current++, file, preview, state: 'ready' as const };
      });
      queue = [...items, ...entries];
      setItems(queue);
      notes.push(`Added ${accepted.length} ${accepted.length === 1 ? 'image' : 'images'}.`);
    }
    if (notImages.length) {
      const verb = notImages.length === 1 ? 'isn’t an image' : 'aren’t images';
      notes.push(`${list(notImages)} ${verb} this tool can read. Try JPG, PNG or WebP.`);
    }
    if (tooBig.length)
      notes.push(`${list(tooBig)} ${tooBig.length === 1 ? 'is' : 'are'} over 40 MB.`);
    if (skipped) notes.push(`${MAX_FILES} images at a time — ${skipped} skipped.`);
    setMessage(notes.join(' '));
    // Adding is the whole job: convert right away with the current settings.
    if (queue) void convertAll(queue);
  }

  // Images picked before the page finished loading never reached the change handler: take them now.
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

  function clear() {
    run.current += 1;
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    setItems([]);
    setBusy(false);
    setMessage('');
  }

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const stale = items.length > 0 && !busy && settings !== applied;
  const downloadAll = () =>
    finished.forEach((item, index) =>
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = item.result!.url;
        link.download = item.result!.name;
        document.body.append(link);
        link.click();
        link.remove();
      }, index * 250),
    );
  const working = items.findIndex((item) => item.state === 'working');
  const finished = items.filter((item) => item.result);
  const totalBefore = finished.reduce((sum, item) => sum + item.file.size, 0);
  const totalAfter = finished.reduce((sum, item) => sum + (item.result?.size ?? 0), 0);

  const saveResults = () =>
    startSaving(async () => {
      const response = await addFiles(slug, {
        folder: 'Made with Image Resize',
        files: finished.map((item) => ({
          name: item.result!.name,
          size: item.result!.size,
          kind: 'image',
          source: 'images',
        })),
      });
      toast(
        response.ok
          ? {
              title: `${finished.length} ${finished.length === 1 ? 'image' : 'images'} saved to Files`,
            }
          : { title: response.error, icon: 'alert' },
      );
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="grid content-start gap-5 rounded-[20px] bg-surface p-5 shadow-card">
        <div
          data-over={over || undefined}
          onDragEnter={(event) => {
            if (!hasFiles(event) || busy) return;
            event.preventDefault();
            setOver(true);
          }}
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            add(event.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-[18px] border-[1.5px] border-dashed px-4 py-8 text-center transition-colors',
            over ? 'border-signal bg-signal-soft' : 'border-line-strong bg-subtle',
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-tool-image text-ink shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]">
            <Icon name="image" size={22} />
          </span>
          <p className="text-[15px] font-semibold">
            {over ? 'Release to add' : 'Drop images here'}
          </p>
          <input
            ref={input}
            id={`${id}-files`}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(event) => {
              add(event.target.files);
              event.target.value = '';
            }}
          />
          <label
            htmlFor={`${id}-files`}
            className="inline-flex h-10 items-center rounded-[10px] bg-surface px-4 text-[14px] font-medium shadow-card hover:bg-subtle lg:h-9 lg:text-[13.5px]"
          >
            Choose images
          </label>
          <p className="text-[12.5px] text-muted">
            JPG, PNG, WebP, GIF or AVIF · up to 20 · 40 MB each
          </p>
        </div>

        <Field
          label="Max width"
          htmlFor={`${id}-width`}
          hint="Leave blank to keep the original size. Images are never enlarged."
        >
          <div className="relative">
            <Input
              id={`${id}-width`}
              type="number"
              inputMode="numeric"
              min={1}
              max={20000}
              step={1}
              placeholder="Original"
              value={maxWidth}
              onChange={(event) => setMaxWidth(event.target.value)}
              className="num pr-10"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-muted">
              px
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Width presets">
            {[...PRESETS.map(String), ''].map((width) => (
              <button
                key={width || 'original'}
                type="button"
                aria-pressed={maxWidth === width}
                onClick={() => setMaxWidth(width)}
                className={cn(
                  'h-9 rounded-full px-3 text-[13px] transition-colors lg:h-8',
                  maxWidth === width ? 'bg-ink text-white' : 'bg-well text-ink-2 hover:bg-ink/10',
                )}
              >
                {width || 'Original'}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Format" htmlFor={`${id}-format`}>
            <Select
              id={`${id}-format`}
              value={format}
              onChange={(event) => setFormat(event.target.value as Format)}
            >
              {FORMATS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          {format !== 'image/png' && (
            <Field
              label={
                <span className="flex w-full justify-between">
                  Quality{' '}
                  <span className="mono-num text-[11px] font-normal text-faint">{quality}</span>
                </span>
              }
              htmlFor={`${id}-quality`}
              hint={format === 'original' ? 'Used for JPEG and WebP files.' : undefined}
            >
              <input
                id={`${id}-quality`}
                type="range"
                min={40}
                max={100}
                step={1}
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value))}
                className="mt-3 w-full"
              />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {finished.length > 0 && !stale && !busy ? (
            <Button variant="primary" onClick={downloadAll}>
              <Icon name="download" size={16} />
              {finished.length === 1 ? 'Download' : `Download all ${finished.length}`}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy || items.length === 0}
              onClick={() => convertAll()}
            >
              {busy
                ? `Converting ${Math.max(working, 0) + 1} of ${items.length}…`
                : stale && finished.length
                  ? `Apply to ${items.length === 1 ? 'the image' : `all ${items.length}`}`
                  : 'Resize & convert'}
            </Button>
          )}
          {items.length > 0 && (
            <Button variant="ghost" onClick={clear}>
              Clear
            </Button>
          )}
        </div>
        <p role="status" className="min-h-5 text-[13px] text-muted">
          {message}
        </p>
      </div>

      <div className="rounded-[20px] bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          <h2 className="text-[14px] font-semibold">
            Images{' '}
            <span className="mono-num ml-1 text-[12px] font-normal text-faint">
              {items.length}/{MAX_FILES}
            </span>
          </h2>
          {finished.length > 0 && (
            <span className="rounded-full bg-positive-soft px-2.5 py-1 text-[12.5px] font-medium text-positive">
              {formatBytes(totalBefore)} → {formatBytes(totalAfter)} ·{' '}
              {change(totalBefore, totalAfter)}
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <ol className="grid gap-3 px-4 pt-2 pb-6 text-[14px] text-muted">
            {[
              'Add photos or screenshots — they shrink right away.',
              'Change the width or format if you like.',
              'Download lighter files, or save them to Files.',
            ].map((line, index) => (
              <li key={line} className="flex items-center gap-3 rounded-[12px] bg-subtle px-3 py-3">
                <span className="mono-num grid size-7 place-items-center rounded-full bg-tool-image/60 text-[11px] text-ink">
                  {index + 1}
                </span>
                {line}
              </li>
            ))}
          </ol>
        ) : (
          <ol className="row-divide pb-2">
            {items.map((item) => {
              const { result, source } = item;
              const larger = result && result.size > item.file.size;
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                  data-state={item.state}
                >
                  <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-well text-[10px] font-medium text-muted uppercase">
                    {result || item.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={result?.url ?? item.preview}
                        alt=""
                        decoding="async"
                        className={cn(
                          'size-full object-cover transition-opacity',
                          !result && 'opacity-60',
                        )}
                      />
                    ) : (
                      (/\.([a-z0-9]{1,4})$/i.exec(item.file.name)?.[1] ?? 'img')
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{item.file.name}</span>
                    <span className="block truncate text-[12.5px] text-muted">
                      {item.state === 'error' ? (
                        <span className="text-critical">{item.error}</span>
                      ) : result?.kept && source ? (
                        `${source.width}×${source.height} · ${formatBytes(item.file.size)} · already as small as it gets`
                      ) : result && source ? (
                        `${source.width}×${source.height} → ${result.width}×${result.height} · ${formatBytes(item.file.size)} → ${formatBytes(result.size)}`
                      ) : (
                        `${formatBytes(item.file.size)} · ${item.state === 'working' ? 'Working…' : busy ? 'Queued' : 'Ready'}`
                      )}
                    </span>
                  </span>
                  {result && !result.kept && (
                    <span
                      className={cn(
                        'mono-num text-[12px] font-medium',
                        larger ? 'text-caution' : 'text-positive',
                      )}
                    >
                      {change(item.file.size, result.size)}
                    </span>
                  )}
                  {result && (
                    <a
                      href={result.url}
                      download={result.name}
                      aria-label={`Download ${result.name}`}
                      className="grid size-9 place-items-center rounded-[9px] text-ink-2 hover:bg-ink/5"
                    >
                      <Icon name="download" size={17} />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => {
                      release(result?.url);
                      release(item.preview);
                      setItems((current) => current.filter((entry) => entry.id !== item.id));
                    }}
                    className="grid size-9 place-items-center rounded-[9px] text-muted hover:bg-ink/5"
                  >
                    <Icon name="x" size={16} />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {canSave && finished.length > 0 && !busy && (
          <div className="border-t border-line px-4 py-3">
            <Button onClick={saveResults} disabled={saving} className="w-full">
              <Icon name="files" size={16} />{' '}
              {saving ? 'Saving…' : `Save ${finished.length} to Files`}
            </Button>
          </div>
        )}
        <p className="px-4 pb-4 text-[12px] text-faint">
          Processed in your browser. Saved copies leave out camera and location data.
        </p>
      </div>
    </div>
  );
}
