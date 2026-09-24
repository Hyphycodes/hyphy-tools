import { cn } from './cn';

export function Progress({
  value,
  color = 'var(--color-ink)',
  className,
  label,
}: {
  value: number;
  color?: string;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      className={cn('h-1.5 overflow-hidden rounded-full', className)}
      // The track is a lighter step of the fill's own hue, so progress reads across the whole bar.
      style={{ background: `color-mix(in oklab, ${color} 18%, var(--color-well))` }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${clamped}%`, background: color }}
      />
    </div>
  );
}
