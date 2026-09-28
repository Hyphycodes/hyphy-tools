import type { ModeId, Tool, ToolId } from './schema';
import { categories, families } from './taxonomy';

/**
 * Marketplace search, in people's words. "split dinner" finds Split, "when are my friends free"
 * finds When?, "instagram size" finds Social Crop, "linktree" finds Signal Pages. Nobody should
 * need to know what Hyphy calls something to find it.
 *
 * Each tool becomes a small document of weighted fields (its name, what it is, the names people
 * know it by, the phrases they search, its words). A query is normalized the same way, expanded
 * with a few everyday synonyms, and scored by how many of its words land and where: typos
 * (one or two letters off), word endings and half-typed words all count. Runs anywhere; the
 * marketplace runs it in the browser as you type.
 */

export type SearchResult = {
  tool: Tool;
  score: number;
  /** When a tool matched through a name people know it by: "linktree". */
  because?: string;
};

type Field = { words: string[]; phrases: string[]; weight: number; label?: string };
type Doc = { tool: Tool; fields: Field[]; phrases: { text: string; label: string }[] };

/* ---------------- words ---------------- */

/** Words that carry no intent on their own. "when" and "where" are tools, so they stay. */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'my',
  'our',
  'your',
  'their',
  'to',
  'for',
  'of',
  'and',
  'or',
  'in',
  'on',
  'at',
  'with',
  'from',
  'into',
  'some',
  'any',
  'all',
  'i',
  'im',
  'we',
  'me',
  'us',
  'it',
  'is',
  'are',
  'be',
  'do',
  'does',
  'did',
  'how',
  'can',
  'could',
  'should',
  'would',
  'want',
  'need',
  'help',
  'please',
  'make',
  'get',
  'find',
  'create',
  'something',
  'thing',
  'things',
  'tool',
  'tools',
  'app',
  'this',
  'that',
  'these',
  'those',
  'so',
  'just',
  'up',
  'out',
  'what',
  'which',
  'who',
  'way',
]);

/**
 * Everyday words that mean the same thing here. Each group maps to its first word; queries and
 * documents both go through it, so "photos" and "pictures" meet.
 */
const SYNONYMS: string[][] = [
  ['photo', 'image', 'picture', 'pic', 'img', 'jpg', 'jpeg', 'selfie', 'png', 'webp'],
  ['bill', 'check', 'tab', 'dinner', 'meal', 'restaurant', 'lunch', 'brunch', 'drinks'],
  ['split', 'divide', 'share', 'owe', 'splitting'],
  ['friend', 'group', 'everyone', 'people', 'family', 'team', 'crew', 'guest'],
  ['free', 'available', 'availability', 'open', 'schedule'],
  ['file', 'document', 'doc', 'folder'],
  ['rename', 'name', 'filename', 'renaming'],
  ['duplicate', 'copy', 'copies', 'dupe', 'twice', 'identical'],
  ['small', 'smaller', 'shrink', 'reduce', 'compress', 'lighter'],
  ['size', 'dimension', 'resize', 'fit'],
  ['color', 'colour', 'hex', 'palette', 'swatch'],
  ['link', 'url', 'address'],
  ['subscription', 'recurring', 'membership', 'renewal', 'streaming'],
  ['party', 'cookout', 'bbq', 'barbecue', 'potluck', 'gathering', 'hangout'],
  ['gift', 'present', 'wishlist', 'wish'],
  ['wifi', 'wi-fi', 'wireless', 'network', 'password'],
  ['time', 'date', 'day', 'calendar', 'meet', 'meeting'],
  ['eat', 'food', 'hungry', 'cuisine', 'restaurant'],
  ['instagram', 'insta', 'ig'],
  ['x', 'twitter'],
  ['pdf', 'pdfs'],
  ['track', 'tracking', 'trackable', 'utm', 'campaign'],
  ['crop', 'frame', 'trim'],
];

const canonical = new Map<string, string>();
for (const group of SYNONYMS)
  for (const word of group) if (!canonical.has(stem(word))) canonical.set(stem(word), group[0]);

/** A light stemmer: enough to meet "photos" with "photo" and "renaming" with "rename". */
function stem(word: string) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  return word;
}

/** Lowercase, accents and punctuation out, one space between words. */
export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(text: string, keepStopwords = false) {
  return normalize(text)
    .split(' ')
    .filter((word) => word && (keepStopwords || !STOPWORDS.has(word)))
    .map(stem);
}

const concept = (word: string) => canonical.get(word) ?? word;

/** Optimal-string-alignment distance, stopping early once it passes `limit`. */
function distance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i += 1) {
    let best = Infinity;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > limit) return limit + 1;
  }
  return d[a.length][b.length];
}

/* ---------------- intents ---------------- */

/**
 * Searching by what's going on, not by a tool's name. When the whole query is one of these
 * phrases, its tools come first in this order: "dinner" is Split, Where?, When? and Plan;
 * "instagram" is Social Crop, Resize and Palette. Deterministic on purpose: the same words always
 * give the same answer. Phrases go through the same words as queries (stems, synonyms), so
 * "insta" and "receipts" land too.
 */
const INTENTS: { phrases: string[]; tools: ToolId[] }[] = [
  {
    phrases: ['dinner', 'dinner with friends', 'going out', 'night out', 'drinks'],
    tools: ['split', 'where', 'when', 'plan'],
  },
  {
    phrases: ['instagram', 'social media', 'posting', 'post a photo', 'tiktok', 'reels', 'story'],
    tools: ['social-crop', 'resize', 'palette'],
  },
  { phrases: ['receipt', 'receipts'], tools: ['receipts', 'split'] },
  {
    phrases: ['work mileage', 'business miles', 'miles for work', 'drive for work'],
    tools: ['mileage', 'receipts'],
  },
  { phrases: ['merge', 'combine', 'join'], tools: ['pdf', 'convert'] },
  {
    phrases: ['make smaller', 'smaller', 'too big', 'shrink', 'compress', 'file too large'],
    tools: ['resize', 'pdf'],
  },
  {
    phrases: ['birthday', 'birthday party', 'get together'],
    tools: ['plan', 'when', 'where', 'bring'],
  },
  {
    phrases: ['christmas', 'holidays', 'gift exchange'],
    tools: ['secret-santa', 'wishlist'],
  },
  { phrases: ['trip', 'vacation', 'road trip', 'weekend away'], tools: ['plan', 'when', 'split'] },
  { phrases: ['menu', 'restaurant menu'], tools: ['qr', 'signal-pages'] },
  {
    phrases: ['expenses', 'taxes', 'tax time', 'bookkeeping'],
    tools: ['receipts', 'mileage', 'subscriptions'],
  },
];

const intentKey = (text: string) => words(text).map(concept).join(' ');
const intentIndex = new Map<string, { label: string; tools: ToolId[] }>();
for (const intent of INTENTS)
  for (const phrase of intent.phrases)
    if (!intentIndex.has(intentKey(phrase)))
      intentIndex.set(intentKey(phrase), { label: phrase, tools: intent.tools });

/** The intent a whole query names, if any. */
export function intentOf(query: string) {
  const key = intentKey(query);
  return key ? (intentIndex.get(key) ?? null) : null;
}

/* ---------------- documents ---------------- */

const docs = new WeakMap<readonly Tool[], Doc[]>();

function field(texts: string[], weight: number, label?: string): Field {
  // Both the word as written and its everyday meaning, so "pict" still finds "picture".
  const written = texts.flatMap((text) => words(text));
  return {
    words: [...new Set([...written, ...written.map(concept)])],
    phrases: texts.map(normalize),
    weight,
    label,
  };
}

function documentsFor(list: readonly Tool[]): Doc[] {
  const cached = docs.get(list);
  if (cached) return cached;
  const built = list.map((tool) => {
    const category = categories.find((item) => item.id === tool.category);
    const family = families.find((item) => item.id === tool.family);
    return {
      tool,
      fields: [
        field([tool.name], 10),
        field(tool.aliases, 8, 'alias'),
        field([tool.kind], 6),
        field(tool.keywords, 5, 'keyword'),
        field([tool.tagline], 2.5),
        field([category?.name ?? '', family?.name ?? '', tool.drop ? 'drop drops' : ''], 2),
        field([tool.description], 1.2),
      ],
      phrases: [
        ...tool.aliases.map((text) => ({ text: normalize(text), label: text })),
        ...tool.keywords.map((text) => ({ text: normalize(text), label: text })),
        { text: normalize(tool.kind), label: tool.kind },
      ],
    };
  });
  docs.set(list, built);
  return built;
}

/** How well one query word lands in one field: exact, synonym, prefix, then a typo. */
function hit(word: string, raw: string, field: Field, last: boolean) {
  let best = 0;
  for (const candidate of field.words) {
    if (candidate === word || candidate === raw) return 1;
    if (raw.length >= 3 && candidate.startsWith(raw) && (last || raw.length >= 4))
      best = Math.max(best, 0.8);
    else if (raw.length >= 3 && candidate.length >= 4) {
      const limit = raw.length >= 8 ? 2 : 1;
      if (distance(raw, candidate, limit) <= limit) best = Math.max(best, 0.6);
    }
  }
  return best;
}

export type SearchOptions = {
  /** The mode someone is in: its tools win ties, nothing else is hidden. */
  mode?: ModeId | null;
};

/**
 * Tools that answer the query, best first. An empty query returns nothing: the marketplace
 * shows its own order then.
 */
export function searchTools(
  query: string,
  list: readonly Tool[],
  limit = 8,
  options: SearchOptions = {},
): SearchResult[] {
  const typed = normalize(query);
  if (!typed) return [];
  const raws = words(query);
  // "how", "the", "my"… alone still deserve an answer: fall back to every word.
  const tokens = raws.length ? raws : words(query, true);
  if (!tokens.length) return [];
  const concepts = tokens.map(concept);
  const endsWithSpace = /\s$/.test(query);

  const results: SearchResult[] = [];
  for (const doc of documentsFor(list)) {
    let score = 0;
    let matched = 0;
    let named = false;
    let because: string | undefined;
    tokens.forEach((raw, index) => {
      const word = concepts[index];
      const last = index === tokens.length - 1 && !endsWithSpace;
      let best = 0;
      doc.fields.forEach((item, position) => {
        const strength = hit(word, raw, item, last);
        if (position === 0 && strength >= 0.8) named = true;
        best = Math.max(best, strength * item.weight);
      });
      if (best > 0) matched += 1;
      score += best;
    });
    if (!matched) continue;

    // Whole phrases people type ("split dinner", "instagram size") beat scattered words.
    for (const phrase of doc.phrases) {
      if (!phrase.text) continue;
      const exact = phrase.text === typed;
      const contained =
        typed.length >= 4 && (phrase.text.includes(typed) || typed.includes(phrase.text));
      if (exact || contained) {
        const bonus = exact ? 14 : phrase.text.split(' ').length > 1 ? 9 : 6;
        if (bonus > 0) {
          score += bonus;
          because ??= phrase.label;
        }
        break;
      }
    }
    // Exact name match, "Split" or "When?", goes straight to the top.
    if (normalize(doc.tool.name) === typed) score += 30;

    // Every word should count: a tool that answers half the question ranks below one that
    // answers all of it.
    const coverage = matched / tokens.length;
    score *= coverage * coverage;
    // Tools you can open today edge out ones that are coming.
    if (doc.tool.status === 'soon') score *= 0.82;
    if (score < 2.5) continue;

    // Say why only when the name itself didn't answer: "Signal Pages · for “linktree”".
    results.push({ tool: doc.tool, score, because: named ? undefined : because });
  }

  // A query that names a situation ("dinner", "instagram") puts its tools first, in its order.
  const intent = intentOf(query);
  if (intent)
    for (const id of intent.tools)
      if (!results.some((result) => result.tool.id === id)) {
        const tool = list.find((item) => item.id === id);
        if (tool) results.push({ tool, score: 0, because: intent.label });
      }

  // The mode someone is in breaks near-ties toward its own tools, gently.
  const mode = options.mode;
  if (mode) for (const result of results) if (result.tool.modes[mode]) result.score *= 1.12;

  const rank = (id: ToolId) => {
    const order = intent ? intent.tools.indexOf(id) : -1;
    return order < 0 ? Infinity : order;
  };
  return results
    .sort(
      (a, b) =>
        rank(a.tool.id) - rank(b.tool.id) || b.score - a.score || a.tool.priority - b.tool.priority,
    )
    .slice(0, limit);
}
