'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { formatBytes } from '@/lib/platform/format';
import { acceptFor, checkUpload, MAX_FILES_AT_ONCE, type UploadPurpose } from '@/lib/files/rules';
import {
  retryFile,
  uploadFile,
  UploadError,
  type Uploaded,
  type UploadOptions,
  type UploadStage,
} from '@/lib/files/upload';

/*
 * One uploader for every place that takes files: a queue where each file shows where it is —
 * waiting, checking, uploading n%, finishing, done — with Cancel while it's going and Try again
 * when it failed. Retrying reuses the same file record; nothing is uploaded twice.
 */

export type QueueItem = {
  key: string;
  file: File;
  stage: 'waiting' | UploadStage | 'done' | 'failed' | 'cancelled';
  progress: number;
  error?: string;
  /** Set when trying again can help: the record to retry. */
  retry?: { fileId?: string } | null;
  result?: Uploaded;
};

type Options = Omit<UploadOptions, 'onStage' | 'onProgress' | 'signal'>;

let counter = 0;

export function useUploadQueue(slug: string, options: Options) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const controllers = useRef(new Map<string, AbortController>());

  const update = useCallback(
    (key: string, patch: Partial<QueueItem>) =>
      setItems((current) =>
        current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
      ),
    [],
  );

  /** Adds files; ones Hyphy won't take are marked straight away, with the reason. */
  const add = useCallback((files: File[]) => {
    const incoming = files.slice(0, MAX_FILES_AT_ONCE).map((file): QueueItem => {
      const check = checkUpload(
        { name: file.name, size: file.size, mime: file.type },
        latest.current.purpose,
      );
      counter += 1;
      return {
        key: `u${counter}`,
        file,
        stage: check.ok ? 'waiting' : 'failed',
        progress: 0,
        error: check.ok ? undefined : check.problem,
        retry: null,
      };
    });
    setItems((current) =>
      [...current.filter((item) => item.stage !== 'cancelled'), ...incoming].slice(
        -MAX_FILES_AT_ONCE,
      ),
    );
    return incoming;
  }, []);

  const send = useCallback(
    async (item: QueueItem, again?: string): Promise<Uploaded | null> => {
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      update(item.key, { stage: 'checking', error: undefined, progress: 0 });
      const options: UploadOptions = {
        ...latest.current,
        signal: controller.signal,
        onStage: (stage) => update(item.key, { stage }),
        onProgress: (fraction) => update(item.key, { progress: fraction }),
      };
      try {
        const result = again
          ? await retryFile(slug, again, item.file, options)
          : await uploadFile(slug, item.file, options);
        update(item.key, { stage: 'done', progress: 1, result, retry: null });
        return result;
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          update(item.key, { stage: 'cancelled', retry: null });
          return null;
        }
        const failure =
          error instanceof UploadError
            ? error
            : new UploadError('The upload didn’t get through. Try again.', {});
        update(item.key, { stage: 'failed', error: failure.message, retry: failure.retry });
        return null;
      } finally {
        controllers.current.delete(item.key);
      }
    },
    [slug, update],
  );

  /** Uploads what's waiting, two at a time. Resolves with what finished. */
  const start = useCallback(
    async (only?: QueueItem[]) => {
      const queue = [...(only ?? items)].filter((item) => item.stage === 'waiting');
      const done: Uploaded[] = [];
      const worker = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const result = await send(item);
          if (result) done.push(result);
        }
      };
      await Promise.all([worker(), worker()]);
      return done;
    },
    [items, send],
  );

  const retry = useCallback(
    (key: string) => {
      const item = items.find((entry) => entry.key === key);
      if (item?.retry) return send(item, item.retry.fileId);
      return Promise.resolve(null);
    },
    [items, send],
  );

  const cancel = useCallback((key: string) => {
    const controller = controllers.current.get(key);
    if (controller) controller.abort();
    else setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const remove = useCallback(
    (key: string) => setItems((current) => current.filter((item) => item.key !== key)),
    [],
  );

  const reset = useCallback(() => setItems([]), []);

  const busy = items.some(
    (item) => !['waiting', 'done', 'failed', 'cancelled'].includes(item.stage),
  );
  return { items, add, start, retry, cancel, remove, reset, busy };
}

const stageText: Record<QueueItem['stage'], string> = {
  waiting: 'Ready to upload',
  checking: 'Checking…',
  preparing: 'Preparing…',
  uploading: 'Uploading',
  finishing: 'Finishing…',
  done: 'Uploaded',
  failed: 'Didn’t upload',
  cancelled: 'Cancelled',
};

/** The queue, one row per file. Progress is announced politely; problems assertively. */
export function UploadList({
  items,
  onCancel,
  onRetry,
  onRemove,
}: {
  items: QueueItem[];
  onCancel: (key: string) => void;
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul
      className="row-divide mt-3 rounded-[14px] bg-surface shadow-card"
      aria-label="Files to upload"
    >
      {items.map((item) => {
        const active = !['waiting', 'done', 'failed', 'cancelled'].includes(item.stage);
        const percent = Math.round(item.progress * 100);
        return (
          <li key={item.key} className="px-3 py-2.5" data-stage={item.stage}>
            <div className="flex items-center gap-3">
              <Icon
                name={
                  item.stage === 'done'
                    ? 'check-circle'
                    : item.stage === 'failed'
                      ? 'alert'
                      : item.file.type.startsWith('image/')
                        ? 'image'
                        : item.file.type === 'application/pdf'
                          ? 'pdf'
                          : 'file-text'
                }
                size={18}
                className={cn(
                  'shrink-0',
                  item.stage === 'done'
                    ? 'text-positive'
                    : item.stage === 'failed'
                      ? 'text-critical'
                      : 'text-muted',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-ink">{item.file.name}</p>
                <p
                  className={cn(
                    'text-[12px]',
                    item.stage === 'failed' ? 'text-critical' : 'text-muted',
                  )}
                  aria-live={item.stage === 'failed' ? 'assertive' : 'polite'}
                >
                  {item.stage === 'failed' && item.error
                    ? item.error
                    : item.stage === 'uploading'
                      ? `Uploading ${percent}%`
                      : stageText[item.stage]}
                  {' · '}
                  <span className="mono-num">{formatBytes(item.file.size)}</span>
                </p>
              </div>
              {active ? (
                <button
                  type="button"
                  onClick={() => onCancel(item.key)}
                  className="min-h-9 shrink-0 rounded-[9px] px-2.5 text-[13px] font-medium text-ink-2 hover:bg-ink/5"
                >
                  Cancel
                </button>
              ) : item.stage === 'failed' && item.retry ? (
                <button
                  type="button"
                  onClick={() => onRetry(item.key)}
                  className="min-h-9 shrink-0 rounded-[9px] px-2.5 text-[13px] font-medium text-signal-ink hover:bg-signal-soft"
                >
                  Try again
                </button>
              ) : item.stage !== 'done' ? (
                <button
                  type="button"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => onRemove(item.key)}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
                >
                  <Icon name="x" size={15} />
                </button>
              ) : null}
            </div>
            {active && (
              <div
                role="progressbar"
                aria-label={`Uploading ${item.file.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={item.stage === 'uploading' ? percent : undefined}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-well"
              >
                <span
                  className={cn(
                    'block h-full rounded-full bg-signal transition-[width] duration-200',
                    item.stage !== 'uploading' && 'animate-pulse',
                  )}
                  style={{
                    width: `${item.stage === 'uploading' ? Math.max(4, percent) : item.stage === 'finishing' ? 100 : 12}%`,
                  }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Drop files here, or tap to choose (on phones, `capture` offers the camera). A real button inside
 * a label, so keyboard and screen readers get a plain "Choose files".
 */
export function DropZone({
  purpose,
  onFiles,
  multiple = true,
  capture,
  icon = 'upload',
  title,
  hint,
  compact,
  describedBy,
}: {
  purpose: UploadPurpose;
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  capture?: boolean;
  icon?: IconName;
  title: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  return (
    <div>
      <input
        id={`${id}-input`}
        type="file"
        multiple={multiple}
        accept={acceptFor(purpose)}
        capture={capture ? 'environment' : undefined}
        className="peer sr-only"
        aria-describedby={describedBy ?? `${id}-hint`}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <label
        htmlFor={`${id}-input`}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragOver={(event) => hasFiles(event) && event.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          onFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-[18px] border-[1.5px] border-dashed text-center transition-colors',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal',
          compact ? 'px-4 py-5' : 'px-4 py-8',
          over ? 'border-signal bg-signal-soft' : 'border-line-strong bg-subtle hover:bg-well/60',
        )}
      >
        <span className="grid size-12 place-items-center rounded-full bg-ink text-white">
          <Icon name={icon} size={21} />
        </span>
        <span className="text-[15px] font-semibold text-ink">{over ? 'Drop to add' : title}</span>
        {hint && (
          <span id={`${id}-hint`} className="text-[13px] text-muted">
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}
