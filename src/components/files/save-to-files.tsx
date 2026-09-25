'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { cn } from '@/components/ui/cn';
import {
  uploadFile,
  UploadError,
  type Uploaded,
  type UploadOptions,
  type UploadStage,
} from '@/lib/files/upload';

/*
 * "Save to Files" for a tool's result: the real bytes the tool made, through the same upload
 * pipeline as everything else. Nothing is stored until the person saves — previewing a PDF, an
 * image or a QR code makes no file.
 */

export type SaveState = {
  stage: UploadStage | 'idle' | 'done' | 'failed';
  progress: number;
  error?: string;
};

export function useSaveToFiles(slug: string) {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ stage: 'idle', progress: 0 });
  const save = useCallback(
    async (
      blob: Blob,
      name: string,
      options: Omit<UploadOptions, 'onStage' | 'onProgress' | 'signal'>,
    ): Promise<Uploaded | null> => {
      setState({ stage: 'checking', progress: 0 });
      try {
        const file = new File([blob], name, { type: blob.type });
        const saved = await uploadFile(slug, file, {
          ...options,
          onStage: (stage) => setState((current) => ({ ...current, stage })),
          onProgress: (progress) => setState((current) => ({ ...current, progress })),
        });
        setState({ stage: 'done', progress: 1 });
        router.refresh();
        return saved;
      } catch (error) {
        setState({
          stage: 'failed',
          progress: 0,
          error: error instanceof UploadError ? error.message : 'Saving didn’t work. Try again.',
        });
        return null;
      }
    },
    [slug, router],
  );
  const reset = useCallback(() => setState({ stage: 'idle', progress: 0 }), []);
  const busy = !['idle', 'done', 'failed'].includes(state.stage);
  return { save, state, reset, busy };
}

/** What a save is doing, in a line — with the upload's real progress. */
export function SaveProgress({ state, className }: { state: SaveState; className?: string }) {
  if (state.stage === 'idle' || state.stage === 'done') return null;
  const percent = Math.round(state.progress * 100);
  return (
    <p
      className={cn(
        'text-[12.5px]',
        state.stage === 'failed' ? 'text-critical' : 'text-muted',
        className,
      )}
      role={state.stage === 'failed' ? 'alert' : 'status'}
    >
      {state.stage === 'failed'
        ? state.error
        : state.stage === 'uploading'
          ? `Saving… ${percent}%`
          : state.stage === 'finishing'
            ? 'Finishing…'
            : 'Preparing…'}
    </p>
  );
}
