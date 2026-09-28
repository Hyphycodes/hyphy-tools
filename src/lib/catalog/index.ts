import type { CategoryId, FamilyId, Tool, ToolId, ToolStatus } from './schema';
import { tools } from './tools';

export type { Category, CategoryId, Family, FamilyId, Tool, ToolId, ToolStatus } from './schema';
export { categories, families, getCategory, getFamily } from './taxonomy';
export { tools } from './tools';

/*
 * Reading the registry. Pages and components ask these questions instead of filtering the list
 * themselves, so the rules (what's listed, what's related, how privacy is worded) live once.
 */

const byPriority = (a: Tool, b: Tool) => a.priority - b.priority;

/** Everything in the marketplace, in editorial order. */
export const listedTools: Tool[] = tools
  .filter((tool) => tool.visibility === 'public')
  .sort(byPriority);

/** Everything with a page: listed tools and unlisted ones reachable by their link. */
export const routableTools: Tool[] = tools.filter((tool) => tool.visibility !== 'hidden');

const bySlug = new Map(routableTools.map((tool) => [tool.slug, tool]));
const byId = new Map(tools.map((tool) => [tool.id, tool]));

export function toolBySlug(slug: string): Tool | undefined {
  return bySlug.get(slug);
}

export function getTool(id: ToolId): Tool {
  return byId.get(id)!;
}

/** Where a tool lives, inside the app (Next.js adds the base path). */
export function toolHref(tool: Pick<Tool, 'slug'>) {
  return `/tools/${tool.slug}` as const;
}

export const isReady = (tool: Pick<Tool, 'status'>) => tool.status !== 'soon';

export const statusLabel: Record<ToolStatus, string> = {
  available: 'Available',
  beta: 'Beta',
  soon: 'Coming soon',
};

export function inCategory(id: CategoryId) {
  return listedTools.filter((tool) => tool.category === id);
}

export function inFamily(id: FamilyId) {
  return listedTools.filter((tool) => tool.family === id);
}

export const drops = listedTools.filter((tool) => tool.drop);

/** Up to `count` tools worth opening next: the ones it names, then its family, then its category. */
export function relatedTo(tool: Tool, count = 3): Tool[] {
  const picked: Tool[] = [];
  const add = (candidate: Tool | undefined) => {
    if (
      candidate &&
      candidate.id !== tool.id &&
      candidate.visibility === 'public' &&
      !picked.includes(candidate)
    )
      picked.push(candidate);
  };
  tool.related.map((id) => byId.get(id)).forEach(add);
  const neighbours = [
    ...listedTools.filter((item) => tool.family && item.family === tool.family),
    ...listedTools.filter((item) => item.category === tool.category),
  ];
  // Prefer tools people can open today.
  neighbours.filter(isReady).forEach(add);
  neighbours.forEach(add);
  return picked.slice(0, count);
}

/* ---------------- access ---------------- */

/** What it costs, honestly: free unless a planned extra will be paid. */
export function accessLabel(tool: Pick<Tool, 'access'>) {
  switch (tool.access) {
    case 'free':
      return 'Free';
    case 'freemium':
      return 'Free';
    case 'pro':
      return 'Pro';
  }
}

export function accountLabel(tool: Pick<Tool, 'account'>) {
  switch (tool.account) {
    case 'none':
      return 'No account needed';
    case 'optional':
      return 'Account optional';
    case 'required':
      return 'Needs an account';
  }
}

/* ---------------- privacy ---------------- */

export type PrivacyFacts = {
  /** A short chip: "Runs on your device". */
  label: string;
  /** The quiet line under a tool's name: "Processed on your device". */
  short: string;
  /** Fully local: nothing reaches Hyphy. */
  local: boolean;
  /** The plain explanation, one fact per line. */
  lines: string[];
};

/**
 * Privacy words generated from how the tool is built, so the claim can't outrun the code. A
 * tool only says "runs on your device" when its processing really is on the device, and only
 * says nothing is stored when it really keeps nothing.
 */
export function privacyFacts(tool: Pick<Tool, 'privacy'>): PrivacyFacts {
  const { processing, storage, note } = tool.privacy;
  const local = processing === 'device' && !storage.includes('account');
  const label = !local
    ? 'Kept with your account'
    : storage.includes('link')
      ? 'On your device · shared by link'
      : storage.includes('browser')
        ? 'On your device · saved in this browser'
        : 'Runs on your device';
  const short = !local ? 'Kept with your account' : 'Processed on your device';
  const lines: string[] = [];
  if (note) lines.push(note);
  if (processing === 'device')
    lines.push('Everything happens in your browser. What you add is never uploaded to Hyphy.');
  else
    lines.push(
      'This tool works through Hyphy’s servers. Your data is used to provide the tool, and Hyphy doesn’t sell your personal data.',
    );
  if (storage.includes('none')) lines.push('Nothing is kept. Close the tab and it’s gone.');
  if (storage.includes('browser'))
    lines.push(
      'Your work is saved in this browser so it’s here next time. Clearing your browser data removes it.',
    );
  if (storage.includes('link'))
    lines.push(
      'Sharing puts the details inside the link, after the #, a part browsers never send to a server. Anyone you give the link to can open it.',
    );
  if (storage.includes('account'))
    lines.push('It’s kept with your Hyphy account so it works across your devices.');
  return { label, short, local, lines };
}

/* ---------------- marketplace numbers ---------------- */

/** Counts for the marketplace, straight from the registry: never usage data. */
export function catalogFacts() {
  const open = listedTools.filter(isReady);
  return {
    open: open.length,
    local: open.filter((tool) => privacyFacts(tool).local).length,
    noAccount: open.filter((tool) => tool.account === 'none').length,
    soon: listedTools.length - open.length,
  };
}
