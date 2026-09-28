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
