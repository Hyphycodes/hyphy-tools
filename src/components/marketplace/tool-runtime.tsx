'use client';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { ToolId } from '@/lib/catalog';

/*
 * Each tool's interface, loaded on its own: a tool page ships only its own code. Every tool in
 * the registry has an entry here — `null` while it's Coming soon — so TypeScript asks for an
 * interface the moment a tool is added, and a tool marked Available without one fails the build.
 */

function Loading() {
  return (
    <div aria-busy="true" className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="skeleton h-[420px] !rounded-[22px]" />
      <div className="skeleton hidden h-[420px] !rounded-[22px] lg:block" />
    </div>
  );
}

const tool = (load: () => Promise<ComponentType>) => dynamic(load, { loading: Loading });

const runtimes: Record<ToolId, ComponentType | null> = {
  split: tool(() => import('@/components/tools/split-tool').then((m) => m.SplitTool)),
  when: tool(() => import('@/components/tools/when-tool').then((m) => m.WhenTool)),
  bring: tool(() => import('@/components/tools/bring-tool').then((m) => m.BringTool)),
  where: tool(() => import('@/components/tools/where-tool').then((m) => m.WhereTool)),
  plan: tool(() => import('@/components/tools/plan-tool').then((m) => m.PlanTool)),
  qr: tool(() => import('@/components/tools/qr-studio').then((m) => m.QrStudio)),
  'signal-pages': tool(() =>
    import('@/components/tools/signal-pages-tool').then((m) => m.SignalPagesTool),
  ),
  'signal-links': tool(() =>
    import('@/components/tools/signal-links-tool').then((m) => m.SignalLinksTool),
  ),
  pdf: tool(() => import('@/components/tools/pdf-tool').then((m) => m.PdfTool)),
  convert: tool(() => import('@/components/tools/convert-tool').then((m) => m.ConvertTool)),
  clean: tool(() => import('@/components/tools/clean-tool').then((m) => m.CleanTool)),
  duplicates: tool(() =>
    import('@/components/tools/duplicates-tool').then((m) => m.DuplicatesTool),
  ),
  resize: tool(() => import('@/components/tools/image-tool').then((m) => m.ImageTool)),
  'social-crop': tool(() =>
    import('@/components/tools/social-crop-tool').then((m) => m.SocialCropTool),
  ),
  palette: tool(() => import('@/components/tools/palette-tool').then((m) => m.PaletteTool)),
  subscriptions: tool(() =>
    import('@/components/tools/subscriptions-tool').then((m) => m.SubscriptionsTool),
  ),
  receipts: null,
  mileage: null,
  wishlist: tool(() => import('@/components/tools/wishlist-tool').then((m) => m.WishlistTool)),
  'secret-santa': tool(() => import('@/components/tools/santa-tool').then((m) => m.SantaTool)),
};

export function ToolRuntime({ id }: { id: ToolId }) {
  const Runtime = runtimes[id];
  if (!Runtime) throw new Error(`“${id}” is open in the registry but has no interface.`);
  return <Runtime />;
}
