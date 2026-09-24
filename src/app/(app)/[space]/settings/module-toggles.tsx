'use client';
import { useOptimistic, useTransition } from 'react';
import { setModules } from '@/app/(app)/[space]/actions';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import { useToast } from '@/components/ui/toast';
import type { ModuleId } from '@/lib/platform/types';

export type ToggleRow = {
  module: ModuleId;
  name: string;
  tagline: string;
  color: string;
  ink: 'dark' | 'light';
  icon: Parameters<typeof ToolGlyph>[0]['tool']['icon'];
  locked?: string;
  required?: boolean;
};

/** Turn modules on and off for the whole Space. Owners and admins only; enforced on the server. */
export function ModuleToggles({
  slug,
  rows,
  enabled,
}: {
  slug: string;
  rows: ToggleRow[];
  enabled: ModuleId[];
}) {
  const [pending, start] = useTransition();
  const [on, setOn] = useOptimistic(enabled);
  const toast = useToast();

  const toggle = (module: ModuleId) =>
    start(async () => {
      const next = on.includes(module) ? on.filter((item) => item !== module) : [...on, module];
      setOn(next);
      const result = await setModules(slug, next);
      const name = rows.find((row) => row.module === module)?.name ?? 'Tool';
      toast(
        result.ok
          ? {
              title: `${name} ${next.includes(module) ? 'on' : 'off'}`,
              description: 'For everyone in this Space',
            }
          : { title: result.error, icon: 'alert' },
      );
    });

  return (
    <ul className="row-divide">
      {rows.map((row) => {
        const active = on.includes(row.module);
        return (
          <li key={row.module} className="flex items-center gap-3 px-4 py-3">
            <ToolGlyph tool={row} size="md" className={cn(!active && 'opacity-45 grayscale')} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink">{row.name}</p>
              <p className="truncate text-[12.5px] text-muted">
                {row.locked ?? (row.required ? 'Always on for business Spaces' : row.tagline)}
              </p>
            </div>
            {row.locked ? (
              <span className="flex items-center gap-1 text-[12px] text-faint">
                <Icon name="lock" size={13} /> Plan
              </span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={active}
                aria-label={`${row.name} ${active ? 'on' : 'off'}`}
                disabled={row.required || pending}
                onClick={() => toggle(row.module)}
                className={cn(
                  'relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50',
                  active ? 'bg-signal' : 'bg-ink/15',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform',
                    active && 'translate-x-5',
                  )}
                />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
