'use client';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

/** Downloads rows as CSV, made in the browser from what's on screen. */
export function CsvButton({
  rows,
  name,
  label = 'Export CSV',
}: {
  rows: (string | number)[][];
  name: string;
  label?: string;
}) {
  const download = () => {
    const escape = (value: string | number) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = rows.map((row) => row.map(escape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Button size="sm" onClick={download} disabled={rows.length < 2}>
      <Icon name="download" size={15} /> {label}
    </Button>
  );
}
