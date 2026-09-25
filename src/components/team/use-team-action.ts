'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { ActionResult } from '@/app/(app)/[space]/actions';
import { useToast } from '@/components/ui/toast';

/**
 * Runs a team action: one at a time, says how it went, refreshes what's on screen (or moves on to
 * where the action says), and hands a successful result back for anything else to do.
 */
export function useTeamAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (
    work: () => Promise<ActionResult>,
    then?: (result: ActionResult & { ok: true }) => void,
  ) =>
    start(async () => {
      const result = await work();
      if (!result.ok) {
        toast({ title: result.error, icon: 'alert' });
        return;
      }
      if (result.message) toast({ title: result.message });
      then?.(result);
      if (result.href) router.push(result.href);
      else router.refresh();
    });
  return { pending, run };
}
