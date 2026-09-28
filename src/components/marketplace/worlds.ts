import type { CSSProperties } from 'react';
import type { Tool, ToolId } from '@/lib/catalog';

/*
 * THE HYPHY TOOL EXPERIENCE SYSTEM
 * ------------------------------------------------------------------
 * The architecture is shared; the experience isn't. Every tool describes its little world here
 * and the shared parts (the page shell, world.css, the kit in components/tools/kit.tsx) draw it:
 *
 *   1. World      `surface` (light or night), `canvas`, `paper`, `ink`, a second color and a
 *                 third, and a backdrop `pattern` drawn from what the tool is about.
 *   2. Object     `object`: the one thing the tool is (a receipt, a calendar, a photo, pages…).
 *                 The kit's <Stage> and <DropObject> take their shape from it.
 *   3. Action     `action`: the job, in the words on the tool's main button and marketplace card.
 *   4. Controls   the tool's own (kit: Choices, PresetCards, Swatches, Advanced).
 *   5. Motion     `motion`: how things move (paper settles, snappy clicks, soft paint, springy).
 *   6. Payoff     `payoff`: how the result lands (resolve, stamp, count, emerge, flip, pair).
 *
 * A new tool is a new entry: colors, pattern, object, motion and payoff. world.css turns the
 * entry into tokens (`--color-canvas`, `--color-ink`… re-lit for the tool), so every tool written
 * against tokens takes on its world with no per-tool CSS.
 *
 * Patterns are plain CSS gradients (world.css, `[data-pattern]`): no images, no blur.
 */

export type Pattern =
  | 'receipt'
  | 'calendar'
  | 'gingham'
  | 'pixels'
  | 'ledger'
  | 'frames'
  | 'confetti'
  | 'editorial'
  | 'pages'
  | 'sun'
  | 'snow'
  | 'dots'
  | 'grid'
  | 'rays'
  | 'gallery'
  | 'map'
  | 'invite'
  | 'envelope'
  | 'columns'
  | 'route';

export type Mood = 'social' | 'practical' | 'creative' | 'personal' | 'fun';

/** The one object a tool is about: it shapes the stage, the drop target and the card. */
export type WorldObject =
  | 'receipt'
  | 'calendar'
  | 'code'
  | 'photo'
  | 'frames'
  | 'swatches'
  | 'pages'
  | 'files'
  | 'list'
  | 'tag'
  | 'ledger'
  | 'phone'
  | 'link'
  | 'places'
  | 'invite'
  | 'envelope'
  | 'route';

/** How things move: the duration and ease every transition in the tool reads. */
export type Motion = 'paper' | 'snappy' | 'soft' | 'springy';

/** How the result lands. */
export type Payoff = 'resolve' | 'stamp' | 'count' | 'emerge' | 'flip' | 'pair' | 'share';

export type World = {
  /** Light worlds are most tools; night is kept for the ones about screens and the unfinished. */
  surface: 'light' | 'night';
  /** The room: the page behind everything. */
  canvas: string;
  /** The object's material: paper, card, a white screen. */
  paper: string;
  /** Type and lines. */
  ink: string;
  /** The accent, dark enough to read as text on the canvas (the registry accent is a fill). */
  accentInk: string;
  /** The second light, opposite the accent. */
  glow: string;
  /** A third, quiet color for details (people, secondary chips). */
  third: string;
  pattern: Pattern;
  object: WorldObject;
  motion: Motion;
  payoff: Payoff;
  mood: Mood;
  /** The job, in a few words: the marketplace card's button and quick actions. */
  action: string;
  /** The path through the tool, in two or three words a step. */
  journey: string[];
};

/** Unfinished tools keep the quiet night; only shared styling reaches them. */
const later = (glow: string, object: WorldObject, mood: Mood): World => ({
  surface: 'night',
  canvas: '#0b0b0a',
  paper: '#151513',
  ink: '#ece8df',
  accentInk: glow,
  glow,
  third: glow,
  pattern: 'dots',
  object,
  motion: 'soft',
  payoff: 'share',
  mood,
  action: 'See what’s coming',
  journey: [],
});

export const worlds: Record<ToolId, World> = {
  // A warm restaurant: cream receipt paper, lime, a little amber light.
  split: {
    surface: 'light',
    canvas: '#f2e9d8',
    paper: '#fffbf1',
    ink: '#221c12',
    accentInk: '#4a7a00',
    glow: '#f1a54a',
    third: '#8a5a2b',
    pattern: 'receipt',
    object: 'receipt',
    motion: 'paper',
    payoff: 'resolve',
    mood: 'social',
    action: 'Split a check',
    journey: ['Snap the receipt', 'Who had what', 'Everyone’s total'],
  },
  // Clean blue and mint: a friendly dashboard.
  subscriptions: {
    surface: 'light',
    canvas: '#eaf2fb',
    paper: '#ffffff',
    ink: '#0f1f38',
    accentInk: '#2359b8',
    glow: '#6fd9b8',
    third: '#9fb8d8',
    pattern: 'ledger',
    object: 'ledger',
    motion: 'soft',
    payoff: 'count',
    mood: 'personal',
    action: 'Add up my subscriptions',
    journey: ['Pick what you pay for', 'See the real cost', 'Plan what to cut'],
  },
  // Warm receipt paper on a quiet ledger: emerald and charcoal.
  receipts: {
    surface: 'light',
    canvas: '#ecebe3',
    paper: '#fffdf7',
    ink: '#1d2420',
    accentInk: '#146b45',
    glow: '#e9d8a6',
    third: '#9bb8a6',
    pattern: 'columns',
    object: 'receipt',
    motion: 'paper',
    payoff: 'count',
    mood: 'practical',
    action: 'Scan a receipt',
    journey: ['Take a photo', 'Check it', 'Filed'],
  },
  mileage: later('#8f9bff', 'ledger', 'practical'),
  // Sunrise: peach and warm cream, light calendar surfaces.
  when: {
    surface: 'light',
    canvas: '#fbe9dc',
    paper: '#fffaf5',
    ink: '#2a1911',
    accentInk: '#b4520b',
    glow: '#ff7e5f',
    third: '#f6c7a8',
    pattern: 'calendar',
    object: 'calendar',
    motion: 'soft',
    payoff: 'resolve',
    mood: 'social',
    action: 'Find a time',
    journey: ['Pick the days', 'Share the link', 'See the overlap'],
  },
  // A picnic: green, cream and sky.
  bring: {
    surface: 'light',
    canvas: '#eaf3e1',
    paper: '#fffdf5',
    ink: '#16251a',
    accentInk: '#2a7440',
    glow: '#8ecff5',
    third: '#f5d77a',
    pattern: 'gingham',
    object: 'list',
    motion: 'soft',
    payoff: 'share',
    mood: 'social',
    action: 'Start a list',
    journey: ['List what’s needed', 'Share the link', 'Everyone claims'],
  },
  // A warm city night: plum sky, coral light, cream destination cards.
  where: {
    surface: 'light',
    canvas: '#f7e6de',
    paper: '#fffaf6',
    ink: '#2a1420',
    accentInk: '#b8322a',
    glow: '#6b2f63',
    third: '#ffc9b0',
    pattern: 'map',
    object: 'places',
    motion: 'springy',
    payoff: 'stamp',
    mood: 'social',
    action: 'Pick a place',
    journey: ['Add a few places', 'Send the link', 'Everyone votes'],
  },
  // Blue sky over warm ivory, a little sunshine: an invitation.
  plan: {
    surface: 'light',
    canvas: '#e6edfb',
    paper: '#fffdf6',
    ink: '#14203d',
    accentInk: '#2f55d4',
    glow: '#ffd84d',
    third: '#bcd0f7',
    pattern: 'invite',
    object: 'invite',
    motion: 'soft',
    payoff: 'share',
    mood: 'social',
    action: 'Make a plan',
    journey: ['What is it', 'When and where', 'Who’s in'],
  },
  // A tiny design studio: bright cyan, white and ink.
  qr: {
    surface: 'light',
    canvas: '#e7f6f6',
    paper: '#ffffff',
    ink: '#0c1a1d',
    accentInk: '#08796f',
    glow: '#1d2b3a',
    third: '#ffd66b',
    pattern: 'pixels',
    object: 'code',
    motion: 'snappy',
    payoff: 'stamp',
    mood: 'practical',
    action: 'Make a QR code',
    journey: ['Choose a kind', 'Add what it opens', 'Style it', 'Download'],
  },
  // A page about you, after dark: editorial pink on night.
  'signal-pages': {
    surface: 'night',
    canvas: '#0d0b0f',
    paper: '#18141b',
    ink: '#f1eaf0',
    accentInk: '#ff8ad8',
    glow: '#ffb38a',
    third: '#8f7bff',
    pattern: 'editorial',
    object: 'phone',
    motion: 'springy',
    payoff: 'share',
    mood: 'creative',
    action: 'Make my page',
    journey: ['Pick a look', 'Add your links', 'Share your page'],
  },
  // A tagged link: sand and ink.
  'signal-links': {
    surface: 'light',
    canvas: '#f4ecdf',
    paper: '#fffaf1',
    ink: '#1f1a14',
    accentInk: '#8a5a12',
    glow: '#ff8ad8',
    third: '#c9b28a',
    pattern: 'editorial',
    object: 'link',
    motion: 'snappy',
    payoff: 'flip',
    mood: 'practical',
    action: 'Tag a link',
    journey: ['Paste your link', 'Say where it goes', 'Copy it'],
  },
  // Warm paper, clay and charcoal: documents on a desk.
  pdf: {
    surface: 'light',
    canvas: '#efe8dc',
    paper: '#fdfaf4',
    ink: '#2a2521',
    accentInk: '#b8421b',
    glow: '#c8a27a',
    third: '#8c8177',
    pattern: 'pages',
    object: 'pages',
    motion: 'paper',
    payoff: 'stamp',
    mood: 'practical',
    action: 'Merge PDFs',
    journey: ['Pick a job', 'Add your PDFs', 'Download'],
  },
  // Cobalt and an electric edge: one thing becoming another.
  convert: {
    surface: 'light',
    canvas: '#e8ecfb',
    paper: '#ffffff',
    ink: '#0e1433',
    accentInk: '#2f4ae0',
    glow: '#35e0ff',
    third: '#b9c4f5',
    pattern: 'rays',
    object: 'files',
    motion: 'snappy',
    payoff: 'flip',
    mood: 'practical',
    action: 'Convert a file',
    journey: ['Pick a direction', 'Add files', 'Download'],
  },
  // Cool blue and lavender: a calm organizer.
  clean: {
    surface: 'light',
    canvas: '#ecebfa',
    paper: '#ffffff',
    ink: '#191834',
    accentInk: '#5b43c9',
    glow: '#9fc6ff',
    third: '#d9d2ff',
    pattern: 'grid',
    object: 'files',
    motion: 'snappy',
    payoff: 'flip',
    mood: 'practical',
    action: 'Tidy file names',
    journey: ['Add files', 'Pick the rules', 'Download'],
  },
  // Warm orange and cream: things that come in pairs.
  duplicates: {
    surface: 'light',
    canvas: '#faeede',
    paper: '#fffaf2',
    ink: '#2a1b0e',
    accentInk: '#b35300',
    glow: '#ffcf8a',
    third: '#e7c7a3',
    pattern: 'dots',
    object: 'files',
    motion: 'springy',
    payoff: 'pair',
    mood: 'practical',
    action: 'Find duplicates',
    journey: ['Pick a folder', 'Find copies', 'Clean up'],
  },
  // Photographic whites, warm yellow and a little coral.
  resize: {
    surface: 'light',
    canvas: '#f8f1dc',
    paper: '#fffdf7',
    ink: '#241e0e',
    accentInk: '#946300',
    glow: '#ff8b73',
    third: '#e8dcc0',
    pattern: 'sun',
    object: 'photo',
    motion: 'springy',
    payoff: 'count',
    mood: 'creative',
    action: 'Shrink a photo',
    journey: ['Add photos', 'Pick a size', 'Download'],
  },
  // An editorial photo studio: violet, soft blue and pink.
  'social-crop': {
    surface: 'light',
    canvas: '#efecfb',
    paper: '#ffffff',
    ink: '#1b1730',
    accentInk: '#5a40d8',
    glow: '#ff9fcf',
    third: '#9fc2ff',
    pattern: 'frames',
    object: 'frames',
    motion: 'springy',
    payoff: 'stamp',
    mood: 'creative',
    action: 'Crop for Instagram',
    journey: ['Add a photo', 'Pick the feeds', 'Frame it', 'Export'],
  },
  // A neutral gallery until a picture arrives; then the picture's colors light the room.
  palette: {
    surface: 'light',
    canvas: '#efeeea',
    paper: '#ffffff',
    ink: '#1a1a18',
    accentInk: '#b0306e',
    glow: '#ffd166',
    third: '#d9d6cf',
    pattern: 'gallery',
    object: 'swatches',
    motion: 'springy',
    payoff: 'emerge',
    mood: 'creative',
    action: 'Pull colors from a photo',
    journey: ['Drop an image', 'Get its colors', 'Copy them'],
  },
  // Pine, cranberry, parchment and a restrained gold.
  wishlist: {
    surface: 'light',
    canvas: '#f3ecdc',
    paper: '#fffbf1',
    ink: '#16271f',
    accentInk: '#a3202f',
    glow: '#c9a24c',
    third: '#2d5a43',
    pattern: 'snow',
    object: 'tag',
    motion: 'paper',
    payoff: 'share',
    mood: 'fun',
    action: 'Make a wish list',
    journey: ['Add your wishes', 'Share with givers', 'No duplicates'],
  },
  // Pine felt, parchment envelopes, a cranberry seal and a thread of muted gold.
  'secret-santa': {
    surface: 'light',
    canvas: '#efe7d4',
    paper: '#fffaf0',
    ink: '#1b2a22',
    accentInk: '#a3202f',
    glow: '#c9a24c',
    third: '#1f4d3a',
    pattern: 'envelope',
    object: 'envelope',
    motion: 'paper',
    payoff: 'emerge',
    mood: 'fun',
    action: 'Draw names',
    journey: ['Who’s in', 'Draw names', 'Send envelopes'],
  },
};

export const worldOf = (tool: Pick<Tool, 'id'>) => worlds[tool.id];

/**
 * The CSS variables a tool's world is drawn from. world.css turns them into the page's tokens
 * (`.tool-world[data-surface]`), so tools only ever read tokens and `--accent`.
 */
export function worldStyle(tool: Pick<Tool, 'id' | 'accent' | 'accentInk'>): CSSProperties {
  const world = worlds[tool.id];
  return {
    '--accent': tool.accent,
    '--accent-ink': world.accentInk,
    '--on-accent': tool.accentInk === 'light' ? '#ffffff' : '#12110d',
    '--glow': world.glow,
    '--third': world.third,
    '--w-canvas': world.canvas,
    '--w-paper': world.paper,
    '--w-ink': world.ink,
  } as CSSProperties;
}

/** The data attributes the shell puts on a tool page, read by world.css. */
export function worldData(tool: Pick<Tool, 'id'>) {
  const world = worlds[tool.id];
  return {
    'data-surface': world.surface,
    'data-motion': world.motion,
    'data-object': world.object,
    'data-payoff': world.payoff,
  } as const;
}

export const moodLabel: Record<Mood, string> = {
  social: 'With friends',
  practical: 'Get it done',
  creative: 'Make it look good',
  personal: 'Just for you',
  fun: 'Seasonal',
};
