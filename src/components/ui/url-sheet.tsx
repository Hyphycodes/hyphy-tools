'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  // Where the sheet was opened. Following a link out of it (a person, a project) must not be
  // undone by the sheet closing behind you.
  const opened = useRef('');
  useEffect(() => {
    opened.current = window.location.href;
  }, []);
  return (
    <Sheet
      {...props}
      open={open}
      onClose={() => {
        setOpen(false);
        if (window.location.href === opened.current) router.replace(closeHref, { scroll: false });
      }}
    />
  );
}
