'use client';
import { useState } from 'react';
import { BASE_PATH } from '@/lib/base-path';
import type { Space } from '@/lib/platform/types';
import { useDeviceUrl } from './file-media';

/**
 * A business's logo inside its mark. Stored logos load through `/{space}/logo`, which checks the
 * viewer is a member before redirecting to a short-lived link (the bucket stays private); Demo
 * Mode's come from this browser. If it can't be shown, the initials underneath remain.
 */
export function SpaceLogo({
  space,
  className,
}: {
  space: Pick<Space, 'slug' | 'logo'>;
  className?: string;
}) {
  const logo = space.logo!;
  const device = useDeviceUrl(logo.fileId, logo.storage === 'device');
  const [failed, setFailed] = useState(false);
  const src =
    logo.storage === 'device'
      ? device.url
      : `${BASE_PATH}/${encodeURIComponent(space.slug)}/logo?v=${logo.fileId}`;
  if (!src || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={className ?? 'absolute inset-0 size-full bg-white object-contain p-[12%]'}
    />
  );
}
