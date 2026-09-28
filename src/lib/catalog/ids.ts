/*
 * The catalog's closed lists, with no dependencies, so any page can import them.
 */

/** Every tool Hyphy has registered. Adding a tool starts here. */
export const TOOL_IDS = [
  'split',
  'when',
  'bring',
  'where',
  'plan',
  'qr',
  'signal-pages',
  'signal-links',
  'pdf',
  'convert',
  'clean',
  'duplicates',
  'resize',
  'social-crop',
  'palette',
  'subscriptions',
  'receipts',
  'mileage',
  'wishlist',
  'secret-santa',
] as const;

export const CATEGORY_IDS = ['together', 'money', 'links', 'images', 'files', 'business'] as const;

export const FAMILY_IDS = ['gather', 'signal', 'file-lab', 'image-lab'] as const;

/**
 * Modes are lenses over the same tools, never permissions: a tool can sit in several, and "all"
 * (show me everything) sees every tool.
 */
export const MODE_IDS = ['everyday', 'create', 'work'] as const;

/**
 * How much room a tool deserves: an experience (collaborative or kept over time), a focused tool,
 * or a quick tool (a tiny instant action that will live in a compact drawer, not a big card).
 */
export const TIER_IDS = ['experience', 'tool', 'quick'] as const;
