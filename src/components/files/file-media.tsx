'use client';
import { useEffect, useState } from 'react';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import type { FileView } from '@/lib/files/access';
import { getDeviceFile } from '@/lib/files/device';
import type { FileKind, FileRecord } from '@/lib/platform/types';

/*
 * A file's picture and its Open / Download, wherever its bytes are: Hyphy's storage (links the
 * server signed moments ago, or app routes that sign at click time), this browser in Demo Mode,
 * or nowhere (a sample record from the preview's world, which keeps details only).
 */

/** An object URL for a Demo Mode file this browser holds, or null. Revoked when unused. */
export function useDeviceUrl(fileId: string, enabled: boolean) {
  const [state, setState] = useState<{ url: string | null; checked: boolean }>({
    url: null,
    checked: !enabled,
  });
  useEffect(() => {
    if (!enabled) return;
    let url: string | null = null;
    let live = true;
    getDeviceFile(fileId).then((stored) => {
      if (!live) return;
      url = stored ? URL.createObjectURL(stored.blob) : null;
      setState({ url, checked: true });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, enabled]);
  return state;
}

const tint: Record<
  FileKind,
  { bg: string; fg: string; icon: 'pdf' | 'image' | 'archive' | 'file-text' }
> = {
  pdf: { bg: '#FFE4DA', fg: '#B8401C', icon: 'pdf' },
  image: { bg: '#FFF1CC', fg: '#8A5A00', icon: 'image' },
  archive: { bg: '#ECE6FF', fg: '#5B3FC4', icon: 'archive' },
  sheet: { bg: '#DDF5EA', fg: '#13784A', icon: 'file-text' },
  doc: { bg: '#E6EAF2', fg: '#3B4A63', icon: 'file-text' },
};

/**
 * The image itself when there is one to show (a stored photo, a Demo Mode photo in this browser),
 * otherwise the file's kind. Fills its box; the caller sizes it.
 */
export function FilePicture({
  file,
  view,
  className,
  iconSize = 18,
  fit = 'cover',
}: {
  file: Pick<FileRecord, 'id' | 'kind' | 'name' | 'preview'>;
  view?: FileView;
  className?: string;
  iconSize?: number;
  fit?: 'cover' | 'contain';
}) {
  const device = useDeviceUrl(file.id, view?.state === 'device' && file.kind === 'image');
  const [broken, setBroken] = useState(false);
  const src = view?.state === 'stored' ? view.preview : device.url;
  if (file.kind === 'image' && src && !broken)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className={cn(
          'block bg-subtle',
          fit === 'cover' ? 'object-cover' : 'object-contain',
          className,
        )}
      />
    );
  if (file.kind === 'image' && file.preview && view?.state === 'sample')
    return (
      <span
        aria-hidden="true"
        className={cn('block', className)}
        style={{ background: file.preview }}
      />
    );
  const look = tint[file.kind];
  return (
    <span
      aria-hidden="true"
      className={cn('grid place-items-center', className)}
      style={{ background: look.bg, color: look.fg }}
    >
      <Icon name={look.icon} size={iconSize} />
    </span>
  );
}

/** Where a file that can't be opened here is, in words. */
export function unavailableReason(view: FileView | undefined) {
  switch (view?.state) {
    case 'sample':
      return 'A sample from the preview: Hyphy keeps its details, not a file.';
    case 'elsewhere':
      return 'This file’s copy isn’t reachable from here.';
    default:
      return undefined;
  }
}

async function openFromDevice(file: Pick<FileRecord, 'id' | 'name'>, download: boolean) {
  // Opened now, filled in a moment: browsers only allow new tabs straight from a click.
  const tab = download ? null : window.open('', '_blank');
  const stored = await getDeviceFile(file.id);
  if (!stored) {
    tab?.close();
    return false;
  }
  const url = URL.createObjectURL(stored.blob);
  if (tab) tab.location.href = url;
  else {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/**
 * Open and Download. Stored files go through the app's routes (access checked at the click, a
 * one-minute link); Demo Mode files come out of this browser; anything else says why not.
 */
export function FileButtons({
  file,
  view,
  className,
  size = 'md',
}: {
  file: Pick<FileRecord, 'id' | 'name' | 'kind'>;
  view: FileView | undefined;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [missing, setMissing] = useState(false);
  const device = view?.state === 'device';
  const stored = view?.state === 'stored';
  const reason = unavailableReason(view);
  const openable = view?.inline ?? false;
  const run = (download: boolean) =>
    openFromDevice(file, download).then((found) => setMissing(!found));
  return (
    <div className={cn('grid gap-2', className)}>
      <div className="flex gap-2">
        {stored ? (
          <>
            <a
              href={view.download}
              className={buttonClass({ variant: 'primary', size, className: 'flex-1' })}
            >
              <Icon name="download" size={16} /> Download
            </a>
            {openable && (
              <a
                href={view.open}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: 'secondary', size, className: 'flex-1' })}
              >
                <Icon name="external" size={16} /> Open
              </a>
            )}
          </>
        ) : device ? (
          <>
            <button
              type="button"
              onClick={() => run(true)}
              className={buttonClass({ variant: 'primary', size, className: 'flex-1' })}
            >
              <Icon name="download" size={16} /> Download
            </button>
            {openable && (
              <button
                type="button"
                onClick={() => run(false)}
                className={buttonClass({ variant: 'secondary', size, className: 'flex-1' })}
              >
                <Icon name="external" size={16} /> Open
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            disabled
            className={buttonClass({ variant: 'primary', size, className: 'flex-1' })}
          >
            <Icon name="download" size={16} /> Download
          </button>
        )}
      </div>
      {(reason || device || missing) && (
        <p className="text-[12px] leading-snug text-faint" role={missing ? 'alert' : undefined}>
          {missing
            ? 'This preview’s copy of the file is in the browser that added it, not this one.'
            : device
              ? 'Preview: this file is kept in this browser until you reset the demo.'
              : reason}
        </p>
      )}
    </div>
  );
}
