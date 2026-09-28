import type { Category, CategoryId, Family, FamilyId } from './schema';

/**
 * Categories answer "what does it help with?" in the words people use. Every tool has exactly one,
 * and the marketplace filters by them.
 */
export const categories: Category[] = [
  {
    id: 'together',
    name: 'Get together',
    line: 'Plans, people and who’s bringing what.',
    icon: 'people',
  },
  {
    id: 'money',
    name: 'Money',
    line: 'Checks, subscriptions and where it all goes.',
    icon: 'wallet',
  },
  {
    id: 'links',
    name: 'Links & QR',
    line: 'Get people exactly where you want them.',
    icon: 'link',
  },
  { id: 'images', name: 'Images', line: 'Photos, ready for anywhere.', icon: 'image' },
  {
    id: 'files',
    name: 'Files & PDF',
    line: 'Paperwork and piles of files, sorted.',
    icon: 'files',
  },
  {
    id: 'business',
    name: 'Business',
    line: 'For teams. Arriving with Hyphy accounts.',
    icon: 'building',
  },
];

/**
 * Families are Hyphy's branded worlds: contextual, never a wall. Every tool in a family still
 * appears on its own in search and in its category.
 */
export const families: Family[] = [
  {
    id: 'gather',
    name: 'Gather',
    line: 'Tools for getting people coordinated.',
    story:
      'Plans fall apart in the group chat. Gather keeps them together: when everyone’s free, where you’re going, and who’s bringing what. Each one is a single link, and nobody needs an account.',
    accent: '#ffb35c',
  },
  {
    id: 'signal',
    name: 'Signal',
    line: 'Links, pages and codes that get people where you want them.',
    story:
      'Everything that sends someone somewhere: a page for your bio, a code for the table tent, a link that tells you which post worked. Designed to look like you, not like everyone else.',
    accent: '#8f9bff',
  },
  {
    id: 'image-lab',
    name: 'Image Lab',
    line: 'Photos sized, framed and sampled on your device.',
    story:
      'Make a photo fit anywhere without handing it to a stranger’s server. Resize it, frame it for every feed, or pull a palette out of it, all in your browser.',
    accent: '#ffc53d',
  },
  {
    id: 'file-lab',
    name: 'File Lab',
    line: 'Practical file tools that never upload your files.',
    story:
      'The chores nobody wants: merging paperwork, renaming a camera roll, finding the copies eating your drive. File Lab does them on your device, and shows you every change before it happens.',
    accent: '#c7b5ff',
  },
];

const categoryIndex = new Map(categories.map((category) => [category.id, category]));
const familyIndex = new Map(families.map((family) => [family.id, family]));

export function getCategory(id: CategoryId): Category {
  return categoryIndex.get(id)!;
}

export function getFamily(id: FamilyId): Family {
  return familyIndex.get(id)!;
}
