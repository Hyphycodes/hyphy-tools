'use client';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { previewAs, resetDemo } from '@/lib/demo/actions';
import type { DemoModel } from '@/lib/demo/model';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { Sheet } from '@/components/ui/sheet';

/**
 * Demo Mode. A clearly-marked strip above the product that lets you become anyone in the demo
 * in one click. It talks only to `lib/demo/actions` and disappears when the identity source
 * isn't the demo one — the product underneath never knows it's there.
 */
export function DemoBar({ demo }: { demo: DemoModel }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = demo.people.find((entry) => entry.person.id === demo.personId);
  const perspective =
    current?.perspectives.find((item) => item.spaceSlug === demo.spaceSlug) ??
    current?.perspectives[0];

  return (
    <>
      <div
        className="relative z-40 bg-night text-white lg:sticky lg:top-0"
        role="region"
        aria-label="Demo Mode"
      >
        <div className="flex h-11 items-center gap-3 px-3 lg:h-10 lg:px-4">
          <span className="flex items-center gap-2">
            <span className="relative grid size-2 place-items-center">
              <span className="size-2 rounded-full bg-tool-receipt" />
            </span>
            <span className="label !text-white/85">Demo mode</span>
          </span>
          <span className="hidden h-4 w-px bg-white/15 sm:block" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-w-0 items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-[13px] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            {current && <Avatar person={current.person} size="xs" />}
            <span className="truncate">
              <span className="hidden text-white/50 sm:inline">Previewing as </span>
              <span className="font-medium text-white">{current?.person.name}</span>
              {perspective && (
                <span className="text-white/55">
                  {perspective.space.kind === 'personal' ? (
                    <> · Personal Space</>
                  ) : (
                    <>
                      {' '}
                      · {perspective.roleLabel}
                      <span className="hidden md:inline"> in {perspective.spaceName}</span>
                    </>
                  )}
                </span>
              )}
            </span>
            <Icon name="chevron-down" size={14} className="shrink-0 text-white/50" />
          </button>

          <div className="ml-auto hidden items-center gap-1 xl:flex" aria-label="Quick switch">
            <span className="mr-1.5 text-[12px] text-white/40">Quick switch</span>
            {demo.people.map((entry) => {
              const target = entry.perspectives[0];
              const active = entry.person.id === demo.personId;
              return (
                <form key={entry.person.id} action={previewAs}>
                  <input type="hidden" name="personId" value={entry.person.id} />
                  <input
                    type="hidden"
                    name="space"
                    value={active ? demo.spaceSlug : target.spaceSlug}
                  />
                  <button
                    type="submit"
                    title={`${entry.person.name} · ${target.roleLabel}, ${target.spaceName}`}
                    aria-label={`Preview as ${entry.person.name}`}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full p-[3px] transition-all',
                      active ? 'bg-white/90' : 'opacity-60 hover:opacity-100 hover:bg-white/15',
                    )}
                  >
                    <Avatar person={entry.person} size="xs" />
                  </button>
                </form>
              );
            })}
          </div>

          <div className={cn('flex items-center gap-1', 'ml-auto xl:ml-2')}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="hidden h-7 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-medium hover:bg-white/15 sm:flex"
            >
              <Icon name="eye" size={14} /> Switch
            </button>
            <form action={resetDemo}>
              <input type="hidden" name="back" value={pathname} />
              <button
                type="submit"
                title={
                  demo.changes ? `Undo your ${demo.changes} demo changes` : 'Demo data is fresh'
                }
                className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-white/60 hover:bg-white/10 hover:text-white"
              >
                <Icon name="refresh" size={13} />
                <span className="hidden sm:inline">Reset</span>
                {demo.changes > 0 && (
                  <span className="mono-num text-[10.5px] text-tool-receipt">{demo.changes}</span>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Preview as"
        description="No accounts in this preview. Pick a person and a Space to see exactly what they see."
        width="md"
      >
        <div className="grid gap-4 pt-1">
          {demo.people.map((entry) => (
            <section key={entry.person.id}>
              <div className="mb-1.5 flex items-center gap-2.5 px-1">
                <Avatar person={entry.person} size="md" />
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-ink">{entry.person.name}</p>
                  <p className="truncate text-[12.5px] text-muted">{entry.person.headline}</p>
                </div>
              </div>
              <div className="grid gap-1.5">
                {entry.perspectives.map((view) => {
                  const active =
                    entry.person.id === demo.personId && view.spaceSlug === demo.spaceSlug;
                  return (
                    <form key={view.id} action={previewAs}>
                      <input type="hidden" name="personId" value={entry.person.id} />
                      <input type="hidden" name="space" value={view.spaceSlug} />
                      <button
                        type="submit"
                        className={cn(
                          'flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-all',
                          active
                            ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                            : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-well/70',
                        )}
                      >
                        <SpaceMark space={view.space} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-medium text-ink">
                            {view.spaceName}
                            <span className="font-normal text-muted"> · {view.roleLabel}</span>
                          </span>
                          <span className="block truncate text-[12.5px] text-muted">
                            {view.note}
                          </span>
                        </span>
                        {active ? (
                          <span className="text-[12px] font-medium text-signal-ink">Viewing</span>
                        ) : (
                          <Icon name="arrow-right" size={16} className="text-faint" />
                        )}
                      </button>
                    </form>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="rounded-[12px] bg-subtle px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
            Demo Mode stands in for sign-in. Changes you make (receipts, trips, projects) stay in
            this browser until you press Reset. When real accounts arrive, this strip is removed and
            the same screens run on real identities.
          </p>
        </div>
      </Sheet>
    </>
  );
}
