'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';

/**
 * A link that fetches its page when someone shows intent (a finger landing, a pointer arriving,
 * keyboard focus) instead of when it scrolls into view. The marketplace has a link to every tool:
 * prefetching them all on sight downloaded every tool page while you browsed (over 1 MB on a
 * phone, measured). A touch lands 100ms+ before the tap completes, which is plenty.
 */
export function IntentLink({
  href,
  onPointerEnter,
  onTouchStart,
  onFocus,
  ...props
}: ComponentProps<typeof Link>) {
  const router = useRouter();
  const warm = () => {
    if (typeof href === 'string') router.prefetch(href);
  };
  return (
    <Link
      href={href}
      prefetch={false}
      onPointerEnter={(event) => {
        warm();
        onPointerEnter?.(event);
      }}
      onTouchStart={(event) => {
        warm();
        onTouchStart?.(event);
      }}
      onFocus={(event) => {
        warm();
        onFocus?.(event);
      }}
      {...props}
    />
  );
}
