import type { IconName } from '@/components/ui/icon';
import { MODE_IDS } from './ids';
import type { ModeId, Tool, ToolId } from './schema';
import { tools } from './tools';

/*
 * Discovery: the layer above the tools. Three modes are lenses over the same catalog (a tool can
 * sit in several; none is ever hidden), situations are the few human moments each mode opens on,
 * and quick actions are the jobs behind the "+". Everything here is data read from the registry,
 * so a new tool joins a mode by adding `modes` to its entry, and a new situation is one entry.
 *
 * Nothing here knows about a person: what someone pinned or used lives in lib/home.
 */

export { MODE_IDS };
export type { ModeId };

/** A lens: one of the modes, or everything. */
export type Lens = ModeId | 'all';
export const LENSES: readonly Lens[] = [...MODE_IDS, 'all'];

export type Mode = {
  id: ModeId;
  name: string;
  /** Under its name in the picker: "Life, friends and quick fixes". */
  line: string;
  /** The home's headline in this mode. */
  headline: string;
  /** The shelf of tools picked for the mode. */
  shelf: string;
  /** Its situations, in order (seasonal ones only show in season). */
  situations: string[];
  /** The "+" groups, in the order this mode reaches for them. */
  quick: QuickGroupId[];
  /** Search examples in the mode's words. */
  examples: string[];
  icon: IconName;
};

export const modes: Mode[] = [
  {
    id: 'everyday',
    name: 'Everyday',
    line: 'Life, friends and quick fixes',
    headline: 'What’s the plan?',
    shelf: 'Handy every day',
    situations: ['dinner', 'planning', 'quick-fix', 'hosting', 'gifts'],
    quick: ['plan', 'scan', 'upload', 'make', 'track'],
    examples: ['split dinner', 'find a time', 'who’s bringing what', 'wifi code', 'shrink a photo'],
    icon: 'coffee',
  },
  {
    id: 'create',
    name: 'Create',
    line: 'Photos, files and things you make',
    headline: 'Let’s make something.',
    shelf: 'For making things',
    situations: ['posting', 'photos', 'making-link', 'files'],
    quick: ['upload', 'make', 'scan', 'plan', 'track'],
    examples: [
      'instagram',
      'colors from a photo',
      'youtube thumbnail',
      'heic to jpg',
      'link in bio',
    ],
    icon: 'sparkles',
  },
  {
    id: 'work',
    name: 'Work',
    line: 'Business, money and getting things done',
    headline: 'Let’s get it done.',
    shelf: 'Your work kit',
    situations: ['working-today', 'month-end', 'documents', 'marketing'],
    quick: ['track', 'scan', 'upload', 'make', 'plan'],
    examples: ['work mileage', 'scan a receipt', 'merge pdfs', 'menu qr code', 'utm link'],
    icon: 'briefcase',
  },
];

/** "Show me everything": the whole catalog, arranged the classic way. */
export const EVERYTHING = {
  id: 'all' as const,
  name: 'Everything',
  line: 'Every tool, all in one place',
  situations: ['dinner', 'posting', 'working-today', 'files', 'gifts'],
  quick: ['scan', 'upload', 'make', 'plan', 'track'] as QuickGroupId[],
};

const modeIndex = new Map(modes.map((mode) => [mode.id, mode]));

export function getMode(id: ModeId): Mode {
  return modeIndex.get(id)!;
}

export function isLens(value: unknown): value is Lens {
  return typeof value === 'string' && (LENSES as readonly string[]).includes(value);
}

export function lensName(lens: Lens) {
  return lens === 'all' ? EVERYTHING.name : getMode(lens).name;
}

/* ---------------- tools in a mode ---------------- */

const listed = tools.filter((tool) => tool.visibility === 'public');

/** The tools a mode holds, in its own order (open ones only). */
export function toolsForMode(mode: ModeId): Tool[] {
  return listed
    .filter((tool) => tool.modes[mode] && tool.status !== 'soon')
    .sort((a, b) => a.modes[mode]!.rank - b.modes[mode]!.rank);
}

/** How many tools a new person meets first in a mode. */
export const STARTERS = 6;

/** A mode's starter set: its first six. Everything's starters are the editorial favorites. */
export function starterTools(lens: Lens, count = STARTERS): Tool[] {
  if (lens !== 'all') return toolsForMode(lens).slice(0, count);
  const favorites = listed.filter((tool) => tool.featured && tool.status !== 'soon');
  return favorites.sort((a, b) => a.priority - b.priority).slice(0, count);
}

/** What a tool is for in this mode ("Menus, reviews, marketing"), or its tagline. */
export function lineIn(tool: Tool, lens: Lens | null) {
  return (lens && lens !== 'all' && tool.modes[lens]?.line) || tool.tagline;
}

/** The modes a tool belongs to. */
export function modesOf(tool: Pick<Tool, 'modes'>): ModeId[] {
  return MODE_IDS.filter((mode) => tool.modes[mode]);
}

/* ---------------- situations ---------------- */

export type SituationStep = {
  tool: ToolId;
  /** The step, as a verb: "Find a time". */
  label: string;
};

/**
 * A human moment ("Dinner with people") and the few tools it takes, in the order they're used
 * when there is one. Situations open the tool straight away; nobody needs to know a category.
 */
export type Situation = {
  id: string;
  title: string;
  line: string;
  icon: IconName;
  /** The steps come in an order (a path), or they're simply the tools for it. */
  ordered: boolean;
  steps: SituationStep[];
  /** Only in these months (1–12): gifts from October to January. */
  months?: number[];
};

export const situations: Situation[] = [
  {
    id: 'dinner',
    title: 'Dinner with people',
    line: 'From the group chat to the check.',
    icon: 'utensils',
    ordered: true,
    steps: [
      { tool: 'when', label: 'Find a time' },
      { tool: 'where', label: 'Pick a place' },
      { tool: 'split', label: 'Split the bill' },
    ],
  },
  {
    id: 'planning',
    title: 'Planning something',
    line: 'A birthday, a trip, a Friday night.',
    icon: 'party',
    ordered: true,
    steps: [
      { tool: 'plan', label: 'Make the plan' },
      { tool: 'when', label: 'Find the day' },
      { tool: 'where', label: 'Choose the spot' },
      { tool: 'bring', label: 'Who brings what' },
    ],
  },
  {
    id: 'quick-fix',
    title: 'Quick fixes',
    line: 'Two minutes, done, nothing uploaded.',
    icon: 'wand',
    ordered: false,
    steps: [
      { tool: 'resize', label: 'Shrink a photo' },
      { tool: 'pdf', label: 'Merge PDFs' },
      { tool: 'qr', label: 'A Wi-Fi code' },
      { tool: 'convert', label: 'HEIC to JPG' },
    ],
  },
  {
    id: 'hosting',
    title: 'Hosting at yours',
    line: 'Potluck, cookout, game night.',
    icon: 'basket',
    ordered: true,
    steps: [
      { tool: 'plan', label: 'Invite people' },
      { tool: 'bring', label: 'Share the list' },
      { tool: 'split', label: 'Settle up' },
    ],
  },
  {
    id: 'gifts',
    title: 'Exchanging gifts',
    line: 'Names in a hat, lists nobody doubles up on.',
    icon: 'gift',
    ordered: true,
    months: [10, 11, 12, 1],
    steps: [
      { tool: 'secret-santa', label: 'Draw names' },
      { tool: 'wishlist', label: 'Make a wish list' },
    ],
  },
  {
    id: 'posting',
    title: 'Posting something',
    line: 'One photo, ready for every feed.',
    icon: 'instagram',
    ordered: true,
    steps: [
      { tool: 'resize', label: 'Resize' },
      { tool: 'social-crop', label: 'Frame each feed' },
      { tool: 'palette', label: 'Pull the colors' },
    ],
  },
  {
    id: 'photos',
    title: 'A camera roll, sorted',
    line: 'Fewer copies, the right format, good names.',
    icon: 'image',
    ordered: true,
    steps: [
      { tool: 'duplicates', label: 'Find the copies' },
      { tool: 'convert', label: 'Change the format' },
      { tool: 'clean', label: 'Name them all' },
    ],
  },
  {
    id: 'making-link',
    title: 'Making a link',
    line: 'Somewhere to send people, and proof it worked.',
    icon: 'link',
    ordered: true,
    steps: [
      { tool: 'signal-pages', label: 'Build your page' },
      { tool: 'signal-links', label: 'Track the link' },
      { tool: 'qr', label: 'Print the code' },
    ],
  },
  {
    id: 'files',
    title: 'Preparing files',
    line: 'Photos and paperwork, ready to send.',
    icon: 'files',
    ordered: true,
    steps: [
      { tool: 'convert', label: 'Photos to PDF' },
      { tool: 'pdf', label: 'Merge & order' },
      { tool: 'clean', label: 'Name them right' },
    ],
  },
  {
    id: 'working-today',
    title: 'Working today',
    line: 'Drive, spend, keep the proof.',
    icon: 'briefcase',
    ordered: true,
    steps: [
      { tool: 'mileage', label: 'Start a drive' },
      { tool: 'receipts', label: 'Scan a receipt' },
    ],
  },
  {
    id: 'month-end',
    title: 'Closing the month',
    line: 'What your accountant will ask for.',
    icon: 'wallet',
    ordered: false,
    steps: [
      { tool: 'receipts', label: 'Export receipts' },
      { tool: 'mileage', label: 'Export mileage' },
      { tool: 'subscriptions', label: 'Check what renews' },
    ],
  },
  {
    id: 'documents',
    title: 'Preparing documents',
    line: 'Scans, contracts and packets, in order.',
    icon: 'file-text',
    ordered: true,
    steps: [
      { tool: 'convert', label: 'Scans to PDF' },
      { tool: 'pdf', label: 'Merge & order' },
      { tool: 'clean', label: 'Name them right' },
    ],
  },
  {
    id: 'marketing',
    title: 'Marketing something',
    line: 'Menus, flyers and the link in your bio.',
    icon: 'megaphone',
    ordered: false,
    steps: [
      { tool: 'qr', label: 'A menu or review code' },
      { tool: 'signal-links', label: 'Tag your links' },
      { tool: 'signal-pages', label: 'One page for it' },
    ],
  },
];

const situationIndex = new Map(situations.map((situation) => [situation.id, situation]));

export function getSituation(id: string) {
  return situationIndex.get(id);
}

/** The situations a lens opens on this month (1–12), in its order. */
export function situationsFor(lens: Lens, month: number, count = 4): Situation[] {
  const ids = lens === 'all' ? EVERYTHING.situations : getMode(lens).situations;
  const open = ids
    .map((id) => situationIndex.get(id)!)
    .filter((situation) => !situation.months || situation.months.includes(month));
  // A seasonal moment in its season leads (gifts in December).
  return [...open.filter((item) => item.months), ...open.filter((item) => !item.months)].slice(
    0,
    count,
  );
}

/* ---------------- the "+" ---------------- */

export type QuickGroupId = 'scan' | 'upload' | 'make' | 'plan' | 'track';

export type QuickGroup = {
  id: QuickGroupId;
  label: string;
  icon: IconName;
  actions: { tool: ToolId; label: string }[];
};

/**
 * One entry point for starting anything. Each action opens a tool today; when tools can hand
 * files to each other, "Upload something" can take the file first and ask where it goes.
 */
export const quickGroups: QuickGroup[] = [
  {
    id: 'scan',
    label: 'Scan something',
    icon: 'scan',
    actions: [
      { tool: 'receipts', label: 'A receipt to keep' },
      { tool: 'split', label: 'A check to split' },
    ],
  },
  {
    id: 'upload',
    label: 'Upload something',
    icon: 'upload',
    actions: [
      { tool: 'resize', label: 'A photo' },
      { tool: 'pdf', label: 'A PDF' },
      { tool: 'convert', label: 'Any other file' },
    ],
  },
  {
    id: 'make',
    label: 'Make something',
    icon: 'sparkles',
    actions: [
      { tool: 'qr', label: 'A QR code' },
      { tool: 'signal-pages', label: 'A page' },
      { tool: 'signal-links', label: 'A tracked link' },
    ],
  },
  {
    id: 'plan',
    label: 'Plan something',
    icon: 'calendar',
    actions: [
      { tool: 'plan', label: 'A plan' },
      { tool: 'when', label: 'A time' },
      { tool: 'where', label: 'A place' },
    ],
  },
  {
    id: 'track',
    label: 'Track something',
    icon: 'gauge',
    actions: [
      { tool: 'mileage', label: 'A drive' },
      { tool: 'subscriptions', label: 'Subscriptions' },
    ],
  },
];

/** The "+" groups in the order a lens reaches for them. */
export function quickFor(lens: Lens | null): QuickGroup[] {
  const order = !lens || lens === 'all' ? EVERYTHING.quick : getMode(lens).quick;
  return order.map((id) => quickGroups.find((group) => group.id === id)!);
}
