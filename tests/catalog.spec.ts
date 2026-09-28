import { expect, test } from '@playwright/test';
import {
  catalogFacts,
  getTool,
  listedTools,
  privacyFacts,
  relatedTo,
  routableTools,
  toolBySlug,
  tools,
} from '@/lib/catalog';
import { searchTools } from '@/lib/catalog/search';
import { validateCatalog } from '@/lib/catalog/validate';

/* The public tool registry and marketplace search. Pure rules, no browser. */

test.describe('the tool registry', () => {
  test('every entry is valid and agrees with itself', () => {
    expect(validateCatalog(tools)).toEqual([]);
  });

  test('catches the mistakes it exists to catch', () => {
    const split = getTool('split');
    const broken = [
      ...tools.filter((tool) => tool.id !== 'split'),
      {
        ...split,
        slug: 'when',
        related: ['split' as const],
        privacy: { processing: 'server' as const, storage: ['none' as const] },
      },
    ];
    const problems = validateCatalog(broken).join('\n');
    expect(problems).toContain('slug “when” is taken');
    expect(problems).toContain('related to itself');
    expect(problems).toContain('works on a server');
  });

  test('hidden tools have no page and unlisted ones stay out of the marketplace', () => {
    expect(routableTools.every((tool) => tool.visibility !== 'hidden')).toBe(true);
    expect(listedTools.every((tool) => tool.visibility === 'public')).toBe(true);
    expect(toolBySlug('christmas-list')?.id).toBe('wishlist');
    expect(toolBySlug('nope')).toBeUndefined();
  });

  test('related tools are real, listed and never the tool itself', () => {
    for (const tool of listedTools) {
      const related = relatedTo(tool);
      expect(related.length, tool.id).toBeGreaterThan(0);
      expect(related.map((item) => item.id)).not.toContain(tool.id);
      expect(related.every((item) => item.visibility === 'public')).toBe(true);
    }
  });

  test('privacy words follow the architecture', () => {
    const qr = privacyFacts(getTool('qr'));
    expect(qr.local).toBe(true);
    expect(qr.label).toBe('Runs on your device');
    expect(qr.lines.join(' ')).toContain('Nothing is kept');

    const when = privacyFacts(getTool('when'));
    expect(when.label).toContain('shared by link');
    expect(when.lines.join(' ')).toContain('never send to a server');

    const receipts = privacyFacts(getTool('receipts'));
    expect(receipts.local).toBe(false);
    expect(receipts.lines.join(' ')).not.toContain('never uploaded');
    expect(receipts.lines.join(' ')).toContain('doesn’t sell your personal data');

    // A tool that keeps things in the browser never claims that nothing is kept.
    for (const tool of listedTools) {
      const facts = privacyFacts(tool);
      if (tool.privacy.storage.includes('browser'))
        expect(facts.lines.join(' ')).not.toContain('Nothing is kept');
    }
  });

  test('marketplace numbers come from the registry', () => {
    const facts = catalogFacts();
    expect(facts.open).toBe(listedTools.filter((tool) => tool.status !== 'soon').length);
    expect(facts.local).toBeLessThanOrEqual(facts.open);
    expect(facts.soon).toBeGreaterThan(0);
  });
});

test.describe('marketplace search speaks people’s language', () => {
  const top = (query: string) => searchTools(query, listedTools)[0]?.tool.id;

  for (const [query, expected] of [
    ['split dinner', 'split'],
    ['when are my friends free', 'when'],
    ['instagram size', 'social-crop'],
    ['rename files', 'clean'],
    ['linktree', 'signal-pages'],
    ['resize photos', 'resize'],
    ['make a qr', 'qr'],
    ['clean some files', 'clean'],
    ['merge pdf', 'pdf'],
    ['wifi password', 'qr'],
    ['utm', 'signal-links'],
    ['cancel subscriptions', 'subscriptions'],
    ['netflix', 'subscriptions'],
    ['potluck', 'bring'],
    ['who is bringing what', 'bring'],
    ['wishlist', 'wishlist'],
    ['colors from logo', 'palette'],
    ['duplicate photos', 'duplicates'],
    ['photos to pdf', 'convert'],
    ['youtube thumbnail', 'social-crop'],
    ['find a time', 'when'],
    ['tip calculator', 'split'],
    ['what should we eat', 'where'],
    ['secret santa', 'secret-santa'],
    ['mileage', 'mileage'],
  ] as const)
    test(`“${query}” finds ${expected}`, () => {
      expect(top(query)).toBe(expected);
    });

  test('typos and half-typed words still land', () => {
    expect(top('subscritions')).toBe('subscriptions');
    expect(top('palete')).toBe('palette');
    expect(top('dupli')).toBe('duplicates');
    expect(top('qr cde')).toBe('qr');
    expect(top('Instagram SIZE!')).toBe('social-crop');
  });

  test('says why when the name alone wouldn’t', () => {
    const [first] = searchTools('linktree', listedTools);
    expect(first.because).toBe('linktree');
    expect(searchTools('split', listedTools)[0].because).toBeUndefined();
  });

  test('nonsense finds nothing, and an empty box shows nothing', () => {
    expect(searchTools('zzqxv blorp', listedTools)).toEqual([]);
    expect(searchTools('   ', listedTools)).toEqual([]);
  });
});
