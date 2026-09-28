import { expect, test } from '@playwright/test';
import {
  changeCase,
  diffNames,
  newRule,
  orderFiles,
  planRenames,
  presetRules,
  renameList,
  riskyPattern,
  splitName,
  stripOdd,
  tidySpaces,
  type RenameFile,
  type Rule,
  type RuleType,
} from '@/lib/tools/rename';

/* Clean's rules: every one of them, in order, and never a surprise in the zip. */

const MAY_3 = new Date(2026, 4, 3, 9, 14).getTime();
const file = (name: string, patch: Partial<RenameFile> = {}): RenameFile => ({
  name,
  folder: '',
  size: 100,
  modified: MAY_3,
  ...patch,
});
const rule = (type: RuleType, patch: object = {}) => ({ ...newRule(type, type), ...patch }) as Rule;
const rename = (files: RenameFile[], rules: Rule[], keepFolders = true) =>
  planRenames(files, rules, { keepFolders }).rows.map((row) => row.after);

test('find and replace: plain text, any capitals, every match, exactly as typed', () => {
  const replace = (name: string, patch: object) => rename([file(name)], [rule('replace', patch)]);
  expect(replace('IMG_2041.JPG', { find: 'img_', with: 'Photo ' })).toEqual(['Photo 2041.JPG']);
  expect(replace('IMG_img.jpg', { find: 'img', with: 'x', matchCase: true })).toEqual([
    'IMG_x.jpg',
  ]);
  expect(replace('a_b_c.txt', { find: '_', with: ' ' })).toEqual(['a b c.txt']);
  // "$" in plain text is just a dollar sign, and dots are just dots.
  expect(replace('price list.txt', { find: 'price', with: '$&$1' })).toEqual(['$&$1 list.txt']);
  expect(replace('v1.2 notes.txt', { find: '.', with: '-' })).toEqual(['v1-2 notes.txt']);
  // The extension isn't part of the name the rules see.
  expect(replace('jpg notes.jpg', { find: 'jpg', with: 'photo' })).toEqual(['photo notes.jpg']);
});

test('patterns work, and broken or risky ones are explained instead of thrown', () => {
  const plan = (find: string, replacement = 'Photo $1') =>
    planRenames(
      [file('IMG_2041.JPG')],
      [rule('replace', { find, with: replacement, pattern: true })],
    );
  expect(plan('^img_(\\d+)$').rows[0].after).toBe('Photo 2041.JPG');
  expect(plan('(?<n>\\d+)', '#$<n>').rows[0].after).toBe('IMG_#2041.JPG');

  const broken = plan('(');
  expect(broken.errors.replace).toContain('doesn’t work');
  expect(broken.rows[0].after).toBe('IMG_2041.JPG');

  const risky = plan('(\\w+)+$');
  expect(risky.errors.replace).toContain('freeze');
  expect(risky.rows[0].changed).toBe(false);

  for (const source of ['(a+)+', '(\\w+\\s?)*', '(a|ab)+', '((ab)+)+', '(x{2,})*'])
    expect(riskyPattern(source), source).toBe(true);
  for (const source of ['^IMG_(\\d+)$', '(IMG|DSC)_\\d+', '(\\d{2})+', '[(a+)+]', '(?:x)?\\d+'])
    expect(riskyPattern(source), source).toBe(false);
});

test('odd characters go; letters, accents, digits, spaces and - _ . ( ) stay', () => {
  expect(stripOdd('Party 🎉 invite!')).toBe('Party  invite');
  expect(stripOdd('Café #3 (final) – v2_x.y')).toBe('Café 3 (final)  v2_x.y');
  expect(stripOdd('a\u0000b\u0007c​d')).toBe('abcd');
  expect(stripOdd('❤️ love 1️⃣ 👍🏽')).toBe(' love 1 ');
  expect(stripOdd('日本語 メモ')).toBe('日本語 メモ');
  // Accents typed as two characters (as macOS names them) come out as one.
  expect(stripOdd('Café')).toBe('Café');
  // macOS screenshots put a narrow no-break space before AM.
  expect(stripOdd('Screenshot 10.12.45 AM')).toBe('Screenshot 10.12.45 AM');
  expect(stripOdd('Résumé ñandú Ærø', true)).toBe('Resume nandu Ærø');
});

test('tidy spaces trims, collapses, and can turn spaces into - or _', () => {
  expect(tidySpaces('  notes   from  rosa ')).toBe('notes from rosa');
  expect(tidySpaces('\ta  b')).toBe('a b');
  expect(tidySpaces('notes   from rosa', '-')).toBe('notes-from-rosa');
  expect(tidySpaces('menu - final _ v2', '-')).toBe('menu-final-v2');
  expect(tidySpaces('a _ b c', '_')).toBe('a_b_c');
  expect(tidySpaces('already-hyphened_name', '-')).toBe('already-hyphened_name');
});

test('change case: lower, UPPER, Title Case and Sentence case', () => {
  expect(changeCase('Kitchen PLAN', 'lower')).toBe('kitchen plan');
  expect(changeCase('Kitchen plan', 'upper')).toBe('KITCHEN PLAN');
  expect(changeCase('hello WORLD-wide_web (draft)', 'title')).toBe('Hello World-Wide_Web (Draft)');
  expect(changeCase('rosa’s 2nd floor', 'title')).toBe('Rosa’s 2nd Floor');
  expect(changeCase('MY TRIP to PARIS', 'sentence')).toBe('My trip to paris');
  expect(changeCase('2026 trip', 'sentence')).toBe('2026 Trip');
  expect(changeCase('élan vital', 'title')).toBe('Élan Vital');
});

test('prefix and suffix go around the name, never after the extension', () => {
  expect(
    rename(
      [file('IMG_1.jpg'), file('README')],
      [rule('prefix', { text: 'Kitchen ' }), rule('suffix', { text: ' final' })],
    ),
  ).toEqual(['Kitchen IMG_1 final.jpg', 'Kitchen README final']);
});

test('rules run top to bottom, and switched-off rules are skipped', () => {
  const prefix = rule('prefix', { text: 'a_' });
  const replace = rule('replace', { find: '_', with: '-' });
  expect(rename([file('b_c.txt')], [prefix, replace])).toEqual(['a-b-c.txt']);
  expect(rename([file('b_c.txt')], [replace, prefix])).toEqual(['a_b-c.txt']);
  expect(rename([file('b_c.txt')], [{ ...replace, on: false }, prefix])).toEqual(['a_b_c.txt']);
});

test('the extension is safe: only extension case touches it', () => {
  expect(splitName('IMG_2041.JPG')).toEqual({ base: 'IMG_2041', extension: 'JPG' });
  expect(splitName('archive.tar.gz')).toEqual({ base: 'archive', extension: 'tar.gz' });
  expect(splitName('.gitignore')).toEqual({ base: '.gitignore', extension: '' });
  expect(splitName('Report v2.1 final')).toEqual({ base: 'Report v2.1 final', extension: '' });
  expect(splitName('README')).toEqual({ base: 'README', extension: '' });

  expect(rename([file('photo.jpeg')], [rule('case', { to: 'upper' })])).toEqual(['PHOTO.jpeg']);
  expect(rename([file('photo.jpeg')], [rule('case', { to: 'title' })])).toEqual(['Photo.jpeg']);
  expect(rename([file('backup.tar.gz')], [rule('replace', { find: 'gz', with: 'zip' })])).toEqual([
    'backup.tar.gz',
  ]);
  expect(rename([file('Photo.JPG')], [rule('extension', { to: 'lower' })])).toEqual(['Photo.jpg']);
  expect(rename([file('photo.jpg')], [rule('extension', { to: 'upper' })])).toEqual(['photo.JPG']);
  expect(rename([file('Photo.JPG')], [rule('extension', { to: 'keep' })])).toEqual(['Photo.JPG']);
});

test('natural order: IMG_2 comes before IMG_10, and ties keep their place', () => {
  const files = [
    file('IMG_10.jpg', { size: 30, modified: 3 }),
    file('IMG_2.jpg', { size: 10, modified: 2 }),
    file('img_1.jpg', { size: 20, modified: 1 }),
    file('IMG_2.jpg', { folder: 'Day 2', size: 10, modified: 2 }),
  ];
  expect(orderFiles(files, 'added')).toEqual([0, 1, 2, 3]);
  expect(orderFiles(files, 'name')).toEqual([3, 2, 1, 0]);
  expect(orderFiles(files, 'modified')).toEqual([2, 3, 1, 0]);
  expect(orderFiles(files, 'size')).toEqual([3, 1, 2, 0]);
});

test('numbering: start, step, zero-padding, place, separator and a new name', () => {
  const three = [file('b.jpg'), file('a.jpg'), file('c.jpg')];
  const plan = planRenames(three, [rule('number')]);
  // Listed in the order they're numbered: by name, a first.
  expect(plan.rows.map((row) => row.after)).toEqual(['a 01.jpg', 'b 02.jpg', 'c 03.jpg']);
  expect(plan.rows.map((row) => row.index)).toEqual([1, 0, 2]);

  const many = Array.from({ length: 120 }, (_, index) => file(`f${index + 1}.png`));
  const numbered = rename(many, [rule('number', { name: 'Shot', order: 'added' })]);
  expect(numbered[0]).toBe('Shot 001.png');
  expect(numbered[119]).toBe('Shot 120.png');

  expect(
    rename(three, [rule('number', { start: 10, step: 5, digits: 4, at: 'start', separator: '_' })]),
  ).toEqual(['0010_a.jpg', '0015_b.jpg', '0020_c.jpg']);
  expect(rename(three, [rule('number', { digits: 1, order: 'added', name: 'Kitchen' })])).toEqual([
    'Kitchen 1.jpg',
    'Kitchen 2.jpg',
    'Kitchen 3.jpg',
  ]);
});

test('the date is the file’s last-modified day, before or after the name', () => {
  const late = file('IMG_7.jpg', { modified: new Date(2026, 4, 3, 23, 59).getTime() });
  expect(rename([late], [rule('date')])).toEqual(['2026-05-03 IMG_7.jpg']);
  expect(rename([late], [rule('date', { at: 'end', separator: '_' })])).toEqual([
    'IMG_7_2026-05-03.jpg',
  ]);
});

test('clashes get (2), (3)… judged the way file systems judge them', () => {
  const lower = rule('case', { to: 'lower' });
  const plan = planRenames([file('a.JPG'), file('A.jpg'), file('a (2).jpg')], [lower]);
  expect(plan.rows.map((row) => row.after)).toEqual(['a.JPG', 'a (2).jpg', 'a (2) (2).jpg']);
  expect(plan.rows.map((row) => row.problems)).toEqual([[], ['duplicate'], ['duplicate']]);

  // Same new name in different folders is fine while the folders are kept.
  const split = [file('IMG_1.JPG', { folder: 'Day 1' }), file('IMG_1.JPG', { folder: 'Day 2' })];
  const extension = rule('extension', { to: 'lower' });
  expect(rename(split, [extension], true)).toEqual(['IMG_1.jpg', 'IMG_1.jpg']);
  expect(rename(split, [extension], false)).toEqual(['IMG_1.jpg', 'IMG_1 (2).jpg']);
  expect(planRenames(split, [extension], { keepFolders: true }).rows[1].path).toBe(
    'Day 2/IMG_1.jpg',
  );
});

test('every new name is one all systems accept, and problems are flagged', () => {
  const colon = planRenames([file('a b.txt')], [rule('replace', { find: ' ', with: ': ' })]);
  expect(colon.rows[0]).toMatchObject({ after: 'a_ b.txt', problems: ['chars'] });

  const slash = planRenames([file('a_b.txt')], [rule('replace', { find: '_', with: '/' })]);
  expect(slash.rows[0].path).toBe('a_b.txt');

  const empty = planRenames([file('IMG_1.jpg')], [rule('replace', { find: '.+', pattern: true })]);
  expect(empty.rows[0]).toMatchObject({ after: 'IMG_1.jpg', problems: ['empty'], changed: false });

  const long = planRenames([file('a.jpg')], [rule('prefix', { text: 'x'.repeat(200) })]);
  expect(long.rows[0].problems).toEqual(['long']);
  expect(planRenames([file('con.txt')], []).rows[0].problems).toEqual(['reserved']);

  const dot = planRenames([file('Report')], [rule('suffix', { text: '.' })]);
  expect(dot.rows[0]).toMatchObject({ after: 'Report', problems: ['chars'] });
  expect(planRenames([file('x.txt')], []).attention).toBe(0);
});

test('the rename list is a CSV of old and new places', () => {
  const plan = planRenames(
    [file('IMG_1.JPG', { folder: 'Trip' }), file('=SUM(A1).txt')],
    [rule('case', { to: 'lower' })],
    { keepFolders: true },
  );
  expect(renameList(plan)).toBe(
    "old,new\r\nTrip/IMG_1.JPG,Trip/img_1.JPG\r\n'=SUM(A1).txt,'=sum(a1).txt",
  );
  const flat = planRenames([file('IMG_1.JPG', { folder: 'Trip' })], [], { keepFolders: false });
  expect(renameList(flat)).toBe('old,new\r\nTrip/IMG_1.JPG,IMG_1.JPG');
});

test('highlights show what was removed and what was added', () => {
  expect(diffNames('IMG_2041.JPG', 'img_2041.jpg')).toEqual({
    before: [
      { text: 'IMG', changed: true },
      { text: '_2041.', changed: false },
      { text: 'JPG', changed: true },
    ],
    after: [
      { text: 'img', changed: true },
      { text: '_2041.', changed: false },
      { text: 'jpg', changed: true },
    ],
  });
  expect(diffNames('a.jpg', '2026-05-03 a.jpg').after).toEqual([
    { text: '2026-05-03 ', changed: true },
    { text: 'a.jpg', changed: false },
  ]);
  expect(diffNames('same.txt', 'same.txt').after).toEqual([{ text: 'same.txt', changed: false }]);
  // Whole runs are matched, not stray digits: "2041." is found inside the new name as one piece.
  expect(diffNames('IMG_2041.JPG', '2026-05-03 img-2041.jpg').after).toEqual([
    { text: '2026-05-03 img-', changed: true },
    { text: '2041.', changed: false },
    { text: 'jpg', changed: true },
  ]);
  expect(diffNames('Party 🎉 invite FINAL.pdf', 'party-invite-final.pdf').after).toEqual([
    { text: 'p', changed: true },
    { text: 'arty', changed: false },
    { text: '-', changed: true },
    { text: 'invite', changed: false },
    { text: '-final', changed: true },
    { text: '.pdf', changed: false },
  ]);
  // A short run shared by chance ("ip" in "receipt" and "Trip") isn't shown as kept.
  expect(diffNames('Café receipt.jpeg', 'Trip 01.jpeg').after).toEqual([
    { text: 'Trip 01', changed: true },
    { text: '.jpeg', changed: false },
  ]);
  expect(diffNames('Party 🎉 invite.pdf', 'Party invite.pdf').before).toEqual([
    { text: 'Party ', changed: false },
    { text: '🎉 ', changed: true },
    { text: 'invite.pdf', changed: false },
  ]);
});

test('presets are starting points that do what they say', () => {
  const photo = file('IMG_2041.JPG');
  expect(rename([photo], presetRules('dates'))).toEqual(['2026-05-03 IMG_2041.jpg']);
  expect(rename([file('Salt & Ember 🎉 menu_FINAL.TXT')], presetRules('web'))).toEqual([
    'salt-ember-menu-final.txt',
  ]);
  expect(rename([file('Café  Receipt.jpeg')], presetRules('web'))).toEqual(['cafe-receipt.jpeg']);
  expect(rename([photo, file('IMG_2042.JPG')], presetRules('number', 'Kitchen'))).toEqual([
    'Kitchen 01.jpg',
    'Kitchen 02.jpg',
  ]);
});
