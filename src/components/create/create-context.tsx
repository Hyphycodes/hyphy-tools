'use client';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CreateActionId } from '@/lib/platform/actions';
import type { AttachmentRef, MileageEntry, Receipt } from '@/lib/platform/types';
import { useWorkspace } from '@/components/shell/workspace-context';
import { CreateSheets } from './create-sheets';

/** Opening a form on something that already exists: a returned item to fix and resend. */
export type EditTarget = (
  { kind: 'receipt'; record: Receipt } | { kind: 'mileage'; record: MileageEntry }
) & {
  /** The reviewer's note, shown at the top of the form while fixing. */
  reason?: string;
  reviewer?: string;
};

export type CreateRequest = {
  id: CreateActionId;
  attachTo?: AttachmentRef;
  preset?: Record<string, unknown>;
  edit?: EditTarget;
};

type CreateValue = {
  /** Start any registered action: opens its sheet, or goes to its tool. */
  start: (request: CreateActionId | CreateRequest) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
};

const CreateContext = createContext<CreateValue | null>(null);

export function useCreate() {
  const value = useContext(CreateContext);
  if (!value) throw new Error('useCreate needs the CreateProvider.');
  return value;
}

/** Universal Create's controller. Every entry point (+ button, dashboard, ⌘K) calls `start`. */
export function CreateProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const router = useRouter();
  const [active, setActive] = useState<CreateRequest | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const start = useCallback(
    (request: CreateActionId | CreateRequest) => {
      const normalized = typeof request === 'string' ? { id: request } : request;
      const action = workspace.actions.find((item) => item.id === normalized.id);
      setMenuOpen(false);
      if (!action) return;
      if (action.target.type === 'route') router.push(workspace.href(action.target.path));
      else setActive(normalized);
    },
    [workspace, router],
  );

  const value = useMemo(() => ({ start, menuOpen, setMenuOpen }), [start, menuOpen]);

  return (
    <CreateContext.Provider value={value}>
      {children}
      <CreateSheets request={active} onClose={() => setActive(null)} />
    </CreateContext.Provider>
  );
}
