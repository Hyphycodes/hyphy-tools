import 'server-only';
import { notFound } from 'next/navigation';
import { openPage } from '@/lib/page';
import type { RecordType } from '@/lib/platform/types';

/** Settings are for owners and admins (`space.manage`); everyone else uses what they decide. */
export async function openSettings(params: Promise<{ space: string }>) {
  const page = await openPage(params);
  if (!page.can('space.manage')) notFound();
  return page;
}

/** A business's setup pages: its fields, rules and words. A Personal Space has none of them. */
export async function openBusinessSettings(params: Promise<{ space: string }>) {
  const page = await openSettings(params);
  if (page.workspace.space.kind !== 'business') notFound();
  return page;
}

/** "Owners, admins and managers" — who approves here, in words. */
export function approversText(approvers: 'managers' | 'admins') {
  return approvers === 'admins' ? 'Owners and admins' : 'Owners, admins and managers';
}

/** A record type's fields (archived too) and which of them records already use. */
export async function fieldSetup(
  repo: Awaited<ReturnType<typeof openPage>>['repo'],
  type: RecordType,
) {
  const [fields, inUse] = await Promise.all([repo.fields(type), repo.fieldsInUse(type)]);
  return { fields, inUse: [...inUse] };
}
