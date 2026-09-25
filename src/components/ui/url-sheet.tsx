'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Sheet } from './sheet';

/**
 * A Sheet whose open state lives in the URL (`?receipt=…`), so a record's details can be linked
 * to, survive a reload and close with Back. The server renders the contents; closing drops the
 * parameter without scrolling the page.
 */
export function UrlSheet({
  closeHref,
  ...props
}: Omit<Parameters<typeof Sheet>[0], 'open' | 'onClose'> & { closeHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      {...props}
      open={open}
      onClose={() => {
        setOpen(false);
        router.replace(closeHref, { scroll: false });
      }}
    />
  );
}
