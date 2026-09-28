import type { CSSProperties } from 'react';
import type { Tool, ToolId } from '@/lib/catalog';

/*
 * Every tool's little world: the same Hyphy night, lit differently. The accent comes from the
 * registry; the world adds a second color, a quiet backdrop pattern drawn from what the tool is
 * about (receipt paper, a calendar, a picnic cloth, pixels, crop marks…), a mood for the
 * marketplace, and the handful of words that describe the path through it.
 *
 * Patterns are plain CSS gradients (world.css, `[data-pattern]`): no images, no blur, no motion.
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
  | 'dots';

export type Mood = 'social' | 'practical' | 'creative' | 'personal' | 'fun';

export type World = {
  /** The second light, opposite the accent. */
  glow: string;
  pattern: Pattern;
  mood: Mood;
  /** The path through the tool, in two or three words a step. */
  journey: string[];
};

export const worlds: Record<ToolId, World> = {
  split: {
    glow: '#f3e3b3',
    pattern: 'receipt',
    mood: 'social',
    journey: ['Snap the receipt', 'Who had what', 'Everyone’s total'],
  },
  subscriptions: {
    glow: '#7ce0c3',
    pattern: 'ledger',
    mood: 'personal',
    journey: ['Pick what you pay for', 'See the real cost', 'Plan what to cut'],
  },
  receipts: { glow: '#b8f35a', pattern: 'receipt', mood: 'practical', journey: [] },
  mileage: { glow: '#8f9bff', pattern: 'dots', mood: 'practical', journey: [] },
  when: {
    glow: '#ff7e5f',
    pattern: 'calendar',
    mood: 'social',
    journey: ['Pick the days', 'Share the link', 'See the overlap'],
  },
  bring: {
    glow: '#ffd166',
    pattern: 'gingham',
    mood: 'social',
    journey: ['List what’s needed', 'Share the link', 'Everyone claims'],
  },
  where: { glow: '#ffd166', pattern: 'dots', mood: 'social', journey: [] },
  plan: { glow: '#ffb35c', pattern: 'confetti', mood: 'social', journey: [] },
  qr: {
    glow: '#5aa9ff',
    pattern: 'pixels',
    mood: 'practical',
    journey: ['Choose a kind', 'Add what it opens', 'Style it', 'Download'],
  },
  'signal-pages': {
    glow: '#ffb38a',
    pattern: 'editorial',
    mood: 'creative',
    journey: ['Pick a look', 'Add your links', 'Share your page'],
  },
  'signal-links': {
    glow: '#ff8ad8',
    pattern: 'editorial',
    mood: 'creative',
    journey: ['Paste your link', 'Say where it goes', 'Copy it'],
  },
  pdf: {
    glow: '#ffc53d',
    pattern: 'pages',
    mood: 'practical',
    journey: ['Pick a job', 'Add your PDFs', 'Download'],
  },
  convert: {
    glow: '#ff6a3d',
    pattern: 'pages',
    mood: 'practical',
    journey: ['Pick a direction', 'Add files', 'Download'],
  },
  clean: {
    glow: '#8f9bff',
    pattern: 'dots',
    mood: 'practical',
    journey: ['Add files', 'Pick the rules', 'Download'],
  },
  duplicates: {
    glow: '#c7b5ff',
    pattern: 'dots',
    mood: 'practical',
    journey: ['Pick a folder', 'Find copies', 'Clean up'],
  },
  resize: {
    glow: '#ff9a62',
    pattern: 'sun',
    mood: 'creative',
    journey: ['Add photos', 'Pick a size', 'Download'],
  },
  'social-crop': {
    glow: '#4fb8ff',
    pattern: 'frames',
    mood: 'creative',
    journey: ['Add a photo', 'Pick the feeds', 'Frame it', 'Export'],
  },
  palette: {
    glow: '#ffd166',
    pattern: 'confetti',
    mood: 'creative',
    journey: ['Drop an image', 'Get its colors', 'Copy them'],
  },
  wishlist: {
    glow: '#46c28e',
    pattern: 'snow',
    mood: 'fun',
    journey: ['Add your wishes', 'Share with givers', 'No duplicates'],
  },
  'secret-santa': { glow: '#ff5e57', pattern: 'snow', mood: 'fun', journey: [] },
};

export const worldOf = (tool: Pick<Tool, 'id'>) => worlds[tool.id];

/** The CSS variables a tool's world is drawn from: `--accent` and `--glow`. */
export function worldStyle(tool: Pick<Tool, 'id' | 'accent'>): CSSProperties {
  return { '--accent': tool.accent, '--glow': worlds[tool.id].glow } as CSSProperties;
}

export const moodLabel: Record<Mood, string> = {
  social: 'With friends',
  practical: 'Get it done',
  creative: 'Make it look good',
  personal: 'Just for you',
  fun: 'Seasonal',
};
