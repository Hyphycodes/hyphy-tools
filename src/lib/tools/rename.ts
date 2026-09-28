import { csv } from '@/lib/files/download';

/*
 * Clean: the renaming rules, as pure functions over names, so the preview is exactly what the zip
 * gets. Rules run in order on the name without its extension; only "extension case" touches the
 * extension. The result is then made safe for every system: characters some systems reject become
 * "_", a name the rules emptied keeps its old one, and clashes get " (2)", " (3)"… the same way
 * the zip writer would. Pure and tested (tests/lib-rename.spec.ts).
 */

export const MAX_FILES = 1000;
export const MAX_BYTES = 1024 * 1024 * 1024;
/** Longer names are flagged: they break on some systems, and most folders can't show them. */
export const MAX_NAME = 200;

export type RenameFile = {
  name: string;
  /** Where it sits inside a chosen folder ("Trip/Day 1"); empty for files chosen one by one. */
  folder: string;
  size: number;
  /** Last modified, in milliseconds. */
  modified: number;
};

/** The order files are numbered in (and listed in, once there's a numbering rule). */
export type Order = 'added' | 'name' | 'modified' | 'size';
export type Place = 'start' | 'end';

type Base = { id: string; on: boolean };
export type Rule = Base &
  (
    | { type: 'replace'; find: string; with: string; matchCase: boolean; pattern: boolean }
    | { type: 'strip'; plain: boolean }
    | { type: 'spaces'; to: ' ' | '-' | '_' }
    | { type: 'case'; to: 'lower' | 'upper' | 'title' | 'sentence' }
    | { type: 'prefix'; text: string }
    | { type: 'suffix'; text: string }
    | {
        type: 'number';
        start: number;
        step: number;
        /** Zero-padding: 0 means enough digits for the batch (at least 2). */
        digits: number;
        at: Place;
        separator: string;
        order: Order;
        /** When set, replaces each name before the number is added ("Kitchen 01"). */
        name: string;
      }
    | { type: 'date'; at: Place; separator: string }
    | { type: 'extension'; to: 'keep' | 'lower' | 'upper' }
  );
export type RuleType = Rule['type'];

export const RULE_TYPES: RuleType[] = [
  'replace',
  'strip',
  'spaces',
  'case',
  'prefix',
  'suffix',
  'number',
  'date',
  'extension',
];

export function newRule(type: RuleType, id: string): Rule {
  switch (type) {
    case 'replace':
      return { id, on: true, type, find: '', with: '', matchCase: false, pattern: false };
    case 'strip':
      return { id, on: true, type, plain: false };
    case 'spaces':
      return { id, on: true, type, to: ' ' };
    case 'case':
      return { id, on: true, type, to: 'lower' };
    case 'prefix':
    case 'suffix':
      return { id, on: true, type, text: '' };
    case 'number':
      return {
        id,
        on: true,
        type,
        start: 1,
        step: 1,
        digits: 0,
        at: 'end',
        separator: ' ',
        order: 'name',
        name: '',
      };
    case 'date':
      return { id, on: true, type, at: 'start', separator: ' ' };
    case 'extension':
      return { id, on: true, type, to: 'lower' };
  }
}

/** Where a new stack starts: one find & replace, waiting for something to find. */
export const START_RULES: Rule[] = [newRule('replace', 'start')];

export type PresetId = 'dates' | 'web' | 'number';
export const PRESETS: { id: PresetId; name: string; example: string }[] = [
  { id: 'dates', name: 'Camera roll → dates', example: '2026-05-03 IMG_2041.jpg' },
  { id: 'web', name: 'Clean for the web', example: 'salt-ember-menu-final.pdf' },
  { id: 'number', name: 'Number a batch', example: 'Batch 01.jpg, Batch 02.jpg' },
];

/** Names straight off a camera or a phone: IMG_2041, DSC_0042, PXL_2026…, Screenshot 2026-05-04. */
const CAMERA_NAME =
  /^(img|dsc[nf]?|pxl|mvimg|vid|mov|gopr|dji|p\d{3}|screenshot|screen shot|photo|whatsapp image)(?=[\s_-]?\d|[\s_-])/i;

/**
 * The quick fix most likely wanted for these names: mostly camera and screenshot names get their
 * dates, anything else is cleaned for the web. A guess to start from; every rule stays editable.
 */
export function suggestPreset(names: string[]): PresetId {
  if (!names.length) return 'web';
  const camera = names.filter((name) => CAMERA_NAME.test(name)).length;
  return camera / names.length >= 0.6 ? 'dates' : 'web';
}

/** A preset's rules: a starting point, every rule still editable. */
export function presetRules(preset: PresetId, batchName = 'Batch'): Rule[] {
  const id = (index: number) => `${preset}-${index}`;
  switch (preset) {
    case 'dates':
      return [
        { id: id(1), on: true, type: 'date', at: 'start', separator: ' ' },
        { id: id(2), on: true, type: 'extension', to: 'lower' },
      ];
    case 'web':
      return [
        {
          id: id(1),
          on: true,
          type: 'replace',
          find: '_',
          with: ' ',
          matchCase: false,
          pattern: false,
        },
        { id: id(2), on: true, type: 'strip', plain: true },
        { id: id(3), on: true, type: 'case', to: 'lower' },
        { id: id(4), on: true, type: 'spaces', to: '-' },
        { id: id(5), on: true, type: 'extension', to: 'lower' },
      ];
    case 'number':
      return [
        {
          id: id(1),
          on: true,
          type: 'number',
          start: 1,
          step: 1,
          digits: 0,
          at: 'end',
          separator: ' ',
          order: 'name',
          name: batchName,
        },
        { id: id(2), on: true, type: 'extension', to: 'lower' },
      ];
  }
}

/* ---------------- names ---------------- */

// "archive.tar.gz" is one extension; otherwise the last dot, when what follows looks like one.
const DOUBLE_EXTENSION = /\.(tar\.(?:gz|bz2|xz|zst))$/i;
const EXTENSION = /\.([\p{L}\p{N}_+~-]{1,12})$/u;

/** "IMG_2041.JPG" → { base: "IMG_2041", extension: "JPG" }. Dotfiles have no extension. */
export function splitName(name: string) {
  const match = DOUBLE_EXTENSION.exec(name) ?? EXTENSION.exec(name);
  if (!match || match.index === 0) return { base: name, extension: '' };
  return { base: name.slice(0, match.index), extension: match[1] };
}

export const joinName = (base: string, extension: string) =>
  extension ? `${base}.${extension}` : base;

/** "Trip/Day 1/IMG_2041.JPG" (a folder pick's relative path) → "Trip/Day 1". */
export function folderOf(relativePath: string) {
  const cut = relativePath.lastIndexOf('/');
  return cut > 0 ? relativePath.slice(0, cut) : '';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Natural order: IMG_2 before IMG_10. */
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

/** File positions in the given order; ties keep the order they were added in. */
export function orderFiles(files: RenameFile[], order: Order): number[] {
  const indexes = files.map((_, index) => index);
  if (order === 'added') return indexes;
  const path = (index: number) =>
    files[index].folder ? `${files[index].folder}/${files[index].name}` : files[index].name;
  const byName = (a: number, b: number) => naturalCompare(path(a), path(b));
  const compare =
    order === 'name'
      ? byName
      : order === 'modified'
        ? (a: number, b: number) => files[a].modified - files[b].modified || byName(a, b)
        : (a: number, b: number) => files[a].size - files[b].size || byName(a, b);
  return indexes.sort((a, b) => compare(a, b) || a - b);
}

/** A file's last-modified day, in this device's time zone: 2026-05-03. */
export function dayOf(time: number) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ---------------- the rules ---------------- */

// Emoji selectors and keycaps belong to the emoji, not to the word before them.
const EMOJI_PARTS = /[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{20E3}]/gu;
// Letters (with their accents), digits, spaces and - _ . ( ) stay; everything else goes.
const ODD = /[^\p{L}\p{M}\p{Nd} ._()-]/gu;
// An accent whose letter was removed (it would sit on nothing).
const LOOSE_MARKS = /(^|[^\p{L}\p{M}])\p{M}+/gu;

/** Removes emoji, symbols and invisible characters. `plain` also turns é into e. */
export function stripOdd(text: string, plain = false) {
  let clean = text.normalize('NFC').replace(EMOJI_PARTS, '').replace(/\s/gu, ' ');
  if (plain) clean = clean.normalize('NFD').replace(/\p{M}/gu, '');
  return clean.replace(ODD, '').replace(LOOSE_MARKS, '$1').normalize('NFC');
}

/** Trims, turns runs of spaces into one, and optionally spaces into - or _ ("a - b" → "a-b"). */
export function tidySpaces(text: string, to: ' ' | '-' | '_' = ' ') {
  const tidy = text.replace(/\s+/gu, ' ').trim();
  return to === ' ' ? tidy : tidy.replace(/[ _-]* [ _-]*/g, to);
}

// A word starts at the beginning, or after a space, a dash, an underscore, a dot or a bracket.
const WORD_START = /(^|[\s_.([{-])(\p{L})/gu;

export function changeCase(text: string, to: 'lower' | 'upper' | 'title' | 'sentence') {
  switch (to) {
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'title':
      return text
        .toLowerCase()
        .replace(WORD_START, (_, before: string, letter: string) => before + letter.toUpperCase());
    case 'sentence':
      return text.toLowerCase().replace(/\p{L}/u, (letter) => letter.toUpperCase());
  }
}

/** Puts `piece` before or after `base`, with the separator only when both are there. */
function attach(base: string, piece: string, at: Place, separator: string) {
  if (!base.trim()) return piece;
  return at === 'start' ? `${piece}${separator}${base}` : `${base}${separator}${piece}`;
}

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Unbounded or ranged repeats. "?" (at most once) and {3} (exactly three) are safe.
const REPEAT = /^(?:[*+]|\{\d+,\d*\})/;

/**
 * Patterns that repeat something which itself repeats or branches, like (a+)+ or (a|ab)*, can
 * take ages to fail on a long name, and a running regular expression can't be stopped. Those are
 * refused with a plain explanation instead of freezing the page.
 */
export function riskyPattern(source: string) {
  // One entry per open group: does it hold a repeat or a branch?
  const groups: boolean[] = [];
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
    } else if (inClass) {
      if (char === ']') inClass = false;
    } else if (char === '[') {
      inClass = true;
    } else if (char === '(') {
      groups.push(false);
      // (?: (?= (?<name> … are group syntax, not "maybe".
      if (source[index + 1] === '?') index += 1;
    } else if (char === ')') {
      const inner = groups.pop() ?? false;
      const repeated = REPEAT.test(source.slice(index + 1));
      if (inner && repeated) return true;
      if ((inner || repeated) && groups.length) groups[groups.length - 1] = true;
    } else if ((char === '|' || REPEAT.test(source.slice(index))) && groups.length) {
      groups[groups.length - 1] = true;
    }
  }
  return false;
}

/** Tries Unicode mode first (so an emoji is one character), then the classic syntax. */
function compilePattern(source: string, flags: string) {
  try {
    return new RegExp(source, `${flags}u`);
  } catch {
    return new RegExp(source, flags);
  }
}

type Parts = { base: string; extension: string };
type Step = (parts: Parts, file: RenameFile, index: number) => void;

function stepFor(
  rule: Rule,
  count: number,
  rankOf: (order: Order) => number[],
): Step | { error: string } | null {
  switch (rule.type) {
    case 'replace': {
      if (!rule.find) return null;
      const flags = rule.matchCase ? 'g' : 'gi';
      if (!rule.pattern) {
        // Plain text: what's typed is found and inserted exactly, "$" and all.
        const find = new RegExp(escapePattern(rule.find), `${flags}u`);
        return (parts) => {
          parts.base = parts.base.replace(find, () => rule.with);
        };
      }
      if (riskyPattern(rule.find))
        return {
          error:
            'A repeat inside a repeat, like (a+)+, can freeze the page. Simplify it: a+ finds the same thing.',
        };
      try {
        const find = compilePattern(rule.find, flags);
        return (parts) => {
          parts.base = parts.base.replace(find, rule.with);
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message.split(': ').pop() : '';
        return {
          error: `This pattern doesn’t work${detail ? ` (${detail})` : ''}. Check its brackets and backslashes, or turn off Pattern to find plain text.`,
        };
      }
    }
    case 'strip':
      return (parts) => {
        parts.base = stripOdd(parts.base, rule.plain);
      };
    case 'spaces':
      return (parts) => {
        parts.base = tidySpaces(parts.base, rule.to);
      };
    case 'case':
      return (parts) => {
        parts.base = changeCase(parts.base, rule.to);
      };
    case 'prefix':
      return rule.text
        ? (parts) => {
            parts.base = rule.text + parts.base;
          }
        : null;
    case 'suffix':
      return rule.text
        ? (parts) => {
            parts.base += rule.text;
          }
        : null;
    case 'number': {
      const start = Math.max(0, Math.floor(rule.start) || 0);
      const step = Math.max(1, Math.floor(rule.step) || 1);
      const digits =
        rule.digits > 0
          ? Math.floor(rule.digits)
          : Math.max(2, String(start + Math.max(0, count - 1) * step).length);
      const rank = rankOf(rule.order);
      const name = rule.name.trim() ? rule.name : '';
      return (parts, _file, index) => {
        const number = String(start + rank[index] * step).padStart(digits, '0');
        parts.base = attach(name || parts.base, number, rule.at, rule.separator);
      };
    }
    case 'date':
      return (parts, file) => {
        parts.base = attach(parts.base, dayOf(file.modified), rule.at, rule.separator);
      };
    case 'extension':
      if (rule.to === 'keep') return null;
      return (parts) => {
        parts.extension =
          rule.to === 'lower' ? parts.extension.toLowerCase() : parts.extension.toUpperCase();
      };
  }
}

/* ---------------- the plan ---------------- */

// What Windows, macOS or Linux refuse inside a name. A "/" would also make a folder in the zip.
const REJECTED = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
// Names Windows keeps for devices, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** A name every system accepts: rejected characters become "_", no dots or spaces at the end. */
export function legalize(name: string) {
  return name
    .replace(REJECTED, '_')
    .trim()
    .replace(/[. ]+$/, '');
}

/**
 * Why a new name needs a look:
 * - duplicate: another file would get the same name, so " (2)" was added;
 * - empty: the rules left nothing, so it keeps its old name;
 * - long: over 200 characters (or 255 bytes), which some systems can't open;
 * - chars: characters some systems reject were replaced with "_" (or dropped from the end);
 * - reserved: a name Windows keeps for itself, like CON or NUL.
 */
export type Problem = 'duplicate' | 'empty' | 'long' | 'chars' | 'reserved';

export type RenameRow = {
  /** Where the file is in the list as it was added. */
  index: number;
  before: string;
  after: string;
  folder: string;
  /** Where the renamed copy goes in the zip: its folder (when kept) and its new name. */
  path: string;
  changed: boolean;
  problems: Problem[];
};

export type RenamePlan = {
  /** In numbering order when a numbering rule is on, otherwise as added. */
  rows: RenameRow[];
  changed: number;
  /** Rows with at least one problem. */
  attention: number;
  /** Rules skipped because their pattern doesn't work, by rule id. */
  errors: Record<string, string>;
};

const encoder = new TextEncoder();

export function planRenames(
  files: RenameFile[],
  rules: Rule[],
  { keepFolders = true }: { keepFolders?: boolean } = {},
): RenamePlan {
  const ranks = new Map<Order, number[]>();
  const rankOf = (order: Order) => {
    let rank = ranks.get(order);
    if (!rank) {
      const positions: number[] = [];
      orderFiles(files, order).forEach((index, position) => (positions[index] = position));
      ranks.set(order, positions);
      rank = positions;
    }
    return rank;
  };

  const errors: Record<string, string> = {};
  const steps: Step[] = [];
  for (const rule of rules) {
    if (!rule.on) continue;
    const step = stepFor(rule, files.length, rankOf);
    if (typeof step === 'function') steps.push(step);
    else if (step) errors[rule.id] = step.error;
  }

  const numbering = rules.find((rule) => rule.on && rule.type === 'number');
  const order = orderFiles(files, numbering?.type === 'number' ? numbering.order : 'added');
  const used = new Set<string>();
  const rows = order.map((index): RenameRow => {
    const file = files[index];
    const parts = splitName(file.name);
    for (const step of steps) step(parts, file, index);
    const joined = joinName(parts.base, parts.extension);
    let after = legalize(joined);
    let problems: Problem[] = after !== joined.trim() ? ['chars'] : [];
    if (!parts.base.trim() || !after) {
      problems = ['empty'];
      after = legalize(file.name) || 'file';
    }

    // Clashes are judged the way file systems judge them: ignoring capitals, per folder.
    const folder =
      keepFolders && file.folder
        ? file.folder
            .split('/')
            .map((part) => legalize(part) || '_')
            .join('/')
        : '';
    const key = (name: string) => `${folder}/${name}`.toLowerCase();
    if (used.has(key(after))) {
      const { base, extension } = splitName(after);
      let counter = 2;
      while (used.has(key(joinName(`${base} (${counter})`, extension)))) counter += 1;
      after = joinName(`${base} (${counter})`, extension);
      problems.push('duplicate');
    }
    used.add(key(after));

    if (Array.from(after).length > MAX_NAME || encoder.encode(after).length > 255)
      problems.push('long');
    if (RESERVED.test(after)) problems.push('reserved');
    return {
      index,
      before: file.name,
      after,
      folder: file.folder,
      path: folder ? `${folder}/${after}` : after,
      changed: after !== file.name,
      problems,
    };
  });

  return {
    rows,
    changed: rows.filter((row) => row.changed).length,
    attention: rows.filter((row) => row.problems.length).length,
    errors,
  };
}

/** The rename list: every file's old place and its new one, for a spreadsheet or a script. */
export function renameList(plan: RenamePlan) {
  return csv([
    ['old', 'new'],
    ...plan.rows.map((row) => [row.folder ? `${row.folder}/${row.before}` : row.before, row.path]),
  ]);
}

/* ---------------- what changed ---------------- */

export type DiffPart = { text: string; changed: boolean };

function toParts(chars: string[], marks: boolean[]) {
  const parts: DiffPart[] = [];
  chars.forEach((char, index) => {
    const last = parts[parts.length - 1];
    if (last && last.changed === marks[index]) last.text += char;
    else parts.push({ text: char, changed: marks[index] });
  });
  return parts;
}

/**
 * Which characters changed between an old and a new name, for highlighting: what was removed
 * from the old one, what was added in the new one. It anchors on the longest run both names
 * share, then does the same on either side of it (Ratcliff/Obershelp, as in Python's difflib),
 * which is how people compare two names: "IMG_2041" is found whole inside "2026-05-03 IMG_2041",
 * rather than a scattering of matching digits.
 */
export function diffNames(before: string, after: string) {
  const a = Array.from(before);
  const b = Array.from(after);
  // Runs both names share, in order: [start in a, start in b, length].
  const anchors: [number, number, number][] = [];

  const compare = (aStart: number, aEnd: number, bStart: number, bEnd: number) => {
    let best = 0;
    let bestA = aStart;
    let bestB = bStart;
    // Very long, very different names aren't worth comparing letter by letter.
    if ((aEnd - aStart) * (bEnd - bStart) <= 40_000) {
      let previous = new Uint16Array(bEnd - bStart + 1);
      for (let i = aStart; i < aEnd; i += 1) {
        const current = new Uint16Array(bEnd - bStart + 1);
        for (let j = bStart; j < bEnd; j += 1) {
          if (a[i] !== b[j]) continue;
          const run = previous[j - bStart] + 1;
          current[j - bStart + 1] = run;
          if (run > best) {
            best = run;
            bestA = i - run + 1;
            bestB = j - run + 1;
          }
        }
        previous = current;
      }
    }
    // A single shared character in the middle of a change is a coincidence, not a match.
    if (best < 2) return;
    compare(aStart, bestA, bStart, bestB);
    anchors.push([bestA, bestB, best]);
    compare(bestA + best, aEnd, bestB + best, bEnd);
  };

  // What both names start and end with stays unmarked, even a single character.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  compare(start, endA, start, endB);

  // A shared run no longer than the changes on both sides of it is a coincidence too ("ip" in
  // "receipt" and "Trip"): count it as changed, the way diff-match-patch's semantic cleanup does.
  for (let index = 0; index < anchors.length;) {
    const [atA, atB, length] = anchors[index];
    const [lastA, lastB, lastLength] = anchors[index - 1] ?? [start, start, 0];
    const [nextA, nextB] = anchors[index + 1] ?? [endA, endB];
    const gapBefore = Math.max(atA - lastA - lastLength, atB - lastB - lastLength);
    const gapAfter = Math.max(nextA - atA - length, nextB - atB - length);
    if (length <= gapBefore && length <= gapAfter) {
      anchors.splice(index, 1);
      index = Math.max(0, index - 1);
    } else index += 1;
  }

  const removed = a.map((_, index) => index >= start && index < endA);
  const added = b.map((_, index) => index >= start && index < endB);
  for (const [atA, atB, length] of anchors) {
    removed.fill(false, atA, atA + length);
    added.fill(false, atB, atB + length);
  }
  return { before: toParts(a, removed), after: toParts(b, added) };
}
