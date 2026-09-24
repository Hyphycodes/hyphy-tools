import { cn } from './cn';

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'mono-num inline-grid h-5 min-w-5 place-items-center rounded-[5px] px-1 text-[10.5px] font-medium',
        'bg-surface text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong),0_1px_0_var(--color-line-strong)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
