import { expect, test } from '@playwright/test';
import { getTool, listedTools, isReady, type ToolId } from '@/lib/catalog';
import {
  getMode,
  lineIn,
  modesOf,
  quickFor,
  situationsFor,
  starterTools,
  toolsForMode,
} from '@/lib/catalog/modes';
import { intentOf, searchTools } from '@/lib/catalog/search';
import { HOME_BOOT } from '@/lib/home/boot';
import {
  HOME_KEY,
  clearHistory,
  emptyHome,
  isPersonal,
  mergeHome,
  readHome,
  recordUse,
  setLens,
  setPin,
  shelf,
  whenLabel,
  type HomePrefs,
} from '@/lib/home/prefs';

/* The layer above the tools: modes, situations, intent search and the personal home. Pure. */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 28, 15);
const listed = new Set<ToolId>(listedTools.filter(isReady).map((tool) => tool.id));
const ids = (tools: { id: ToolId }[]) => tools.map((tool) => tool.id);

/** Opens a tool on `days` different days, the last one `ago` days back. */
function used(home: HomePrefs, id: ToolId, days: number, ago = 0) {
  let next = home;
  for (let index = days - 1; index >= 0; index -= 1) {
    const at = NOW - (ago + index) * DAY;
    next = recordUse(next, id, at, new Date(at).toISOString().slice(0, 10));
  }
  return next;
}

test.describe('modes are lenses over the same tools', () => {
  test('each mode starts with its own six', () => {
    expect(ids(starterTools('everyday'))).toEqual(['split', 'plan', 'when', 'qr', 'resize', 'pdf']);
    expect(ids(starterTools('create'))).toEqual([
      'social-crop',
      'resize',
      'palette',
      'qr',
      'pdf',
      'convert',
    ]);
    expect(ids(starterTools('work'))).toEqual([
      'receipts',
      'mileage',
      'pdf',
      'qr',
      'signal-links',
      'subscriptions',
    ]);
    expect(starterTools('all').length).toBeGreaterThan(3);
  });

  test('a tool can live in several modes, with different words in each', () => {
    const qr = getTool('qr');
    expect(modesOf(qr)).toEqual(['everyday', 'create', 'work']);
    expect(lineIn(qr, 'everyday')).toMatch(/Wi-Fi/);
    expect(lineIn(qr, 'work')).toMatch(/Menus/);
    expect(lineIn(qr, 'all')).toBe(qr.tagline);
  });

  test('Everyday isn’t a wall of business tools, and nothing open is left out of every mode', () => {
    const everyday = ids(toolsForMode('everyday'));
    expect(everyday).not.toContain('receipts');
    expect(everyday).not.toContain('mileage');
    for (const tool of listedTools.filter(isReady)) expect(modesOf(tool).length).toBeGreaterThan(0);
  });

  test('situations are short paths, and seasonal ones wait for their season', () => {
    const september = situationsFor('everyday', 9);
    expect(september[0].id).toBe('dinner');
    expect(september[0].steps.map((step) => step.tool)).toEqual(['when', 'where', 'split']);
    expect(september.map((situation) => situation.id)).not.toContain('gifts');
    expect(situationsFor('everyday', 12)[0].id).toBe('gifts');
    expect(situationsFor('work', 9)[0].steps.map((step) => step.tool)).toEqual([
      'mileage',
      'receipts',
    ]);
    for (const lens of ['everyday', 'create', 'work', 'all'] as const)
      for (const situation of situationsFor(lens, 11)) {
        expect(situation.steps.length).toBeGreaterThanOrEqual(2);
        expect(situation.steps.length).toBeLessThanOrEqual(4);
      }
  });

  test('the “+” leads with what the mode reaches for', () => {
    expect(quickFor('work')[0].id).toBe('track');
    expect(quickFor('create')[0].id).toBe('upload');
    expect(quickFor(null).map((group) => group.id)).toEqual([
      'scan',
      'upload',
      'make',
      'plan',
      'track',
    ]);
    expect(getMode('everyday').quick[0]).toBe('plan');
  });
});

test.describe('search by what’s going on', () => {
  const top = (query: string, count: number, mode: 'create' | null = null) =>
    searchTools(query, listedTools, 8, { mode })
      .slice(0, count)
      .map((result) => result.tool.id);

  test('a situation word brings its tools, in order', () => {
    expect(top('dinner', 4)).toEqual(['split', 'where', 'when', 'plan']);
    expect(top('instagram', 3)).toEqual(['social-crop', 'resize', 'palette']);
    expect(top('instagram', 3, 'create')).toEqual(['social-crop', 'resize', 'palette']);
    expect(top('receipt', 2)).toEqual(['receipts', 'split']);
    expect(top('work mileage', 1)).toEqual(['mileage']);
    expect(top('merge', 1)).toEqual(['pdf']);
    expect(top('make smaller', 1)).toEqual(['resize']);
    expect(top('birthday', 1)).toEqual(['plan']);
  });

  test('it says why a tool came up', () => {
    const [first, second] = searchTools('dinner', listedTools);
    expect(first.tool.id).toBe('split');
    expect(second.because).toBeTruthy();
    expect(intentOf('Insta')?.tools[0]).toBe('social-crop');
    expect(intentOf('split a check for dinner')).toBeNull();
  });
});

test.describe('the personal home', () => {
  test('a tool counts once a day, and its place is kept from its first day', () => {
    let home = emptyHome();
    home = recordUse(home, 'split', NOW, '2026-09-28');
    home = recordUse(home, 'split', NOW + 1000, '2026-09-28');
    expect(home.uses.split.days).toBe(1);
    home = recordUse(home, 'split', NOW + DAY, '2026-09-29');
    expect(home.uses.split).toMatchObject({ days: 2, first: NOW, day: '2026-09-29' });
  });

  test('Person A: pins first, in the order pinned, then their regulars, then what they tried', () => {
    let home = setLens(emptyHome(), 'everyday', NOW);
    home = setPin(home, 'split', true, NOW - 3 * DAY);
    home = setPin(home, 'where', true, NOW - 2 * DAY);
    home = setPin(home, 'pdf', true, NOW - DAY);
    home = used(home, 'resize', 1, 2);
    home = used(home, 'split', 6, 1);
    home = used(home, 'bring', 3, 4);
    const starters = ids(starterTools('everyday'));
    const items = shelf(home, { now: NOW, starters, listed });
    expect(items.map((item) => [item.id, item.reason])).toEqual([
      ['split', 'pinned'],
      ['where', 'pinned'],
      ['pdf', 'pinned'],
      ['bring', 'regular'],
      ['resize', 'recent'],
      ['plan', 'starter'],
    ]);
    // Using Resize again doesn't shuffle the shelf.
    const again = shelf(used(home, 'resize', 1), { now: NOW, starters, listed });
    expect(again.map((item) => item.id)).toEqual(items.map((item) => item.id));
  });

  test('Person B: the tools they keep using lead, without hiding anything', () => {
    let home = setLens(emptyHome(), 'work', NOW);
    home = used(home, 'receipts', 5);
    home = used(home, 'mileage', 8);
    const items = shelf(home, { now: NOW, starters: ids(starterTools('work')), listed });
    expect(items.slice(0, 2).map((item) => item.reason)).toEqual(['regular', 'regular']);
    expect(
      items
        .slice(0, 2)
        .map((item) => item.id)
        .sort(),
    ).toEqual(['mileage', 'receipts']);
    expect(items.length).toBe(6);
  });

  test('old tries fade off the shelf; pins never do', () => {
    let home = setPin(emptyHome(), 'qr', true, NOW - 200 * DAY);
    home = used(home, 'palette', 1, 40);
    const items = shelf(home, { now: NOW, starters: [], listed });
    expect(items.map((item) => item.id)).toEqual(['qr']);
  });

  test('forgetting history keeps pins and the mode', () => {
    let home = setLens(setPin(used(emptyHome(), 'split', 2), 'pdf', true, NOW), 'create', NOW);
    expect(isPersonal(home)).toBe(true);
    home = clearHistory(home);
    expect(home.uses).toEqual({});
    expect(home.pins.pdf.on).toBe(true);
    expect(home.lens).toBe('create');
  });

  test('two copies merge without losing either side (for syncing later)', () => {
    const phone = setPin(
      used(setLens(emptyHome(), 'work', NOW - DAY), 'mileage', 3),
      'qr',
      true,
      NOW,
    );
    const laptop = setPin(
      used(setLens(emptyHome(), 'create', NOW), 'pdf', 1),
      'qr',
      false,
      NOW - DAY,
    );
    const merged = mergeHome(phone, laptop);
    expect(merged.lens).toBe('create');
    expect(merged.pins.qr.on).toBe(true);
    expect(Object.keys(merged.uses).sort()).toEqual(['mileage', 'pdf']);
    expect(mergeHome(laptop, phone)).toEqual(merged);
  });

  test('storage is read carefully: junk and removed tools drop out', () => {
    expect(readHome('not json')).toEqual(emptyHome());
    expect(readHome(JSON.stringify({ v: 2 }))).toEqual(emptyHome());
    const home = readHome(
      JSON.stringify({
        ...emptyHome(),
        pins: { split: { on: true, t: 1 }, 'gone-tool': { on: true, t: 2 } },
      }),
    );
    expect(Object.keys(home.pins)).toEqual(['split']);
    // The boot script reads the same key.
    expect(HOME_BOOT).toContain(HOME_KEY);
  });

  test('recent days read like people say them', () => {
    const now = new Date(2026, 8, 28, 15).getTime();
    expect(whenLabel(now - 60_000, now)).toBe('Today');
    expect(whenLabel(now - DAY, now)).toBe('Yesterday');
    expect(whenLabel(new Date(2026, 8, 25, 9).getTime(), now)).toBe('Friday');
    expect(whenLabel(new Date(2026, 8, 12, 9).getTime(), now)).toBe('Sep 12');
  });
});
