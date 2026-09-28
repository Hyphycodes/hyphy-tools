'use client';
import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/components/ui/cn';
import { EVERYTHING, modes, type Lens } from '@/lib/catalog/modes';
import { chooseLens } from './use-home';

const OPTIONS: { id: Lens; name: string }[] = [
  ...modes.map((mode) => ({ id: mode.id, name: mode.name })),
  { id: 'all', name: 'All' },
];

/**
 * Everyday · Create · Work · All: which lens the home is looking through. Compact, always in
 * reach at the top of the home, never a setting. The lit pill slides to the choice.
 */
export function ModeSwitch({ lens, className }: { lens: Lens; className?: string }) {
  const index = Math.max(
    0,
    OPTIONS.findIndex((option) => option.id === lens),
  );
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (next: Lens) => {
    if (next !== lens) chooseLens(next);
  };
  // Arrow keys move between modes, like any radio group.
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    pick(OPTIONS[next].id);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Mode"
      onKeyDown={onKeyDown}
      className={cn(
        'mode-switch relative grid h-12 w-full max-w-[460px] grid-cols-[1.12fr_1fr_1fr_.72fr] rounded-full p-1',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mode-switch-thumb absolute inset-y-1 left-1 rounded-full"
        style={{
          width: `calc((100% - 8px) * ${[1.12, 1, 1, 0.72][index] / 3.84})`,
          transform: `translateX(calc((100% / ${[1.12, 1, 1, 0.72][index]}) * ${[0, 1.12, 2.12, 3.12][index]}))`,
        }}
      />
      {OPTIONS.map((option, order) => {
        const on = option.id === lens;
        return (
          <button
            key={option.id}
            ref={(element) => {
              buttons.current[order] = element;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.id === 'all' ? EVERYTHING.name : option.name}
            tabIndex={on ? 0 : -1}
            onClick={() => pick(option.id)}
            className={cn(
              'relative z-[1] min-w-0 truncate rounded-full px-2 text-[13.5px] font-semibold tracking-[.01em] transition-colors duration-300 sm:text-[14.5px]',
              on ? 'text-[var(--switch-on)]' : 'text-muted hover:text-ink',
            )}
          >
            {option.name}
          </button>
        );
      })}
    </div>
  );
}
