'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icon';

/*
 * "Add": more files or a whole folder, from a small menu, without leaving the work. Used by Clean
 * and Duplicates once files are in.
 */

/** Add files or a folder to the batch, without leaving the list. */
export function AddMore({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled: boolean;
}) {
  const id = useId();
  const folder = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // A tap anywhere else (or Escape) closes the menu.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const take = (list: FileList | null) => {
    setOpen(false);
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  };
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex h-11 items-center gap-1.5 rounded-full bg-ink/[.06] px-3.5 text-[14px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink disabled:opacity-45 lg:h-10 lg:text-[13.5px]"
      >
        <Icon name="plus" size={15} /> Add
      </button>
      {open && (
        <div className="fx-pop absolute top-full right-0 z-30 mt-1.5 grid w-44 gap-1 rounded-[16px] bg-surface p-1.5 shadow-lift">
          <label
            htmlFor={`${id}-files`}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[11px] px-3 text-[14px] font-medium text-ink hover:bg-ink/[.06]"
          >
            <Icon name="files" size={16} /> Files
          </label>
          <button
            type="button"
            onClick={() => folder.current?.click()}
            className="flex min-h-11 items-center gap-2 rounded-[11px] px-3 text-left text-[14px] font-medium text-ink hover:bg-ink/[.06]"
          >
            <Icon name="folder-open" size={16} /> A folder
          </button>
        </div>
      )}
      <input
        id={`${id}-files`}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={folder}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        {...({ webkitdirectory: '' } as Record<string, string>)}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
