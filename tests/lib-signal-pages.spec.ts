import { expect, test } from '@playwright/test';
import {
  hostOf,
  monogram,
  newSignalPage,
  publishedLinks,
  safeHref,
  signalPageSchema,
  socialHref,
} from '@/lib/tools/signal-pages';

/* Signal Pages: only safe links survive, socials read the way people type them. */

test('links open only on the web, by email or by phone', () => {
  expect(safeHref('saltandember.example/book')).toBe('https://saltandember.example/book');
  expect(safeHref('https://tickets.example/a?b=1')).toBe('https://tickets.example/a?b=1');
  expect(safeHref('mailto:rosa@saltandember.example')).toBe('mailto:rosa@saltandember.example');
  expect(safeHref('tel:+15550100199')).toBe('tel:+15550100199');
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'vbscript:x',
    'localhost',
    '',
    '  ',
  ])
    expect(safeHref(bad), bad).toBeNull();
});

test('socials: handles, dotted handles and full addresses', () => {
  expect(socialHref('instagram', '@rosa.eats')).toBe('https://instagram.com/rosa.eats');
  expect(socialHref('instagram', 'rosa.eats')).toBe('https://instagram.com/rosa.eats');
  expect(socialHref('tiktok', '@rosa')).toBe('https://www.tiktok.com/@rosa');
  expect(socialHref('youtube', 'youtube.com/@rosa')).toBe('https://youtube.com/@rosa');
  expect(socialHref('website', 'saltandember.example')).toBe('https://saltandember.example/');
  expect(socialHref('email', 'rosa@saltandember.example')).toBe('mailto:rosa@saltandember.example');
  expect(socialHref('email', 'not an email')).toBeNull();
  expect(socialHref('spotify', '@rosa')).toBeNull();
  expect(socialHref('x', 'javascript:alert(1)')).toBe('https://x.com/javascriptalert1');
});

test('only named links with safe addresses are published', () => {
  const page = {
    ...newSignalPage(),
    links: [
      { id: 'a', label: 'Book', url: 'saltandember.example/book' },
      { id: 'b', label: '', url: 'saltandember.example' },
      { id: 'c', label: 'Sneaky', url: 'javascript:alert(1)' },
    ],
  };
  expect(publishedLinks(page).map((link) => link.id)).toEqual(['a']);
  expect(hostOf('https://www.tickets.example/x')).toBe('tickets.example');
  expect(monogram({ name: '  rosa', handle: '' })).toBe('R');
});

test('a page link can’t smuggle anything in', () => {
  expect(signalPageSchema.safeParse(newSignalPage()).success).toBe(true);
  expect(signalPageSchema.safeParse({ ...newSignalPage(), design: 'evil' }).success).toBe(false);
  expect(
    signalPageSchema.safeParse({
      ...newSignalPage(),
      links: Array.from({ length: 13 }, (_, index) => ({
        id: `l${index}`,
        label: 'x',
        url: 'a.example',
      })),
    }).success,
  ).toBe(false);
});
