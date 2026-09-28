import * as z from 'zod/mini';

/*
 * Places, without a places service: what Where? and Plan know about somewhere is what a person
 * typed or pasted. A pasted link (Google Maps, Apple Maps, Yelp, OpenTable, Resy, Tripadvisor…)
 * gives the place its name and keeps the link for directions; anything else is a name. Nothing
 * is looked up, so nothing is sent anywhere. Pure and tested (tests/lib-where.spec.ts).
 */

export const placeSchema = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(60)),
  /** A few words under the name: "Italian · West Loop". */
  note: z.string().check(z.maxLength(60)),
  /** Where it came from (a maps or listing link), for directions. Empty when typed. */
  url: z.string().check(z.maxLength(600)),
});
export type Place = z.infer<typeof placeSchema>;

/** The kinds of places a card can show, each with its own little picture. */
export const PLACE_KINDS = [
  'food',
  'drinks',
  'coffee',
  'fun',
  'outdoors',
  'trip',
  'place',
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

const KIND_WORDS: [PlaceKind, RegExp][] = [
  [
    'coffee',
    /\b(coffee|cafe|espresso|roast(ers|ery)?|tea( house)?|bakery|boba|donuts?|brunch|breakfast)\b/i,
  ],
  [
    'drinks',
    /\b(bar|pub|brew(ery|ing|pub)?|tavern|wine|cocktails?|lounge|taproom|speakeasy|saloon|beer|drinks|tiki|izakaya)\b/i,
  ],
  [
    'food',
    /\b(pizza|pizzeria|italian|pasta|trattoria|osteria|sushi|taco|tacos|taqueria|thai|burgers?|bbq|barbecue|restaurant|grill|kitchen|diner|ramen|pho|korean|chinese|indian|mexican|french|bistro|steak(house)?|seafood|noodles?|dumplings?|wings|chicken|mediterranean|greek|vegan|deli|brasserie|cantina|eatery|food|dinner|lunch|curry|bagels?|sandwich(es)?|hot ?pot|dim sum)\b/i,
  ],
  [
    'outdoors',
    /\b(park|beach|trail|hike|hiking|lake|garden|gardens|zoo|picnic|camping|campground|river|forest|mountains?|botanic|pier|waterfront|farm)\b/i,
  ],
  [
    'fun',
    /\b(movies?|cinema|theat(er|re)|museum|bowling|arcade|karaoke|concert|show|mini ?golf|escape room|gallery|comedy|jazz|club|skating|climbing|axe|trivia|games?|aquarium|festival|market|spa|golf)\b/i,
  ],
  [
    'trip',
    /\b(trip|getaway|road trip|weekend|vacation|island|resort|cabin|lake house|city|abroad|airbnb|hotel|coast)\b/i,
  ],
];

/** A place's kind, from its name and note ("Monteverde · Italian" → food). */
export function placeKind(name: string, note = ''): PlaceKind {
  const text = `${name} ${note}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [kind, words] of KIND_WORDS) if (words.test(text)) return kind;
  return 'place';
}

const titleCase = (text: string) =>
  text
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      /^(and|of|the|on|at|de|la|el|di|da|y|a)$/i.test(word)
        ? word.toLowerCase()
        : word[0].toUpperCase() + word.slice(1),
    )
    .join(' ')
    .replace(/^./, (first) => first.toUpperCase());

/** "monteverde-restaurant-chicago-2" → "Monteverde Restaurant Chicago". */
function fromSlug(slug: string) {
  return titleCase(
    decodeURIComponent(slug)
      .replace(/\.html?$/i, '')
      .replace(/[-_+]+/g, ' ')
      .replace(/\s\d+$/, '')
      .trim(),
  );
}

function clean(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 60);
}

const SOURCES: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$/, 'Google Maps'],
  [/(^|\.)maps\.apple\.com$/, 'Apple Maps'],
  [/(^|\.)yelp\.[a-z.]+$/, 'Yelp'],
  [/(^|\.)opentable\.[a-z.]+$/, 'OpenTable'],
  [/(^|\.)resy\.com$/, 'Resy'],
  [/(^|\.)tripadvisor\.[a-z.]+$/, 'Tripadvisor'],
  [/(^|\.)airbnb\.[a-z.]+$/, 'Airbnb'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
];

/** Which service a link is from, in words ("Yelp"), or its web address. */
export function linkSource(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOURCES.find(([pattern]) => pattern.test(host))?.[1] ?? host;
  } catch {
    return '';
  }
}

/** Is this text a web link (with or without https://)? */
export function looksLikeLink(text: string) {
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(text.trim());
}

/**
 * What a person typed or pasted → a place. A link becomes a named place with the link kept for
 * directions; `named: false` says the name is only a guess from the address (worth a look).
 */
export function placeFrom(text: string): (Place & { named: boolean }) | null {
  const raw = text.trim();
  if (!raw) return null;
  if (!looksLikeLink(raw)) return { name: clean(raw), note: '', url: '', named: true };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { name: clean(raw), note: '', url: '', named: true };
  }
  const href = url.toString().slice(0, 600);
  const host = url.hostname.replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  const param = (...names: string[]) => {
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (value?.trim()) return value.trim();
    }
    return '';
  };
  const place = (name: string, note = '') => ({
    name: clean(name) || linkSource(href),
    note: clean(note),
    url: href,
    named: Boolean(clean(name)),
  });

  // Google Maps: /maps/place/Monteverde+Restaurant/@41.8…, or ?q= / ?query=.
  if (/(^|\.)google\.[a-z.]+$/.test(host)) {
    const at = parts.indexOf('place');
    if (at >= 0 && parts[at + 1])
      return place(decodeURIComponent(parts[at + 1].replace(/\+/g, ' ')));
    const query = param('q', 'query');
    if (query) return place(query.split(',')[0], query.split(',').slice(1, 2).join('').trim());
    return place('');
  }
  if (/(^|\.)maps\.apple\.com$/.test(host)) {
    const name = param('name', 'q');
    return place(name.split(',')[0], param('address').split(',')[1] ?? '');
  }
  // Yelp: /biz/monteverde-chicago-2
  if (/(^|\.)yelp\.[a-z.]+$/.test(host) && parts[0] === 'biz' && parts[1])
    return place(fromSlug(parts[1]));
  // OpenTable: /r/monteverde-chicago, or /restaurant/profile/123?…
  if (/(^|\.)opentable\.[a-z.]+$/.test(host) && parts[0] === 'r' && parts[1])
    return place(fromSlug(parts[1]));
  // Resy: /cities/chicago-il/venues/monteverde
  if (/(^|\.)resy\.com$/.test(host)) {
    const venue = parts.indexOf('venues');
    const city = parts.indexOf('cities');
    if (venue >= 0 && parts[venue + 1])
      return place(
        fromSlug(parts[venue + 1]),
        city >= 0 && parts[city + 1] ? fromSlug(parts[city + 1].replace(/-[a-z]{2}$/i, '')) : '',
      );
  }
  // Tripadvisor: Restaurant_Review-g35805-d1234-Reviews-Monteverde-Chicago_Illinois.html
  if (/(^|\.)tripadvisor\.[a-z.]+$/.test(host)) {
    const match = url.pathname.match(/-Reviews-(.+?)-([^-]+)\.html/);
    if (match) return place(fromSlug(match[1]), fromSlug(match[2].split('_')[0]));
  }
  if (/^maps\.app\.goo\.gl$|^goo\.gl$/.test(host)) return place('');
  // Anything else: the site's own name ("monteverdechicago.com" → "Monteverdechicago").
  const label = host.split('.').slice(-2, -1)[0] ?? host;
  return { ...place(titleCase(label.replace(/-/g, ' '))), named: false };
}

/** Directions to a place: its own maps link when it has one, otherwise a maps search. */
export function directionsUrl(place: Pick<Place, 'name' | 'note' | 'url'>) {
  const source = place.url ? linkSource(place.url) : '';
  if (source === 'Google Maps' || source === 'Apple Maps') return place.url;
  const query = [place.name, place.note].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
