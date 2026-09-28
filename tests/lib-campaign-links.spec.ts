import { expect, test } from '@playwright/test';
import {
  campaignLink,
  draftSchema,
  emptyDraft,
  exampleDraft,
  missingTags,
  PLACE_IDS,
  PLACES,
  placeById,
  qrStudioHref,
  readPage,
  recentSchema,
  remember,
  slug,
  suggestedTags,
  tagsFor,
  untidyTags,
  type Recent,
  type Tags,
} from '@/lib/tools/campaign-links';

/* Signal Links: a page's own address, kept exactly, plus clean campaign tags. */

const tags = (patch: Partial<Tags> = {}): Tags => ({
  utm_source: 'instagram',
  utm_medium: 'social',
  utm_campaign: 'fall-menu',
  utm_content: '',
  utm_term: '',
  ...patch,
});

const build = (page: string, patch: Partial<Tags> = {}) => {
  const checked = readPage(page);
  if (!checked.ok) throw new Error(checked.message);
  return campaignLink(checked.url, tags(patch));
};

test('pasted addresses become web pages, https added when missing', () => {
  const bare = readPage('shop.example/menu');
  expect(bare.ok && bare.url.href).toBe('https://shop.example/menu');
  expect(bare.ok && bare.addedHttps).toBe(true);
  const plain = readPage('  http://shop.example  ');
  expect(plain.ok && plain.url.href).toBe('http://shop.example/');
  expect(plain.ok && plain.addedHttps).toBe(false);
  const loud = readPage('HTTPS://Shop.Example/Menu');
  expect(loud.ok && loud.url.href).toBe('https://shop.example/Menu');
  const port = readPage('shop.example:8080/menu');
  expect(port.ok && port.url.href).toBe('https://shop.example:8080/menu');
  const relative = readPage('//shop.example/menu');
  expect(relative.ok && relative.url.href).toBe('https://shop.example/menu');
});

test('anything that isn’t a web page is refused, in words', () => {
  for (const text of [
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    'javascript://shop.example/%0Aalert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:rosa@saltandember.example',
    'ftp://files.example/menu.pdf',
  ]) {
    const result = readPage(text);
    expect(result.ok, text).toBe(false);
    if (!result.ok) expect(result.message).toContain('web pages');
  }
  for (const text of ['localhost:3000', 'menu', 'shop..example', 'https://', 'shop example.com']) {
    expect(readPage(text).ok, text).toBe(false);
  }
  const empty = readPage('   ');
  expect(empty.ok).toBe(false);
  if (!empty.ok) expect(empty.empty).toBe(true);
});

test('the page keeps its own query and #fragment; tags go before the fragment', () => {
  const link = build('https://shop.example/menu?table=4&lang=es#specials');
  expect(link.href).toBe(
    'https://shop.example/menu?table=4&lang=es&utm_source=instagram&utm_medium=social&utm_campaign=fall-menu#specials',
  );
  expect(link.base).toBe('https://shop.example/menu');
  expect(link.query).toEqual(['table=4', 'lang=es']);
  expect(link.hash).toBe('#specials');
  expect(link.replaced).toEqual([]);
  // Odd but valid query pieces survive untouched.
  expect(build('shop.example/?q=a%20b&flag&x=1+2').href).toBe(
    'https://shop.example/?q=a%20b&flag&x=1+2&utm_source=instagram&utm_medium=social&utm_campaign=fall-menu',
  );
  // A hash-routed app keeps its route after the tags.
  expect(build('app.example/#/menu?x=1').href).toBe(
    'https://app.example/?utm_source=instagram&utm_medium=social&utm_campaign=fall-menu#/menu?x=1',
  );
});

test('tags the address already had are replaced, and listed so the page can say so', () => {
  const link = build(
    'shop.example/menu?utm_source=fb&table=4&UTM_Campaign=Old%20One&utm_medium=&x=1',
  );
  expect(link.href).toBe(
    'https://shop.example/menu?table=4&x=1&utm_source=instagram&utm_medium=social&utm_campaign=fall-menu',
  );
  expect(link.replaced).toEqual(['utm_source=fb', 'UTM_Campaign=Old One', 'utm_medium=']);
});

test('values are encoded; empty tags are left out', () => {
  const link = build('shop.example', {
    utm_campaign: 'Spring Sale & more',
    utm_content: 'a/b?c',
    utm_term: '',
  });
  expect(link.href).toBe(
    'https://shop.example/?utm_source=instagram&utm_medium=social&utm_campaign=Spring%20Sale%20%26%20more&utm_content=a%2Fb%3Fc',
  );
  expect(link.tags.map((tag) => tag.tag)).toEqual([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
  ]);
  expect(build('shop.example', { utm_source: '', utm_medium: '', utm_campaign: '' }).href).toBe(
    'https://shop.example/',
  );
});

test('campaign names become clean lowercase-hyphen slugs', () => {
  expect(slug('Fall Menu Launch')).toBe('fall-menu-launch');
  expect(slug('  Spring Sale 2026!!  ')).toBe('spring-sale-2026');
  expect(slug('Rosa’s Café — Crème Brûlée')).toBe('rosas-cafe-creme-brulee');
  expect(slug('Food & Drink')).toBe('food-and-drink');
  expect(slug('--Hello__World--')).toBe('hello-world');
  expect(slug('🎉🎉')).toBe('');
  expect(slug('I ❤️ Tacos 1️⃣')).toBe('i-tacos-1');
  expect(slug('दिवाली सेल')).toBe('दिवाली-सेल');
  expect(slug('Ｆｕｌｌ Width')).toBe('full-width');
  expect(slug('Venta de otoño')).toBe('venta-de-otono');
  expect(slug('a'.repeat(100))).toHaveLength(80);
  expect(slug(`${'word '.repeat(20)}`, 12)).toBe('word-word-wo');
});

test('every place sets sensible lowercase tags', () => {
  expect(PLACES.map((place) => place.id)).toEqual([...PLACE_IDS]);
  expect(PLACES).toHaveLength(14);
  for (const place of PLACES) {
    expect(place.source, place.id).toMatch(/^[a-z0-9-]+$/);
    expect(place.medium, place.id).toMatch(/^[a-z0-9-]+$/);
  }
  const pick = (id: (typeof PLACE_IDS)[number]) => {
    const place = placeById(id)!;
    return [place.source, place.medium, place.content ?? ''];
  };
  expect(pick('instagram-post')).toEqual(['instagram', 'social', 'post']);
  expect(pick('instagram-story')).toEqual(['instagram', 'social', 'story']);
  expect(pick('newsletter')).toEqual(['newsletter', 'email', '']);
  expect(pick('flyer')).toEqual(['flyer', 'print', '']);
  expect(pick('paid-ad')).toEqual(['google', 'cpc', '']);
  expect(pick('text')).toEqual(['text-message', 'sms', '']);
  expect(placeById('business-card')?.qr).toBe(true);
  expect(placeById(null)).toBeNull();
});

test('plain choices become tags; anything typed under Advanced wins', () => {
  const draft = {
    ...emptyDraft(),
    page: 'shop.example',
    place: 'instagram-story' as const,
    purpose: 'Fall Menu',
    version: 'Blue poster',
  };
  expect(suggestedTags(draft)).toEqual({
    utm_source: 'instagram',
    utm_medium: 'social',
    utm_campaign: 'fall-menu',
    utm_content: 'story-blue-poster',
    utm_term: '',
  });
  expect(tagsFor({ ...draft, raw: { utm_source: ' ig ', utm_term: 'brunch' } })).toMatchObject({
    utm_source: 'ig',
    utm_term: 'brunch',
    utm_campaign: 'fall-menu',
  });
  // An emptied Advanced field stays empty rather than coming back.
  expect(tagsFor({ ...draft, raw: { utm_content: '' } }).utm_content).toBe('');
  expect(tagsFor({ ...draft, place: 'facebook', version: '' }).utm_content).toBe('');
  expect(missingTags(tagsFor(emptyDraft()))).toEqual(['utm_source', 'utm_medium', 'utm_campaign']);
  expect(missingTags(tagsFor(exampleDraft()))).toEqual([]);
  expect(untidyTags(tags({ utm_source: 'Instagram', utm_campaign: 'fall menu' }))).toEqual([
    { tag: 'utm_source', problem: 'capitals' },
    { tag: 'utm_campaign', problem: 'spaces' },
  ]);
});

test('the example is fictional and makes a complete link', () => {
  const draft = exampleDraft();
  expect(draft.page).toContain('.example');
  const page = readPage(draft.page);
  expect(page.ok).toBe(true);
  if (page.ok)
    expect(campaignLink(page.url, tagsFor(draft)).href).toBe(
      'https://saltandember.example/menu?utm_source=instagram&utm_medium=social&utm_campaign=fall-menu-launch&utm_content=story#dinner',
    );
});

test('recent links: newest first, no repeats, twelve at most, web pages only', () => {
  const entry = (index: number, href = `https://shop.example/${index}`): Recent => ({
    id: `r${index}`,
    href,
    at: index,
    draft: emptyDraft(),
  });
  let list: Recent[] = [];
  for (let index = 0; index < 15; index += 1) list = remember(list, entry(index));
  expect(list).toHaveLength(12);
  expect(list[0].id).toBe('r14');
  list = remember(list, entry(99, 'https://shop.example/5'));
  expect(list.filter((item) => item.href === 'https://shop.example/5')).toHaveLength(1);
  expect(list[0].id).toBe('r99');

  expect(recentSchema.safeParse(list).success).toBe(true);
  expect(recentSchema.safeParse([entry(1, 'javascript:alert(1)')]).success).toBe(false);
  expect(
    recentSchema.safeParse([{ ...entry(1), draft: { ...emptyDraft(), place: 'myspace' } }]).success,
  ).toBe(false);
  expect(draftSchema.safeParse(exampleDraft()).success).toBe(true);
});

test('QR Studio opens with the link inside its address', () => {
  const href = 'https://shop.example/menu?utm_source=flyer&utm_medium=print#top';
  expect(qrStudioHref(href)).toBe(
    '/tools/qr#link=https%3A%2F%2Fshop.example%2Fmenu%3Futm_source%3Dflyer%26utm_medium%3Dprint%23top',
  );
  expect(decodeURIComponent(qrStudioHref(href).split('#link=')[1])).toBe(href);
});
