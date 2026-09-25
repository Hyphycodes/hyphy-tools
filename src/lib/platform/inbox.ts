import type { IconName } from '@/components/ui/icon';
import type { InboxItem } from './types';

/**
 * How an inbox item looks and where it's grouped, shared by the Inbox, the dashboards and ⌘K.
 * Approvals take the color of what's being approved (a receipt's lime, a trip's sky).
 */
export type InboxGroup = 'To fix' | 'Approvals' | 'Documents' | 'People' | 'Mentions';

export const inboxGroups: InboxGroup[] = ['To fix', 'Approvals', 'Documents', 'People', 'Mentions'];

export type InboxLook = { icon: IconName; bg: string; fg: string; group: InboxGroup };

const tool = {
  receipt: { icon: 'receipt', bg: 'var(--color-tool-receipt)', fg: '#16150F' },
  mileage: { icon: 'route', bg: 'var(--color-tool-miles)', fg: '#16150F' },
} as const;

export function inboxLook(item: Pick<InboxItem, 'kind' | 'submission'>): InboxLook {
  const kind = item.submission?.kind ?? 'receipt';
  switch (item.kind) {
    case 'approval':
      return item.submission?.flags.includes('unassigned')
        ? {
            icon: tool[kind].icon,
            bg: 'var(--color-caution-soft)',
            fg: 'var(--color-caution)',
            group: 'Approvals',
          }
        : { ...tool[kind], group: 'Approvals' };
    case 'returned':
      return {
        icon: 'arrow-left',
        bg: 'var(--color-critical-soft)',
        fg: 'var(--color-critical)',
        group: 'To fix',
      };
    case 'incomplete':
      return { ...tool[kind], group: 'To fix' };
    case 'document-uploaded':
      return {
        icon: 'file-text',
        bg: 'var(--color-tool-files)',
        fg: '#16150F',
        group: 'Documents',
      };
    case 'document-expiring':
      return {
        icon: 'clock',
        bg: 'var(--color-caution-soft)',
        fg: 'var(--color-caution)',
        group: 'Documents',
      };
    case 'access-request':
      return {
        icon: 'user-plus',
        bg: 'var(--color-signal-soft)',
        fg: 'var(--color-signal-ink)',
        group: 'People',
      };
    case 'mention':
      return {
        icon: 'message',
        bg: 'var(--color-well)',
        fg: 'var(--color-ink-2)',
        group: 'Mentions',
      };
  }
}

/** Approvals are decided, returns are fixed or set aside; everything else is simply cleared. */
export const isDecision = (item: Pick<InboxItem, 'kind' | 'submission' | 'status'>) =>
  item.kind === 'approval' && item.submission?.status === 'submitted' && item.status === 'open';
