/** Hands a file made on this device to the browser as a download. Nothing is uploaded. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** A text file (CSV, JSON, CSS) as a download. */
export function downloadText(text: string, name: string, type = 'text/plain') {
  download(new Blob([text], { type: `${type};charset=utf-8` }), name);
}

/** "My file.JPG" → "my-file": for names Hyphy makes. */
export function slugName(text: string, fallback = 'file') {
  const base = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return base || fallback;
}

/** One CSV cell, quoted when it needs to be, and never read as a formula by a spreadsheet. */
export function csvCell(value: string | number) {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csv(rows: (string | number)[][]) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
