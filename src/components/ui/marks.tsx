import type { ToolDefinition } from '@/lib/platform/tools';
import type { Space } from '@/lib/platform/types';
import { cn } from './cn';
import { SpaceLogo } from '@/components/files/space-logo';
import { Icon, type IconName } from './icon';

const spaceSizes = {
  sm: 'size-6 rounded-[7px] text-[9.5px]',
  md: 'size-8 rounded-[9px] text-[11px]',
  lg: 'size-11 rounded-[12px] text-[14px]',
  xl: 'size-14 rounded-[15px] text-[17px]',
} as const;

/** A Space's badge: its brand color and monogram. Hyphy's own Space wears the spark. */
export function SpaceMark({
  space,
  size = 'md',
  className,
}: {
  space: Pick<Space, 'brand' | 'name' | 'id' | 'kind' | 'slug'> & Pick<Partial<Space>, 'logo'>;
  size?: keyof typeof spaceSizes;
  className?: string;
}) {
  const spark = space.slug === 'hyphy' && !space.logo;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden font-display font-bold tracking-[-0.02em] select-none',
        'shadow-[inset_0_0_0_1px_rgb(0_0_0/.08),inset_0_1px_0_rgb(255_255_255/.22)]',
        space.kind === 'personal' && '!rounded-full',
        spaceSizes[size],
        className,
      )}
      style={{
        background: space.brand.color,
        color: space.brand.ink === 'light' ? '#fff' : '#16150F',
        fontVariationSettings: "'wdth' 112",
      }}
    >
      {spark ? (
        <Icon name="spark" size={size === 'sm' ? 12 : size === 'md' ? 15 : 20} />
      ) : (
        space.brand.monogram
      )}
      {/* The business's own logo, over its initials (which show if it can't load). */}
      {space.logo && space.kind === 'business' && <SpaceLogo space={space} />}
    </span>
  );
}

const glyphSizes = {
  xs: { box: 'size-5 rounded-[6px]', icon: 12 },
  sm: { box: 'size-7 rounded-[8px]', icon: 15 },
  md: { box: 'size-9 rounded-[10px]', icon: 18 },
  lg: { box: 'size-12 rounded-[13px]', icon: 23 },
  xl: { box: 'size-16 rounded-[18px]', icon: 30 },
} as const;

/** A tool's glyph: its color world with the pictogram in ink. */
export function ToolGlyph({
  tool,
  icon,
  size = 'md',
  className,
}: {
  tool: Pick<ToolDefinition, 'color' | 'ink' | 'icon'>;
  icon?: IconName;
  size?: keyof typeof glyphSizes;
  className?: string;
}) {
  const spec = glyphSizes[size];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center',
        'shadow-[inset_0_0_0_1px_rgb(0_0_0/.07),inset_0_1px_0_rgb(255_255_255/.35)]',
        spec.box,
        className,
      )}
      style={{ background: tool.color, color: tool.ink === 'light' ? '#fff' : '#16150F' }}
    >
      <Icon name={icon ?? tool.icon} size={spec.icon} strokeWidth={1.85} />
    </span>
  );
}
