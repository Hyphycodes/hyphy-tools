'use client';
import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import type { FileView } from '@/lib/files/access';
import type { FileRecord } from '@/lib/platform/types';
import { FileButtons, FilePicture } from './file-media';

/**
 * A receipt's own photo (or PDF), right on the receipt: an approver checks it without downloading
 * anything. Tap to see it full size; Open and Download are underneath.
 */
export function ReceiptPhoto({ file, view }: { file: FileRecord; view: FileView | undefined }) {
  const [large, setLarge] = useState(false);
  const image = file.kind === 'image';
  return (
    <figure className="grid gap-3" aria-label="Receipt photo">
      {image ? (
        <button
          type="button"
          onClick={() => setLarge((value) => !value)}
          aria-expanded={large}
          aria-label={large ? 'Show the photo smaller' : 'Show the photo full size'}
          className={cn(
            'group relative block w-full overflow-hidden rounded-[16px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
            large ? 'max-h-none' : 'max-h-[340px]',
          )}
        >
          <FilePicture
            file={file}
            view={view}
            fit="contain"
            iconSize={32}
            className={cn('w-full', large ? 'h-auto min-h-48' : 'h-[340px]')}
          />
          <span className="absolute right-2.5 bottom-2.5 flex items-center gap-1 rounded-full bg-ink/70 px-2.5 py-1 text-[12px] font-medium text-white opacity-90 group-hover:opacity-100">
            <Icon name={large ? 'minus' : 'plus'} size={13} /> {large ? 'Smaller' : 'Full size'}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-[16px] bg-subtle p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <FilePicture file={file} view={view} className="size-12 rounded-[12px]" iconSize={22} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-ink">{file.name}</p>
            <p className="text-[12.5px] text-muted">The receipt, as a PDF</p>
          </div>
        </div>
      )}
      <FileButtons file={file} view={view} size="sm" />
    </figure>
  );
}
