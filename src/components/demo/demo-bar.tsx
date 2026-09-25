'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { previewAs, resetDemo } from '@/lib/demo/actions';
import type { DemoModel } from '@/lib/demo/model';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';
import { SpaceMark } from '@/components/ui/marks';
import { Sheet } from '@/components/ui/sheet';

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}

/**
 * Demo Mode. A small, clearly-marked dock that stays out of the product's way: a card in the
 * sidebar's footer on desktop (the sidebar makes room for it), a thin line above the top bar on
 * phones. It opens Preview As (become
 * anyone, in any of their Spaces) and resets the demo. It talks only to `lib/demo/actions` and
 * disappears when the identity source isn't the demo one — the product never knows it's there.
 */
export function DemoBar({ demo }: { demo: DemoModel }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = demo.people.find((entry) => entry.person.id === demo.personId);
  const perspective =
    current?.perspectives.find((item) => item.spaceSlug === demo.spaceSlug) ??
    current?.perspectives[0];
  const role = perspective?.space.kind === 'personal' ? 'Personal' : perspective?.roleLabel;

  // Shift+D opens Preview As from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'D' || !event.shiftKey || event.metaKey || event.ctrlKey) return;
      if (isTyping(event.target)) return;
      if (!open && document.querySelector('dialog[open]')) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const reset = (className: string, label?: boolean) => (
    <form action={resetDemo}>
      <input type="hidden" name="back" value={pathname} />
      <button
        type="submit"
        title={demo.changes ? `Undo your ${demo.changes} demo changes` : 'Demo data is fresh'}
        aria-label={`Reset demo${demo.changes ? ` (${demo.changes} changes)` : ''}`}
        className={className}
      >
        <Icon name="refresh" size={13} />
        {label && <span>Reset</span>}
        {demo.changes > 0 && (
          <span className="mono-num text-[10.5px] text-tool-receipt">{demo.changes}</span>
        )}
      </button>
    </form>
  );

  return (
    <>
      <div role="region" aria-label="Demo Mode" data-demo-dock>
        {/* Phones: one thin line that scrolls away with the page. */}
        <div className="flex h-8 items-center gap-2 bg-night px-3 text-white lg:hidden">
          <span className="size-1.5 rounded-full bg-tool-receipt" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Preview as someone else — now ${current?.person.name}, ${role}`}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12.5px] text-white/60"
          >
            <span className="label !text-[9.5px] !text-white/70">Demo</span>
            <span className="truncate">
              <span className="font-medium text-white/90">{current?.person.firstName}</span> ·{' '}
              {role}
            </span>
            <Icon name="chevron-down" size={13} className="shrink-0 text-white/45" />
          </button>
          {reset(
            'flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-white/55 active:bg-white/10',
          )}
        </div>

        {/* Desktop: a small card in the sidebar's footer, clear of the page. */}
        <div className="fixed bottom-3 left-3 z-40 hidden w-[228px] animate-rise items-center gap-0.5 rounded-[14px] bg-night p-1 text-white shadow-lift lg:flex">
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="Preview as someone else (Shift+D)"
            aria-label={`Preview as someone else — now ${current?.person.name}, ${role}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] py-1 pr-1.5 pl-1 text-left text-[12.5px] transition-colors hover:bg-white/10"
          >
            {current && <Avatar person={current.person} size="sm" />}
            <span className="flex min-w-0 flex-1 flex-col leading-[1.2]">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-white">{current?.person.name}</span>
              </span>
              <span className="truncate text-[11px] text-white/50">
                {role}
                {perspective && perspective.space.kind !== 'personal' && (
                  <> · {perspective.spaceName}</>
                )}
              </span>
            </span>
            <Icon name="chevrons" size={13} className="shrink-0 text-white/40" />
          </button>
          {reset(
            'flex h-9 items-center gap-1 rounded-[10px] px-2 text-[12px] text-white/55 transition-colors hover:bg-white/10 hover:text-white',
          )}
          <span
            className="absolute -top-2 left-3 flex items-center gap-1 rounded-full bg-tool-receipt px-1.5 py-px font-mono text-[8.5px] font-semibold tracking-[0.08em] text-ink uppercase"
            aria-hidden="true"
          >
            Demo
          </span>
        </div>
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Preview as"
        description="Pick a person and a Space to see exactly what they see."
        width="md"
        footer={
          <>
            <span className="mr-auto hidden items-center gap-1.5 text-[12px] text-faint lg:flex">
              <Kbd>⇧</Kbd>
              <Kbd>D</Kbd> opens this anywhere
            </span>
            {reset(
              'inline-flex h-11 items-center gap-2 rounded-[11px] px-4 text-[14px] font-medium text-ink shadow-card hover:bg-subtle lg:h-9 lg:text-[13.5px]',
              true,
            )}
          </>
        }
      >
        <div className="grid gap-1 pt-1">
          {demo.people.map((entry) => {
            const here = entry.person.id === demo.personId;
            return (
              <section
                key={entry.person.id}
                className={cn(
                  'rounded-[16px] p-2.5 transition-colors',
                  here && 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
                )}
              >
                <div className="flex items-center gap-2.5 px-0.5">
                  <Avatar person={entry.person} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold text-ink">{entry.person.name}</p>
                    <p className="truncate text-[12.5px] text-muted">{entry.person.headline}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-[42px]">
                  {entry.perspectives.map((view) => {
                    const active = here && view.spaceSlug === demo.spaceSlug;
                    return (
                      <form key={view.id} action={previewAs}>
                        <input type="hidden" name="personId" value={entry.person.id} />
                        <input type="hidden" name="space" value={view.spaceSlug} />
                        <button
                          type="submit"
                          title={view.note}
                          aria-current={active ? 'true' : undefined}
                          aria-label={`Preview as ${entry.person.name}, ${view.roleLabel} in ${view.spaceName}`}
                          className={cn(
                            'flex h-9 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-[13px] transition-all lg:h-8',
                            active
                              ? 'bg-signal-soft text-signal-ink shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                              : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-ink hover:shadow-[inset_0_0_0_1px_rgb(22_21_15/.3)]',
                          )}
                        >
                          <SpaceMark space={view.space} size="sm" />
                          <span className="font-medium">
                            {view.space.kind === 'personal' ? 'Personal' : view.spaceName}
                          </span>
                          {view.space.kind !== 'personal' && (
                            <span className={active ? 'text-signal-ink/70' : 'text-muted'}>
                              {view.roleLabel}
                            </span>
                          )}
                        </button>
                      </form>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <p className="mt-3 rounded-[12px] bg-subtle px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
            Demo Mode stands in for sign-in. What you change (receipts, trips, projects) stays in
            this browser until you reset, so you can submit as Mike and approve as Dana.
          </p>
        </div>
      </Sheet>
    </>
  );
}
