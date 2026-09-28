import { cn } from '@/components/ui/cn';

/** The Hyphy spark: eight rays, drawn to match Studio's. */
export function Spark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </svg>
  );
}

/** HYPHY ✳ Tools: the umbrella's mark with this world's name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className="inline-flex items-center gap-1 font-display text-[17px] font-extrabold tracking-[-0.02em]"
        style={{ fontVariationSettings: "'wdth' 118" }}
      >
        HYPHY
        <Spark size={13} className="text-[#b9beff]" />
      </span>
      <span className="h-3.5 w-px bg-line-strong" aria-hidden="true" />
      <span className="text-[14.5px] font-medium text-ink-2">Tools</span>
    </span>
  );
}
