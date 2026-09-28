import type { ToolId } from '@/lib/catalog/schema';

/*
 * Carrying a file from one tool to the next, in this tab: Resize's photo into Social Crop or
 * Palette without choosing it again. The file stays in memory (it survives the client-side hop
 * between tool pages, not a reload), is taken once, and goes stale after a couple of minutes.
 * Nothing is written anywhere. The seam where a shared asset tray can arrive later.
 */

const FRESH_MS = 2 * 60_000;

let carried: { file: File; to: ToolId; from: ToolId; at: number } | null = null;

export function carry(file: File, from: ToolId, to: ToolId) {
  carried = { file, from, to, at: Date.now() };
}

/** The file carried to this tool, if any (taken: a second call gets nothing). */
export function takeCarried(to: ToolId): { file: File; from: ToolId } | null {
  const found = carried;
  if (!found || found.to !== to || Date.now() - found.at > FRESH_MS) return null;
  carried = null;
  return { file: found.file, from: found.from };
}
