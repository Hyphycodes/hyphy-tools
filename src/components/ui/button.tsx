import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'inverse';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  primary:
    'bg-ink text-white shadow-[inset_0_1px_0_rgb(255_255_255/.1)] hover:bg-ink-2 active:bg-ink',
  accent:
    'bg-signal text-white shadow-[inset_0_1px_0_rgb(255_255_255/.22),0_6px_16px_-8px_rgb(50_64_255/.8)] hover:bg-signal-hover',
  secondary: 'bg-surface text-ink shadow-card hover:bg-subtle hover:shadow-lift',
  ghost: 'text-ink-2 hover:bg-ink/[.055] hover:text-ink',
  danger: 'bg-surface text-critical shadow-card hover:bg-critical-soft',
  inverse: 'bg-white/10 text-white hover:bg-white/16',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-[9px] px-2.5 text-[13px]',
  md: 'h-11 gap-2 rounded-[11px] px-4 text-[15px] lg:h-9 lg:rounded-[10px] lg:px-3.5 lg:text-[13.5px]',
  lg: 'h-12 gap-2 rounded-[12px] px-5 text-[15.5px] lg:h-11 lg:text-[14.5px]',
  icon: 'size-11 rounded-[11px] lg:size-9 lg:rounded-[10px]',
  'icon-sm': 'size-8 rounded-[9px]',
};

export function buttonClass({
  variant = 'secondary',
  size = 'md',
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap',
    'transition-[background-color,box-shadow,color,transform] duration-150 ease-out active:scale-[.97]',
    'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45',
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass({ variant, size, className })} {...props} />;
}
