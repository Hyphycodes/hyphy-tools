import { expect, test } from '@playwright/test';
import { EMPTY_PEOPLE, MAX_PEOPLE, personNamed } from '../src/lib/tools/bring';
import { inkFor, roomColors, vividness } from '../src/lib/tools/palette';
import { suggestPreset } from '../src/lib/tools/rename';
import { nameFromUrl, splitWish } from '../src/lib/tools/wishlist';

/* The small guesses behind the redesigned tools' smart defaults. */

const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

test('Palette lights the room with the picture’s most vivid color, and leaves greys alone', () => {
  const orange = { r: 242, g: 107, b: 58 };
  const violet = { r: 122, g: 107, b: 214 };
  const grey = { r: 128, g: 128, b: 128 };
  expect(vividness(orange)).toBeGreaterThan(vividness(grey));
  const room = roomColors([grey, violet, orange]);
  expect(room).not.toBeNull();
  expect(room!.accent).toMatch(/^#[0-9a-f]{6}$/i);
  expect(room!.glow).not.toBe(room!.accent);
  expect(roomColors([grey, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }])).toBeNull();
  // The accent's ink reads on white.
  const ink = inkFor({ r: 255, g: 209, b: 102 });
  expect(1.05 / (luminance(ink) + 0.05)).toBeGreaterThanOrEqual(4.5);
});

test('Clean guesses the fix: camera names get dates, anything else is cleaned for the web', () => {
  expect(suggestPreset(['IMG_2041.JPG', 'IMG_2042.JPG', 'notes.txt'])).toBe('dates');
  expect(suggestPreset(['Budget FINAL (2).xlsx', 'Menu copy.pdf'])).toBe('web');
});

test('Christmas List names a pasted link and splits a link out of a wish', () => {
  expect(nameFromUrl('https://shop.example/products/merino-wool-socks')).toMatch(
    /merino wool socks/i,
  );
  expect(nameFromUrl('not a link')).toBe('');
  const wish = splitWish('Film camera https://shop.example/film-camera');
  expect(wish.name).toBe('Film camera');
  expect(wish.url).toContain('shop.example/film-camera');
  expect(splitWish('A good book')).toEqual({ name: 'A good book', url: '' });
});

test('Bring remembers people by name, once, most recent first', () => {
  const first = personNamed(EMPTY_PEOPLE, 'Sam', 'id-1');
  const again = personNamed(first.people, ' sam ', 'id-2');
  expect(again.person.id).toBe('id-1');
  expect(again.people.people).toHaveLength(1);
  let people = EMPTY_PEOPLE;
  for (let i = 0; i < MAX_PEOPLE + 3; i++) people = personNamed(people, `P${i}`, `id-${i}`).people;
  expect(people.people).toHaveLength(MAX_PEOPLE);
  expect(people.people[0].name).toBe(`P${MAX_PEOPLE + 2}`);
});
