'use client';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { qrMatrix, qrPath } from '@/lib/tools/qr';
import { CopyButton } from './kit';

const noop = () => () => {};

/** A scannable code for a link, drawn on the device: for sharing across a table. */
export function LinkQr({ url, className }: { url: string; className?: string }) {
  const path = useMemo(() => {
    try {
      const matrix = qrMatrix(url, 'L');
      return { d: qrPath(matrix, 2), size: matrix.length + 4 };
    } catch {
      return null;
    }
  }, [url]);
  if (!path) return null;
  return (
    <svg
      viewBox={`0 0 ${path.size} ${path.size}`}
      shapeRendering="crispEdges"
      className={cn('block h-auto w-full rounded-[10px] bg-white', className)}
      role="img"
      aria-label="QR code for this link"
    >
      <path d={path.d} fill="#12110d" />
    </svg>
  );
}

/**
 * Sharing a link-as-state: the link is the whole plan. Copy it, hand it to the phone's share
 * sheet, or show a code to scan. Says plainly what the link carries.
 */
export function ShareLinkCard({
  build,
  title,
  cta = 'Get the link',
  children,
  className,
}: {
  /** Makes the address with the current state inside it. */
  build: () => Promise<string>;
  title: string;
  cta?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const make = async () => {
    setBusy(true);
    try {
      const next = await build();
      setUrl(next);
      return next;
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const link = await make();
    if (navigator.share) {
      try {
        await navigator.share({ title, url: link });
      } catch {
        // Cancelled, or not allowed here: the copy button is right there.
      }
    }
  };

  const canShare = useSyncExternalStore(
    noop,
    () => 'share' in navigator,
    () => false,
  );

  return (
    <div className={cn('grid gap-3', className)}>
      {children}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={make}
          disabled={busy}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] bg-ink px-4 text-[15px] font-semibold text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-50 lg:h-10 lg:text-[14px]"
        >
          <Icon name="link" size={16} /> {url ? 'Update the link' : cta}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={share}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-well px-4 text-[15px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink lg:h-10 lg:text-[14px]"
          >
            <Icon name="share" size={16} /> Share
          </button>
        )}
      </div>
      {url && (
        <div className="grid animate-rise gap-2">
          <div className="flex min-w-0 items-center gap-2 rounded-[12px] bg-subtle p-1.5 pl-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <span className="mono-num min-w-0 flex-1 truncate text-[12.5px] text-muted">{url}</span>
            <CopyButton text={url} what="Link copied" variant="solid" />
          </div>
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted">
            <span>{url.length.toLocaleString()} characters · everything is inside the link</span>
            {url.length <= 1600 && (
              <button
                type="button"
                onClick={() => setShowQr((value) => !value)}
                className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink"
              >
                <Icon name="qr" size={14} /> {showQr ? 'Hide code' : 'Show a code'}
              </button>
            )}
          </div>
          {showQr && (
            <div className="mx-auto w-full max-w-[240px] animate-rise rounded-[16px] bg-white p-3">
              <LinkQr url={url} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
