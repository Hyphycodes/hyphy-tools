import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import type { Tool } from '@/lib/catalog';

const sizes = {
  sm: { box: 'size-8 rounded-[9px]', icon: 16 },
  md: { box: 'size-10 rounded-[11px]', icon: 19 },
  lg: { box: 'size-12 rounded-[13px]', icon: 22 },
  xl: { box: 'size-16 rounded-[17px]', icon: 28 },
} as const;

/** A tool's small mark: its accent, lit from above, with the pictogram in ink. */
export function ToolMark({
  tool,
  size = 'md',
  className,
}: {
  tool: Pick<Tool, 'accent' | 'accentInk' | 'icon'>;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const spec = sizes[size];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center',
        'shadow-[inset_0_1px_0_rgb(255_255_255/.4),inset_0_0_0_1px_rgb(0_0_0/.12),0_8px_20px_-10px_var(--mark-glow)]',
        spec.box,
        className,
      )}
      style={
        {
          background: `linear-gradient(160deg, color-mix(in oklab, ${tool.accent}, white 18%), ${tool.accent} 60%)`,
          color: tool.accentInk === 'light' ? '#fff' : '#12110d',
          '--mark-glow': tool.accent,
        } as React.CSSProperties
      }
    >
      <Icon name={tool.icon} size={spec.icon} strokeWidth={1.9} />
    </span>
  );
}
