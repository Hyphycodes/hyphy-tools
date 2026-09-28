'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { SaveProgress, useSaveToFiles } from '@/components/files/save-to-files';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { useOptionalWorkspace } from '@/components/shell/workspace-context';
import { AttachPicker } from './attach-picker';
import { ActionBar, ActionButton, Choices, MoreOptions, SampleButton, StartPanel } from './kit';
import { formatBytes } from '@/lib/platform/format';

/*
 * Image Resize, ported from Hyphy Studio (src/components/tools/image-tool.tsx). The conversion
 * pipeline and limits are unchanged. New here: images start converting the moment they're added
 * (1920 px wide by default), a file never comes back bigger than it went in, and results can be
 * saved to Files.
 */

const MAX_FILES = 20;
const MAX_BYTES = 40 * 1024 * 1024;
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
/**
 * Any image: on an iPhone this offers the photo library and the camera, and hands over HEIC photos
 * as JPEGs.
 */
const ACCEPT = 'image/*';

type Format = (typeof FORMATS)[number]['value'];
type Settings = { maxWidth: string; format: Format; quality: number };

type Goal = 'web' | 'email' | 'smallest' | 'full';
/** What the photos are for, instead of numbers. For the web is the default: sharp on any screen. */
const GOALS: (Settings & { id: Goal; label: string; hint: string; icon: IconName })[] = [
  {
    id: 'web',
    label: 'For the web',
    hint: 'sharp on any screen',
    icon: 'globe',
    maxWidth: '1920',
    format: 'original',
    quality: 80,
  },
  {
    id: 'email',
    label: 'For email',
    hint: 'light enough to attach',
    icon: 'mail',
    maxWidth: '1200',
    format: 'image/jpeg',
    quality: 75,
  },
  {
    id: 'smallest',
    label: 'Smallest file',
    hint: 'as light as it gets',
    icon: 'zoom-out',
    maxWidth: '800',
    format: 'image/webp',
    quality: 60,
  },
  {
    id: 'full',
    label: 'Full size',
    hint: 'every pixel, just lighter',
    icon: 'image',
    maxWidth: '',
    format: 'original',
    quality: 80,
  },
];

/** Before and after, drawn: what this tool does, at a glance. */
function BeforeAfter() {
  const photo = 'bg-[linear-gradient(180deg,#f6b77a,#f7d9a8_45%,#8a6a4f_46%,#3a3129)] shadow-lift';
  return (
    <div
      aria-hidden="true"
      className="flex items-end justify-center gap-4 rounded-[18px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-4 pt-5 pb-3"
    >
      <div className="w-[40%] max-w-[170px]">
        <span className={cn('block aspect-[4/3] rounded-[10px]', photo)} />
        <p className="mt-2 text-center text-[12px] text-muted">
          <span className="mono-num text-ink">4.8 MB</span>
        </p>
      </div>
      <Icon name="arrow-right" size={18} className="mb-10 text-[var(--accent)]" />
      <div className="w-[24%] max-w-[100px]">
        <span className={cn('block aspect-[4/3] rounded-[8px]', photo)} />
        <p className="mt-2 text-center text-[12px] text-muted">
          <span className="mono-num font-semibold text-ink">380 KB</span>
        </p>
      </div>
    </div>
  );
}
type Size = { width: number; height: number };
type Result = Size & {
  size: number;
  url: string;
  name: string;
  kept?: boolean;
  /** The image itself, so Save to Files stores exactly these bytes. */
  blob: Blob;
};
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

/** A phone-camera-sized photo drawn on this device, so the tool can be tried without one. */
async function samplePhoto(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 4032;
  canvas.height = 3024;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  const { width, height } = canvas;
  const sky = context.createLinearGradient(0, 0, 0, height * 0.7);
  sky.addColorStop(0, '#f6b77a');
  sky.addColorStop(0.55, '#f7d9a8');
  sky.addColorStop(1, '#e8e2cf');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#fff4d6';
  context.beginPath();
  context.arc(width * 0.68, height * 0.36, 260, 0, Math.PI * 2);
  context.fill();
  const hills: [string, number, number][] = [
    ['#b98f6a', 0.52, 180],
    ['#8a6a4f', 0.62, 140],
    ['#5b4a3a', 0.74, 110],
    ['#3a3129', 0.86, 90],
  ];
  // A seeded wobble, so the sample is the same every time.
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const [color, base, amplitude] of hills) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, height);
    for (let x = 0; x <= width; x += 96)
      context.lineTo(x, height * base + Math.sin(x / 380 + base * 9) * amplitude + random() * 40);
    context.lineTo(width, height);
    context.fill();
  }
  // Texture, so it compresses like a real photo rather than a flat drawing.
  for (let index = 0; index < 60000; index += 1) {
    context.fillStyle = `rgba(${random() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + random() * 0.06})`;
    context.fillRect(
      random() * width,
      height * 0.45 + random() * height * 0.55,
      6 + random() * 18,
      3,
    );
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.95),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('No sample');
  return new File([blob], 'Sample photo.jpg', { type: 'image/jpeg' });
}

/**
 * Runs anywhere. Inside a Space (`slug`, `canSave`) results can also be saved to Files; in the
 * public world it's the tool alone, and photos never leave the device.
 */
export function ImageTool({ slug = '', canSave = false }: { slug?: string; canSave?: boolean }) {
  const toast = useToast();
  const saver = useSaveToFiles(slug);
  const saving = saver.busy;
  const [projectId, setProjectId] = useState('');
  const [savedIds, setSavedIds] = useState<string | null>(null);
  const workspace = useOptionalWorkspace();
  const savable = canSave && workspace !== null;
  const id = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [maxWidth, setMaxWidth] = useState('1920');
  const [format, setFormat] = useState<Format>('original');
  const [quality, setQuality] = useState(80);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState('');
  const [applied, setApplied] = useState('');
  const settingsOf = (value: Settings) => `${value.maxWidth}|${value.format}|${value.quality}`;
  const settings = settingsOf({ maxWidth, format, quality });
  const goal = GOALS.find((option) => settingsOf(option) === settings)?.id ?? null;
  /** A goal applies at once: there's nothing else to press. */
  const pickGoal = (id: Goal) => {
    const next = GOALS.find((option) => option.id === id)!;
    setMaxWidth(next.maxWidth);
    setFormat(next.format);
    setQuality(next.quality);
    if (items.length && settingsOf(next) !== applied) void convertAll(items, next);
  };
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

  /** Converts the queue with the settings on screen, or with ones just chosen. */
  async function convertAll(queue: Item[] = items, use: Settings = { maxWidth, format, quality }) {
    setSavedIds(null);
    const token = ++run.current;
    setApplied(settingsOf(use));
    const parsed = Number.parseInt(use.maxWidth, 10);
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
      const type = outputType(use.format, item.file);
      try {
        const output = await convert(item.file, limit, type, use.quality);
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
            blob,
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

  async function trySample() {
    setMessage('Drawing a sample photo…');
    try {
      add([await samplePhoto()]);
    } catch {
      setMessage('We couldn’t draw a sample here. Choose one of your own images.');
    }
  }

  function add(files: FileList | File[] | null) {
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
    setSavedIds(null);
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
  const latest = finished[finished.length - 1];
  const totalBefore = finished.reduce((sum, item) => sum + item.file.size, 0);
  const totalAfter = finished.reduce((sum, item) => sum + (item.result?.size ?? 0), 0);

  const saveResults = async () => {
    const saved: string[] = [];
    for (const item of finished) {
      const result = item.result!;
      const file = await saver.save(result.blob, result.name, {
        purpose: 'photo',
        source: 'images',
        folder: 'Made with Image Resize',
        width: result.width,
        height: result.height,
        attachTo: projectId ? { type: 'project', id: projectId } : null,
      });
      if (!file) break;
      saved.push(file.fileId);
    }
    if (!saved.length) return;
    setSavedIds(saved[0]);
    toast({
      title: `${saved.length} ${saved.length === 1 ? 'image' : 'images'} saved to Files`,
      description:
        saved.length < finished.length
          ? `${finished.length - saved.length} didn’t save`
          : undefined,
      href: workspace?.href(saved.length === 1 ? `/files?file=${saved[0]}` : '/files?view=made'),
      action: 'Open',
    });
  };

  const input_ = (
    <input
      ref={input}
      id={`${id}-files`}
      type="file"
      accept={ACCEPT}
      multiple
      disabled={busy}
      className="sr-only"
      onChange={(event) => {
        add(event.target.files);
        event.target.value = '';
      }}
    />
  );
  const drop = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event) || busy) return;
      event.preventDefault();
      setOver(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setOver(false);
      add(event.dataTransfer.files);
    },
  };
  const goals = (
    <Choices
      label="Make them"
      scroll
      value={goal}
      onChange={pickGoal}
      options={GOALS.map((option) => ({
        value: option.id,
        label: option.label,
        icon: option.icon,
      }))}
    />
  );

  if (!items.length)
    return (
      <div style={{ '--resize': 'var(--accent, #ffc53d)' } as CSSProperties}>
        <div style={{ '--accent': 'var(--resize)' } as CSSProperties}>
          {input_}
          <StartPanel
            art={<BeforeAfter />}
            title="Make photos lighter"
            lead="Same picture, a fraction of the weight. They shrink the moment you add them."
            footer={`Up to ${MAX_FILES} at a time · photos never leave this device`}
          >
            {/* The whole area is the button: tap anywhere to choose, or drop photos on it. */}
            <label
              htmlFor={`${id}-files`}
              {...drop}
              className={cn(
                'flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[20px] border-[1.5px] border-dashed px-4 py-5 transition-colors',
                over
                  ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]'
                  : 'border-line-strong bg-subtle hover:bg-well/60',
              )}
            >
              <span className="inline-flex h-14 items-center gap-2 rounded-[16px] bg-[var(--accent)] px-7 text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent)]">
                <Icon name="image" size={19} />
                {over ? 'Drop to add' : 'Choose photos'}
              </span>
              <span className="hidden text-[13px] text-muted sm:block">or drop them here</span>
            </label>
            <SampleButton onClick={trySample} disabled={busy} className="mt-2">
              Try a sample photo
            </SampleButton>
            <div className="mt-4 grid gap-2.5 border-t border-line pt-5 text-left">
              <p className="text-[13.5px] font-medium text-ink-2">
                Make them{' '}
                <span className="font-normal text-muted">
                  · {GOALS.find((option) => option.id === goal)?.hint ?? 'your own settings'}
                </span>
              </p>
              {goals}
            </div>
            {message && (
              <p role="status" className="mt-3 text-[13px] text-muted">
                {message}
              </p>
            )}
          </StartPanel>
        </div>
      </div>
    );

  return (
    <div style={{ '--resize': 'var(--accent, #ffc53d)' } as CSSProperties}>
      <div
        style={{ '--accent': 'var(--resize)' } as CSSProperties}
        className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
      >
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 rounded-[20px] bg-surface p-4 shadow-card sm:p-5">
          {input_}
          <label
            htmlFor={`${id}-files`}
            {...drop}
            className={cn(
              'flex min-h-14 cursor-pointer items-center justify-center gap-2.5 rounded-[18px] border-[1.5px] border-dashed px-4 py-3 text-center transition-colors',
              over
                ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]'
                : 'border-line-strong bg-subtle hover:bg-well/60',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[#12110d]">
              <Icon name="plus" size={16} />
            </span>
            <span className="text-[15px] font-semibold">
              {over ? 'Drop to add' : 'Add more photos'}
            </span>
          </label>

          <div className="grid gap-2.5">
            <p className="text-[13.5px] font-medium text-ink-2">
              Make them{' '}
              <span className="font-normal text-muted">
                · {GOALS.find((option) => option.id === goal)?.hint ?? 'your own settings'}
              </span>
            </p>
            {goals}
          </div>

          <MoreOptions
            summary={`${maxWidth ? `${maxWidth} wide` : 'Full size'}${format !== 'original' ? ` · ${FORMATS.find((option) => option.value === format)?.label}` : ''}`}
          >
            <div className="grid gap-4">
              <Field
                label="Exact width"
                htmlFor={`${id}-width`}
                hint="Leave blank to keep the original size. Photos are never made bigger."
              >
                <div className="relative">
                  <Input
                    id={`${id}-width`}
                    type="number"
                    inputMode="numeric"
                    enterKeyHint="done"
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
              </Field>
              <div className="grid gap-2">
                <p className="text-[13px] font-medium text-ink-2">Save as</p>
                <Choices
                  label="Save as"
                  value={format}
                  onChange={setFormat}
                  options={FORMATS.map((option) => ({
                    value: option.value,
                    label: option.value === 'original' ? 'Same' : option.label,
                  }))}
                />
              </div>
              {format !== 'image/png' && (
                <Field
                  label={
                    <span className="flex w-full justify-between">
                      Quality{' '}
                      <span className="mono-num text-[11px] font-normal text-faint">{quality}</span>
                    </span>
                  }
                  htmlFor={`${id}-quality`}
                  hint="Lower makes lighter files."
                >
                  <input
                    id={`${id}-quality`}
                    type="range"
                    min={40}
                    max={100}
                    step={1}
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    className="mt-3 w-full accent-[var(--accent)]"
                  />
                </Field>
              )}
            </div>
          </MoreOptions>

          <ActionBar
            className={cn('!mt-0', workspace && '!static !mx-0 !bg-none !px-0 !pt-0 !pb-0')}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              {finished.length > 0 && !stale && !busy ? (
                <ActionButton icon="download" onClick={downloadAll}>
                  {finished.length === 1 ? 'Download' : `Download all ${finished.length}`}
                </ActionButton>
              ) : (
                <ActionButton
                  disabled={busy}
                  icon={busy ? 'loader' : 'refresh'}
                  onClick={() => convertAll()}
                  className={cn(busy && '[&>svg]:animate-spin')}
                >
                  {busy
                    ? `Shrinking ${Math.max(working, 0) + 1} of ${items.length}…`
                    : `Apply to ${items.length === 1 ? 'the photo' : `all ${items.length}`}`}
                </ActionButton>
              )}
              <ActionButton variant="quiet" onClick={clear} className="!w-auto">
                Clear
              </ActionButton>
            </div>
          </ActionBar>
          <p role="status" className={cn('text-[13px] text-muted', !message && 'sr-only')}>
            {message}
          </p>
        </div>

        <div className="min-w-0 rounded-[20px] bg-surface shadow-card">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <h2 className="text-[14px] font-semibold">
              Your photos{' '}
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
          <>
            {/* The latest result, large: the picture is the same, the weight isn't. */}
            {latest?.result && latest.source && (
              <figure className="relative mx-4 mt-1 mb-3 animate-rise overflow-hidden rounded-[14px] bg-well shadow-[inset_0_0_0_1px_var(--color-line)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={latest.result.url}
                  alt={latest.result.name}
                  className="block max-h-[260px] w-full object-cover"
                />
                <figcaption className="absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="rounded-full bg-black/55 px-2.5 py-1 text-white/70 backdrop-blur">
                    Before{' '}
                    <span className="mono-num text-white">
                      {latest.source.width}×{latest.source.height}
                    </span>{' '}
                    · {formatBytes(latest.file.size)}
                  </span>
                  <Icon name="arrow-right" size={14} className="text-white drop-shadow" />
                  <span className="rounded-full bg-ink px-2.5 py-1 text-on-ink/70">
                    After{' '}
                    <span className="mono-num text-on-ink">
                      {latest.result.width}×{latest.result.height}
                    </span>{' '}
                    · <span className="text-on-ink">{formatBytes(latest.result.size)}</span>
                  </span>
                </figcaption>
              </figure>
            )}
            <ol className="row-divide pb-2">
              {items.map((item) => {
                const { result, source } = item;
                const larger = result && result.size > item.file.size;
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 px-4 py-2.5 sm:gap-3"
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
                      <span className="block truncate text-[14px] font-medium">
                        {item.file.name}
                      </span>
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
                        className="grid size-11 shrink-0 place-items-center rounded-[9px] lg:size-9 text-ink-2 hover:bg-ink/5"
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
                      className="grid size-11 shrink-0 place-items-center rounded-[9px] lg:size-9 text-muted hover:bg-ink/5"
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
          {savable && finished.length > 0 && !busy && (
            <div className="grid gap-2 border-t border-line px-4 py-3">
              {savedIds !== null ? (
                <Link
                  href={workspace!.href(
                    finished.length === 1 ? `/files?file=${savedIds}` : '/files?view=made',
                  )}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-positive-soft text-[15px] font-medium text-positive lg:h-9 lg:text-[13.5px]"
                >
                  <Icon name="check" size={16} /> Saved to Files · Open
                </Link>
              ) : (
                <>
                  <AttachPicker value={projectId} onChange={setProjectId} className="!bg-subtle" />
                  <Button onClick={saveResults} disabled={saving} className="w-full">
                    <Icon name="files" size={16} />{' '}
                    {saving ? 'Saving…' : `Save ${finished.length} to Files`}
                  </Button>
                  <SaveProgress state={saver.state} className="text-center" />
                </>
              )}
            </div>
          )}
          <p className="px-4 pb-4 text-[12px] text-faint">
            Copies leave out where the photo was taken and camera details.
          </p>
        </div>
      </div>
    </div>
  );
}
