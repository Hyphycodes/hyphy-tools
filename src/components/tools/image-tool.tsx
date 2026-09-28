'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { SaveProgress, useSaveToFiles } from '@/components/files/save-to-files';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { useOptionalWorkspace } from '@/components/shell/workspace-context';
import { download } from '@/lib/files/download';
import { zip } from '@/lib/files/zip';
import { formatBytes } from '@/lib/platform/format';
import {
  extrapolate,
  HEADER_BYTES,
  percentSmaller,
  sampleTiles,
  targetSize,
  type Size,
} from '@/lib/tools/resize';
import { AttachPicker } from './attach-picker';
import { NextSteps } from './next-step';
import {
  ActionBar,
  Advanced,
  BeforeAfter,
  Choices,
  CountUp,
  PillButton,
  PresetCards,
  SampleButton,
} from './kit';

/*
 * Resize & Compress, ported from Hyphy Studio (src/components/tools/image-tool.tsx). The photo is
 * the object: it goes in through a photo frame, comes back large, and the choice is an outcome
 * (Web, Email, Smallest, Full size), each with a real estimate from a quick trial encode of the
 * photo itself. Images convert the moment they're added (Web: 1920 px wide), a file never comes
 * back bigger than it went in, and inside a Space results can be saved to Files. Pixels, format,
 * quality and metadata wait under Advanced.
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
/** What the photos are for, instead of numbers. Web is the default: sharp on any screen. */
const GOALS: (Settings & { id: Goal; label: string; hint: string; icon: IconName })[] = [
  {
    id: 'web',
    label: 'Web',
    hint: 'Sharp online, loads much faster',
    icon: 'globe',
    maxWidth: '1920',
    format: 'original',
    quality: 80,
  },
  {
    id: 'email',
    label: 'Email',
    hint: 'Easy to send',
    icon: 'mail',
    maxWidth: '1200',
    format: 'image/jpeg',
    quality: 75,
  },
  {
    id: 'smallest',
    label: 'Smallest',
    hint: 'Save maximum space',
    icon: 'zoom-out',
    maxWidth: '800',
    format: 'image/webp',
    quality: 60,
  },
  {
    id: 'full',
    label: 'Full size',
    hint: 'Keep original dimensions',
    icon: 'maximize',
    maxWidth: '',
    format: 'original',
    quality: 80,
  },
];

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
  /** Each outcome's size: a trial-encode estimate, then the real thing once it's been made. */
  estimates?: Partial<Record<Goal, number>>;
  actual?: Partial<Record<Goal, number>>;
};

const settingsOf = (value: Settings) => `${value.maxWidth}|${value.format}|${value.quality}`;
const widthOf = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
};

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

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality / 100));

/**
 * What each outcome would weigh, from a few tiles of this very photo encoded at the output's
 * scale: a few milliseconds, and far closer than a rule of thumb.
 */
async function estimateGoals(bitmap: ImageBitmap, file: File) {
  const source = { width: bitmap.width, height: bitmap.height };
  const canvas = document.createElement('canvas');
  const estimates: Partial<Record<Goal, number>> = {};
  try {
    for (const goal of GOALS) {
      const type = outputType(goal.format, file);
      const target = targetSize(source, widthOf(goal.maxWidth));
      const samples: { bytes: number; pixels: number }[] = [];
      for (const tile of sampleTiles(source, target)) {
        canvas.width = tile.width;
        canvas.height = tile.height;
        const context = canvas.getContext('2d');
        if (!context) return estimates;
        if (type === 'image/jpeg') {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, tile.width, tile.height);
        }
        context.imageSmoothingQuality = 'high';
        context.drawImage(
          bitmap,
          tile.sx,
          tile.sy,
          tile.sw,
          tile.sh,
          0,
          0,
          tile.width,
          tile.height,
        );
        const blob = await encode(canvas, type, goal.quality);
        if (!blob) return estimates;
        samples.push({ bytes: blob.size, pixels: tile.width * tile.height });
      }
      let bytes = extrapolate(samples, target, HEADER_BYTES[type] ?? 0);
      // Same size and format never comes back heavier: the original is handed back instead.
      if (target.width === source.width && type === file.type) bytes = Math.min(bytes, file.size);
      estimates[goal.id] = bytes;
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  return estimates;
}

async function convert(
  file: File,
  maxWidth: number | null,
  type: string,
  quality: number,
  estimate: boolean,
) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(readError(file.name));
  }
  const source = { width: bitmap.width, height: bitmap.height };
  const estimates = estimate ? await estimateGoals(bitmap, file).catch(() => undefined) : undefined;
  const { width, height } = targetSize(source, maxWidth);
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
  const blob = context ? await encode(canvas, type, quality) : null;
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) {
    throw new Error(
      `Couldn’t save ${file.name}. It may be too large for this browser. ` +
        'Try a smaller max width.',
    );
  }
  return { source, width, height, blob, estimates };
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

/** Files dragged anywhere over the page: lights the photo up, and a drop anywhere counts. */
function usePageDrop(onFiles: (files: FileList) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onFiles);
  useEffect(() => {
    latest.current = onFiles;
  });
  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const carries = (event: globalThis.DragEvent) =>
      Boolean(event.dataTransfer?.types.includes('Files'));
    const enter = (event: globalThis.DragEvent) => {
      if (!carries(event)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (event: globalThis.DragEvent) => {
      if (carries(event)) event.preventDefault();
    };
    const drop = (event: globalThis.DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      latest.current(event.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [enabled]);
  return enabled && dragging;
}

/** A landscape, barely there: the photo that isn't here yet. */
function GhostPhoto({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 250"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      className={cn('absolute inset-0 size-full', className)}
    >
      <circle cx="286" cy="82" r="30" fill="var(--glow, #ff8b73)" opacity="0.22" />
      <path
        d="M0 160 Q60 128 120 150 T240 138 T400 146 V250 H0Z"
        fill="var(--accent, #ffc53d)"
        opacity="0.18"
      />
      <path
        d="M0 196 Q80 170 170 190 T330 180 T400 186 V250 H0Z"
        fill="var(--accent-ink, #946300)"
        opacity="0.1"
      />
    </svg>
  );
}

/** Corner marks, like a mat's opening or a viewfinder. */
function Corners({ className }: { className?: string }) {
  const arm = 'absolute size-6 border-[var(--accent-ink,var(--color-ink))] sm:size-7';
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-3 sm:inset-4', className)}
    >
      <span
        className={cn(arm, 'top-0 left-0 rounded-tl-[6px] border-t-[2.5px] border-l-[2.5px]')}
      />
      <span
        className={cn(arm, 'top-0 right-0 rounded-tr-[6px] border-t-[2.5px] border-r-[2.5px]')}
      />
      <span
        className={cn(arm, 'bottom-0 left-0 rounded-bl-[6px] border-b-[2.5px] border-l-[2.5px]')}
      />
      <span
        className={cn(arm, 'right-0 bottom-0 rounded-br-[6px] border-r-[2.5px] border-b-[2.5px]')}
      />
    </span>
  );
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [maxWidth, setMaxWidth] = useState('1920');
  const [format, setFormat] = useState<Format>('original');
  const [quality, setQuality] = useState(80);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState('');
  const [applied, setApplied] = useState('');
  const settings = settingsOf({ maxWidth, format, quality });
  const goal = GOALS.find((option) => settingsOf(option) === settings)?.id ?? null;
  const appliedGoal = GOALS.find((option) => settingsOf(option) === applied)?.id ?? null;
  /** A goal applies at once: there's nothing else to press. */
  const pickGoal = (pick: Goal) => {
    const next = GOALS.find((option) => option.id === pick)!;
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
  const patch = (itemId: number, changes: (item: Item) => Partial<Item>) =>
    setItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...changes(item) } : item)),
    );

  /**
   * Converts the queue with the settings on screen, or with ones just chosen. The last result
   * stays on screen until its replacement is ready, so the numbers move rather than blink.
   */
  async function convertAll(queue: Item[] = items, use: Settings = { maxWidth, format, quality }) {
    setSavedIds(null);
    const token = ++run.current;
    const key = settingsOf(use);
    setApplied(key);
    const usedGoal = GOALS.find((option) => settingsOf(option) === key)?.id;
    const limit = widthOf(use.maxWidth);
    setItems((current) => current.map((item) => ({ ...item, state: 'ready', error: undefined })));
    setBusy(true);
    const failures: string[] = [];
    const fallbacks = new Set<string>();
    let before = 0;
    let after = 0;
    let larger = 0;
    let kept = 0;
    for (const [index, item] of queue.entries()) {
      setMessage('');
      setSummary(`Working on ${index + 1} of ${queue.length}: ${item.file.name}`);
      patch(item.id, () => ({ state: 'working' }));
      const type = outputType(use.format, item.file);
      try {
        const output = await convert(item.file, limit, type, use.quality, !item.estimates);
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
        patch(item.id, (now) => {
          if (now.result && now.result.url !== now.preview && now.result.url !== url)
            release(now.result.url);
          return {
            state: 'done',
            source: output.source,
            estimates: now.estimates ?? output.estimates,
            actual: usedGoal ? { ...now.actual, [usedGoal]: blob.size } : now.actual,
            result: {
              width: output.width,
              height: output.height,
              size: blob.size,
              url,
              name: keep ? item.file.name : `${base}-${output.width}w.${extension}`,
              kept: keep,
              blob,
            },
          };
        });
      } catch (error) {
        if (run.current !== token) return;
        const reason = error instanceof Error ? error.message : readError(item.file.name);
        failures.push(reason);
        patch(item.id, (now) => {
          if (now.result && now.result.url !== now.preview) release(now.result.url);
          return { state: 'error', error: reason, result: undefined };
        });
      }
    }
    const done = queue.length - failures.length;
    const notes = [...failures];
    if (done < queue.length) notes.unshift(`Converted ${done} of ${queue.length}.`);
    if (fallbacks.size) {
      const names = [...fallbacks].join(' or ');
      notes.push(`This browser can’t write ${names}, so those were saved as PNG.`);
    }
    if (kept && kept < done) {
      const count = kept === 1 ? 'One image was' : `${kept} images were`;
      notes.push(
        `${count} already as small as it gets, so ${kept === 1 ? 'it’s' : 'they’re'} unchanged.`,
      );
    }
    if (larger) {
      const count = larger === 1 ? 'One file' : `${larger} files`;
      notes.push(`${count} came out larger than the original. Try Smallest.`);
    }
    setBusy(false);
    setMessage(notes.join(' '));
    setSummary(
      done
        ? `Done. ${done} ${done === 1 ? 'image' : 'images'} · ${formatBytes(before)} → ${formatBytes(after)}.`
        : '',
    );
  }

  // Technical settings apply by themselves, a moment after the last change.
  const apply = useRef(convertAll);
  useEffect(() => {
    apply.current = convertAll;
  });
  const stale = items.length > 0 && !busy && settings !== applied;
  useEffect(() => {
    if (!stale) return;
    const timer = setTimeout(() => void apply.current(), 550);
    return () => clearTimeout(timer);
  }, [stale, settings]);

  async function trySample() {
    setSummary('Drawing a sample photo…');
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
      setSelectedId(entries[0].id);
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

  const dragging = usePageDrop(add, !busy);

  function clear() {
    run.current += 1;
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    setItems([]);
    setSelectedId(null);
    setBusy(false);
    setMessage('');
    setSummary('');
    setSavedIds(null);
    setApplied('');
  }

  function remove(item: Item) {
    if (item.result?.url !== item.preview) release(item.result?.url);
    release(item.preview);
    const rest = items.filter((entry) => entry.id !== item.id);
    if (!rest.length) return clear();
    setItems(rest);
    if (selectedId === item.id) setSelectedId(rest[rest.length - 1].id);
  }

  const finished = items.filter((item) => item.result);
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
  const downloadZip = async () => {
    try {
      const archive = await zip(
        finished.map((item) => ({ name: item.result!.name, data: item.result!.blob })),
      );
      download(archive, `lighter-photos-${finished.length}.zip`);
    } catch {
      toast({ title: 'Couldn’t make the zip. Download them one by one instead.', icon: 'alert' });
    }
  };
  const working = items.findIndex((item) => item.state === 'working');
  const selected =
    items.find((item) => item.id === selectedId) ?? finished[finished.length - 1] ?? items[0];
  const totalBefore = finished.reduce((sum, item) => sum + item.file.size, 0);
  const totalAfter = finished.reduce((sum, item) => sum + (item.result?.size ?? 0), 0);
  const smaller = percentSmaller(totalBefore, totalAfter);
  const allKept = finished.length > 0 && finished.every((item) => item.result?.kept);

  /** Each outcome's total: made sizes where they exist, estimates for the rest. */
  const outcome = (pick: Goal) => {
    let bytes = 0;
    let exact = true;
    for (const item of items) {
      if (item.state === 'error') continue;
      const made = item.actual?.[pick];
      const guess = item.estimates?.[pick];
      if (made !== undefined) bytes += made;
      else if (guess !== undefined) {
        bytes += guess;
        exact = false;
      } else return null;
    }
    return { bytes, exact };
  };
  const everything = items
    .filter((item) => item.state !== 'error')
    .reduce((sum, item) => sum + item.file.size, 0);

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
  const status = (
    <>
      <p role="status" className="sr-only">
        {summary}
      </p>
      {message && <p className="text-[13px] leading-snug text-muted">{message}</p>}
    </>
  );
  const world = (children: ReactNode, className?: string) => (
    <div style={{ '--resize': 'var(--accent, #ffc53d)' } as CSSProperties}>
      <div style={{ '--accent': 'var(--resize)' } as CSSProperties} className={className}>
        {input_}
        {children}
      </div>
    </div>
  );

  /* ---------------- the way in: a photo frame ---------------- */

  if (!items.length)
    return world(
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
        <div
          className={cn(
            'fx-move group relative w-full rounded-[30px] bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0/.05),0_28px_60px_-34px_rgb(60_40_0/.45),inset_0_0_0_1px_var(--color-line)] sm:p-4',
            dragging
              ? 'scale-[1.015] -rotate-[.4deg] shadow-[0_0_0_6px_color-mix(in_srgb,var(--accent)_40%,transparent),0_30px_60px_-30px_rgb(60_40_0/.45)]'
              : 'hover:-translate-y-0.5',
          )}
        >
          <label
            htmlFor={`${id}-files`}
            aria-hidden="true"
            className="absolute inset-0 z-10 cursor-pointer rounded-[30px]"
          />
          <div className="relative flex aspect-[4/5] flex-col items-center justify-center overflow-hidden rounded-[20px] bg-[color-mix(in_oklab,var(--color-surface)_55%,var(--accent)_16%)] px-5 text-center min-[420px]:aspect-[4/3] sm:aspect-[16/10]">
            <GhostPhoto className={cn('fx-move', dragging && 'scale-105')} />
            <Corners />
            <span
              aria-hidden="true"
              className="relative grid size-16 place-items-center rounded-[20px] bg-surface text-[var(--accent-ink,var(--color-ink))] shadow-[0_10px_24px_-14px_rgb(60_40_0/.5)] sm:size-[72px]"
            >
              <Icon name={dragging ? 'download' : 'image'} size={30} />
            </span>
            <p className="relative mt-4 font-display text-[30px] leading-[1] font-bold tracking-[-0.035em] text-ink sm:text-[40px]">
              {dragging ? (
                'Let go to add'
              ) : (
                <>
                  <span className="sm:hidden">Shrink a photo</span>
                  <span className="hidden sm:inline">Drop a photo</span>
                </>
              )}
            </p>
            <label
              htmlFor={`${id}-files`}
              className="relative z-20 mt-5 inline-flex h-14 cursor-pointer items-center gap-2 rounded-full px-7 text-[16.5px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-14px_var(--accent)] transition-transform active:scale-[.97]"
              style={{ background: 'var(--accent)' }}
            >
              <Icon name="camera" size={19} />
              Choose photos
            </label>
            <p className="relative mt-4 inline-flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <BeforeAfter before="4.8 MB" after="380 KB" className="text-[13px]" />
            </p>
          </div>
        </div>
        <SampleButton
          onClick={trySample}
          disabled={busy}
          className="mt-3 !text-[var(--accent-ink,var(--color-ink))]"
        >
          Try a sample photo
        </SampleButton>
        <div className="mt-1 max-w-[520px] text-center">{status}</div>
      </div>,
    );

  /* ---------------- the photo, large, and what it becomes ---------------- */

  const result = selected?.result;
  const source = selected?.source;
  const shownUrl = result?.url ?? selected?.preview;
  const ready = finished.length > 0;
  const current = GOALS.find((option) => option.id === appliedGoal);
  const onlyOne = items.length === 1;

  return world(
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
      {/* The photo: a print on a lit table, with the next ones in a strip under it. */}
      <section
        aria-label="Your photos"
        className={cn(
          'fx-move relative min-w-0 rounded-[30px] bg-[color-mix(in_oklab,var(--color-surface)_60%,var(--accent)_12%)] p-3 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-6',
          dragging && 'shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_55%,transparent)]',
        )}
      >
        {selected && (
          <figure className="grid justify-items-center gap-3">
            <div className="relative max-w-full rounded-[6px] bg-white p-1.5 shadow-[0_2px_4px_rgb(0_0_0/.06),0_24px_44px_-26px_rgb(60_40_0/.55)] sm:p-2.5">
              {shownUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={shownUrl}
                  src={shownUrl}
                  alt={result?.name ?? selected.file.name}
                  decoding="async"
                  className="fx-pop block max-h-[min(38vh,420px)] w-auto max-w-full rounded-[2px] object-contain sm:max-h-[min(56vh,540px)]"
                />
              ) : (
                <span className="grid aspect-[4/3] w-[min(72vw,480px)] place-items-center text-[13px] text-muted">
                  {selected.file.name}
                </span>
              )}
              {selected.state === 'working' && (
                <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[12.5px] font-medium text-white backdrop-blur">
                  <Icon name="loader" size={13} className="animate-spin" /> Shrinking…
                </span>
              )}
              {result && !result.kept && (
                <span className="fx-pop absolute top-4 right-4 rounded-full bg-black/60 px-3 py-1 text-[13px] font-semibold text-white backdrop-blur mono-num">
                  {percentSmaller(selected.file.size, result.size) >= 0
                    ? `−${percentSmaller(selected.file.size, result.size)}%`
                    : `+${-percentSmaller(selected.file.size, result.size)}%`}
                </span>
              )}
            </div>
            <figcaption className="flex max-w-full min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
              {selected.state === 'error' ? (
                <span className="text-critical">{selected.error}</span>
              ) : source && result ? (
                <>
                  <span>
                    Before{' '}
                    <span className="mono-num text-ink-2">
                      {source.width}×{source.height}
                    </span>
                  </span>
                  <span className="mono-num">{formatBytes(selected.file.size)}</span>
                  <Icon name="arrow-right" size={13} className="text-faint" />
                  <span className="font-medium text-ink">
                    After{' '}
                    <span className="mono-num">
                      {result.width}×{result.height}
                    </span>
                  </span>
                  <span className="mono-num font-medium text-ink">
                    {result.kept ? 'already as small as it gets' : formatBytes(result.size)}
                  </span>
                </>
              ) : (
                <span className="truncate">{selected.file.name}</span>
              )}
            </figcaption>
          </figure>
        )}

        <div className="mt-4 flex min-w-0 items-center gap-2">
          {!onlyOne && (
            <ul
              aria-label="All photos"
              className="scroller -my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 pl-0.5"
            >
              {items.map((item, index) => {
                const on = item.id === selected?.id;
                return (
                  <li
                    key={item.id}
                    className="fx-rise shrink-0"
                    style={{ '--i': index } as CSSProperties}
                  >
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`Show ${item.file.name}`}
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        'fx-move relative block size-14 overflow-hidden rounded-[10px] bg-surface p-0.5 active:scale-95',
                        on
                          ? 'shadow-[0_0_0_2.5px_var(--accent-ink,var(--color-ink))]'
                          : 'opacity-80 shadow-[0_0_0_1px_var(--color-line)] hover:opacity-100',
                      )}
                    >
                      {item.result?.url || item.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.result?.url ?? item.preview}
                          alt=""
                          decoding="async"
                          className={cn(
                            'size-full rounded-[8px] object-cover',
                            item.state === 'working' && 'animate-pulse',
                          )}
                        />
                      ) : null}
                      {item.state === 'error' && (
                        <span className="absolute inset-0 grid place-items-center bg-critical/70 text-white">
                          <Icon name="alert" size={16} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div
            className={cn('flex shrink-0 items-center gap-1', onlyOne && 'w-full justify-center')}
          >
            <label
              htmlFor={`${id}-files`}
              className={cn(
                'inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full bg-surface px-4 text-[14px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:text-ink',
                busy && 'pointer-events-none opacity-50',
              )}
            >
              <Icon name="plus" size={16} />
              {onlyOne ? 'Add more photos' : <span className="sr-only sm:not-sr-only">Add</span>}
            </label>
            {selected && (
              <>
                {selected.result && (
                  <a
                    href={selected.result.url}
                    download={selected.result.name}
                    aria-label={`Download ${selected.result.name}`}
                    title="Download this one"
                    className={cn(
                      'grid size-11 place-items-center rounded-full text-ink-2 hover:bg-ink/[.06] hover:text-ink',
                      onlyOne && 'hidden',
                    )}
                  >
                    <Icon name="download" size={17} />
                  </a>
                )}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${selected.file.name}`}
                  title="Remove"
                  onClick={() => remove(selected)}
                  className="grid size-11 place-items-center rounded-full text-muted hover:bg-ink/[.06] hover:text-ink disabled:opacity-40"
                >
                  <Icon name={onlyOne ? 'restore' : 'x'} size={17} />
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* What it becomes: the number, the outcome, the download. */}
      <section
        aria-label="Result"
        className="flex min-w-0 flex-col gap-5 rounded-[30px] bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/.04),0_24px_50px_-32px_rgb(60_40_0/.4)] sm:p-7"
      >
        <div className="text-center lg:text-left">
          <p className="text-[13px] font-semibold tracking-[.02em] text-muted">
            {current ? current.label : 'Your settings'}
            {!onlyOne &&
              ready &&
              ` · ${finished.length} ${finished.length === 1 ? 'photo' : 'photos'}`}
            {onlyOne && result && (
              <span className="mono-num font-normal">
                {' '}
                · {result.width} × {result.height}
              </span>
            )}
          </p>
          <p
            className={cn(
              'mt-2 font-display text-[64px] leading-[.9] font-extrabold tracking-[-0.045em] text-ink sm:text-[84px]',
              busy && 'opacity-60',
            )}
            style={{ fontVariationSettings: "'wdth' 112" }}
          >
            {ready ? (
              <CountUp
                value={totalAfter}
                from={totalBefore}
                format={formatBytes}
                duration={900}
                mono={false}
              />
            ) : (
              <span className="text-faint">{formatBytes(everything)}</span>
            )}
          </p>
          <p
            key={ready ? `${smaller}-${allKept}` : 'wait'}
            className="fx-pop mt-3 text-[19px] font-semibold text-[var(--accent-ink,var(--color-ink-2))] sm:text-[21px]"
          >
            {!ready
              ? 'Shrinking…'
              : allKept
                ? 'Already as small as it gets'
                : smaller >= 0
                  ? `${smaller}% smaller`
                  : `${-smaller}% larger`}
          </p>
          {ready && !allKept && (
            <BeforeAfter
              before={formatBytes(totalBefore)}
              after={formatBytes(totalAfter)}
              className="mt-2 text-[14px]"
            />
          )}
        </div>

        <ActionBar
          className={cn(
            'order-last !mt-0 sm:order-none',
            workspace && '!static !mx-0 !bg-none !px-0 !pt-0 !pb-0',
          )}
        >
          <div className="flex gap-2">
            {ready && !busy && onlyOne && result ? (
              <a
                href={result.url}
                download={result.name}
                className="fx-pop inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-[17px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_16px_34px_-16px_var(--accent)] transition-transform active:scale-[.97]"
                style={{ background: 'var(--accent)' }}
              >
                <Icon name="download" size={19} /> Download
              </a>
            ) : (
              <button
                type="button"
                disabled={busy || !ready}
                onClick={downloadAll}
                className={cn(
                  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-[17px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_16px_34px_-16px_var(--accent)] transition-[transform,opacity] active:scale-[.97] disabled:opacity-60 disabled:shadow-none',
                  busy && '[&>svg]:animate-spin',
                )}
                style={{ background: 'var(--accent)' }}
              >
                <Icon name={busy ? 'loader' : 'download'} size={19} />
                {busy
                  ? `Shrinking ${Math.max(working, 0) + 1} of ${items.length}…`
                  : `Download all ${finished.length}`}
              </button>
            )}
            {finished.length > 1 && !busy && (
              <PillButton
                icon="archive"
                onClick={downloadZip}
                className="h-14 shrink-0 max-sm:px-4"
              >
                <span className="sm:hidden">Zip</span>
                <span className="hidden sm:inline">As a zip</span>
              </PillButton>
            )}
          </div>
        </ActionBar>

        {/* One photo, done: it can go straight on to be framed or sampled, no second upload. */}
        {!workspace && ready && !busy && onlyOne && result && (
          <NextSteps
            from="resize"
            steps={[
              {
                tool: 'social-crop',
                label: 'Make social sizes',
                file: new File([result.blob], result.name, { type: result.blob.type }),
              },
              {
                tool: 'palette',
                label: 'Pull its colors',
                file: new File([result.blob], result.name, { type: result.blob.type }),
              },
            ]}
          />
        )}

        <div className="grid gap-2.5">
          <p className="text-[13.5px] font-semibold text-ink-2">Made for</p>
          <PresetCards
            label="Made for"
            value={goal}
            onChange={pickGoal}
            className="sm:!grid-cols-2"
            options={GOALS.map((option, index) => {
              const size = outcome(option.id);
              return {
                value: option.id,
                label: option.label,
                icon: option.icon,
                recommended: index === 0,
                result: size ? (
                  <span className="grid gap-1">
                    <span className="mono-num text-[12px] font-medium tracking-normal text-muted">
                      {formatBytes(everything)} →
                    </span>
                    <span>
                      {size.exact ? '' : '~'}
                      {formatBytes(size.bytes)}
                    </span>
                  </span>
                ) : (
                  <span className="text-faint">…</span>
                ),
                hint: option.hint,
              };
            })}
          />
        </div>

        <Advanced
          summary={`${maxWidth ? `${maxWidth} px` : 'Full size'} · ${format === 'original' ? 'Same format' : FORMATS.find((option) => option.value === format)?.label}${format !== 'image/png' ? ` · ${quality}%` : ''}`}
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
                    <span className="mono-num text-[11px] font-normal text-faint">{quality}%</span>
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
                  className="mt-3 w-full accent-[var(--accent-ink,var(--color-ink))]"
                />
              </Field>
            )}
            <p className="flex items-start gap-2 text-[12.5px] text-muted">
              <Icon name="map-pin" size={14} className="mt-0.5 shrink-0" />
              Location and camera details are always left out of the copies.
            </p>
            {!onlyOne && (
              <ol className="grid gap-1 border-t border-line pt-3 text-[12.5px] text-muted">
                {items.map((item) => (
                  <li key={item.id} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-ink-2">{item.file.name}</span>
                    <span className="mono-num shrink-0">
                      {item.state === 'error'
                        ? 'couldn’t read'
                        : item.result && item.source
                          ? `${item.source.width}×${item.source.height} → ${item.result.width}×${item.result.height} · ${formatBytes(item.file.size)} → ${formatBytes(item.result.size)}`
                          : item.state === 'working'
                            ? 'Working…'
                            : 'Queued'}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Advanced>

        {savable && ready && !busy && (
          <div className="grid gap-2 border-t border-line pt-4">
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
        {status}
      </section>
    </div>,
  );
}
