/** Page-range parsing for the PDF tool's Extract mode. Pure, so it's easy to test. */

/** "1-3, 5, 8-" → zero-based page indexes, in order, without duplicates. */
export function parseRange(input: string, total: number): number[] | null {
  const pages: number[] = [];
  for (const part of input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!match || (!match[1] && !match[3])) return null;
    const start = match[1] ? Number(match[1]) : 1;
    const end = match[2] ? (match[3] ? Number(match[3]) : total) : start;
    if (start < 1 || end > total || start > end) return null;
    for (let page = start; page <= end; page += 1)
      if (!pages.includes(page - 1)) pages.push(page - 1);
  }
  return pages.length ? pages : null;
}

/** Zero-based page indexes → the shortest range text: [0,1,2,4] → "1-3, 5". */
export function formatRange(indexes: number[]): string {
  const pages = [...new Set(indexes)].sort((a, b) => a - b).map((index) => index + 1);
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const start = pages[i];
    while (i + 1 < pages.length && pages[i + 1] === pages[i] + 1) i += 1;
    parts.push(start === pages[i] ? String(start) : `${start}-${pages[i]}`);
  }
  return parts.join(', ');
}

/** Split: "1-3, 4-6, 8-" → one zero-based page list per part, each in order. */
export function parseParts(input: string, total: number): number[][] | null {
  const parts = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((part) => parseRange(part, total));
  if (!parts.length || parts.some((part) => part === null)) return null;
  return parts as number[][];
}

/** Split: every `size` pages becomes its own file. */
export function everyParts(total: number, size: number): number[][] {
  const step = Math.max(1, Math.floor(size));
  const parts: number[][] = [];
  for (let start = 0; start < total; start += step)
    parts.push(Array.from({ length: Math.min(step, total - start) }, (_, index) => start + index));
  return parts;
}
