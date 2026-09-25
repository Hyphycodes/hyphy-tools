'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { setBusinessLogo } from '@/app/(app)/[space]/file-actions';
import { useWorkspace } from '@/components/shell/workspace-context';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { useToast } from '@/components/ui/toast';
import { acceptFor } from '@/lib/files/rules';
import { uploadFile, UploadError } from '@/lib/files/upload';

/**
 * The business logo: a PNG, JPG or WebP under 2 MB, stored with the business's other files (never
 * in a public bucket) and shown wherever its mark is — the Space switcher, the sidebar, the
 * header. Replacing it stores a new file and removes the old one; Remove goes back to initials.
 */
export function LogoForm() {
  const workspace = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const { space } = workspace;
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();

  async function choose(file: File) {
    setError('');
    setBusy(true);
    try {
      const saved = await uploadFile(space.slug, file, {
        purpose: 'logo',
        onStage: (stage) =>
          setStatus(
            stage === 'uploading'
              ? 'Uploading…'
              : stage === 'finishing'
                ? 'Finishing…'
                : 'Preparing…',
          ),
        onProgress: (progress) => setStatus(`Uploading ${Math.round(progress * 100)}%…`),
      });
      setStatus('Saving…');
      const result = await setBusinessLogo(space.slug, saved.fileId);
      if (!result.ok) throw new UploadError(result.error, null);
      toast({ title: 'Logo updated', description: 'It’s on your mark everywhere in Hyphy.' });
      router.refresh();
    } catch (problem) {
      setError(
        problem instanceof UploadError ? problem.message : 'The logo didn’t upload. Try again.',
      );
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <SpaceMark space={space} size="xl" />
      <div className="grid min-w-0 flex-1 gap-2">
        <p className="text-[13.5px] text-ink-2">
          {space.logo
            ? 'Your logo shows on your mark in the Space switcher and sidebar.'
            : 'Without a logo, your mark uses your initials in your accent color.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`${id}-logo`}
            type="file"
            accept={acceptFor('logo')}
            className="peer sr-only"
            aria-describedby={`${id}-hint ${id}-error`}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void choose(file);
              event.target.value = '';
            }}
          />
          <label
            htmlFor={`${id}-logo`}
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-[11px] bg-surface px-4 text-[15px] font-medium text-ink shadow-card peer-focus-visible:outline-2 peer-focus-visible:outline-signal hover:bg-subtle lg:h-9 lg:text-[13.5px]"
          >
            <Icon name="upload" size={16} />
            {busy ? status || 'Uploading…' : space.logo ? 'Replace logo' : 'Upload logo'}
          </label>
          {space.logo && !busy && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await setBusinessLogo(space.slug, null);
                  if (!result.ok) setError(result.error);
                  else {
                    toast({ title: 'Logo removed' });
                    router.refresh();
                  }
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
        <p id={`${id}-hint`} className="text-[12px] text-faint">
          PNG, JPG or WebP, up to 2 MB. A square image works best.
          {workspace.fileStorage === 'device' && ' In the preview it’s kept in this browser.'}
        </p>
        <p id={`${id}-error`} role="alert" className="text-[13px] text-critical empty:hidden">
          {error}
        </p>
      </div>
    </div>
  );
}
