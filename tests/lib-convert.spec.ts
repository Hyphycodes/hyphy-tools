import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { crc32 } from '@/lib/files/zip';
import {
  baseName,
  buildPdf,
  DEFAULT_SETUP,
  embedPlan,
  FIT_LONG_SIDE,
  hasTransparency,
  jpegOrientation,
  kindOf,
  layoutPage,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  orientedSize,
  pageImageName,
  pagePixels,
  pagesZipName,
  PAPER,
  pdfName,
  placeImage,
  previewBoxes,
  redrawSize,
  redrawType,
  RESOLUTIONS,
  sizeChange,
  sniffImage,
  stripJpegMetadata,
  type Box,
  type PageSetup,
  type Placement,
} from '@/lib/tools/convert';

/* Convert's page math, file decisions and names, and a real PDF built from real pictures. */

const setup = (patch: Partial<PageSetup>): PageSetup => ({ ...DEFAULT_SETUP, ...patch });

function expectBox(actual: Box, expected: Box) {
  expect(actual.x).toBeCloseTo(expected.x, 2);
  expect(actual.y).toBeCloseTo(expected.y, 2);
  expect(actual.width).toBeCloseTo(expected.width, 2);
  expect(actual.height).toBeCloseTo(expected.height, 2);
}

/** A tiny real PNG, made here: 8-bit RGBA, every pixel `color`. */
function png(width: number, height: number, color: [number, number, number, number]) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) raw.set(color, y * row + 1 + x * 4);
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}

/** A real 8 × 6 JPEG (drawn by a browser canvas), stripped to its essentials. */
const JPEG = new Uint8Array(
  Buffer.from(
    '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAGAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAaEAEAAQUAAAAAAAAAAAAAAAAAAgUWVKPR/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABsRAAIBBQAAAAAAAAAAAAAAAAABEwIDUVKR/9oADAMBAAIRAxEAPwC9r0XC2z6AIkryxyK3quH/2Q==',
    'base64',
  ),
);

/** The same JPEG with an EXIF block saying how to turn it, the way a phone saves it. */
function withOrientation(jpeg: Uint8Array, orientation: number, order: 'II' | 'MM' = 'II') {
  const little = order === 'II';
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write(order, 0, 'ascii');
  const u16 = (value: number, at: number) =>
    little ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at);
  const u32 = (value: number, at: number) =>
    little ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at);
  u16(42, 2);
  u32(8, 4); // the first directory follows the header
  u16(1, 8); // one entry
  u16(0x0112, 10); // Orientation
  u16(3, 12); // SHORT
  u32(1, 14); // one value
  u16(orientation, 18);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(body.length + 2, 2);
  return new Uint8Array(
    Buffer.concat([Buffer.from(jpeg.subarray(0, 2)), app1, body, Buffer.from(jpeg.subarray(2))]),
  );
}

test('each page fits its image: the picture’s shape, about a sheet of paper at most', () => {
  // A screenshot keeps its size, at 96 pixels to the inch.
  const small = layoutPage({ width: 800, height: 600 }, setup({ size: 'fit' }));
  expect([small.width, small.height]).toEqual([600, 450]);
  expectBox(small.box, { x: 0, y: 0, width: 600, height: 450 });

  // A phone photo becomes an 11-inch page, not a 42-inch one; its shape is kept.
  const photo = layoutPage({ width: 4032, height: 3024 }, setup({ size: 'fit' }));
  expect([photo.width, photo.height]).toEqual([FIT_LONG_SIDE, 594]);
  expectBox(photo.box, { x: 0, y: 0, width: 792, height: 594 });
  const tall = layoutPage({ width: 3024, height: 4032 }, setup({ size: 'fit' }));
  expect([tall.width, tall.height]).toEqual([594, 792]);

  // Margins and orientation only apply to paper.
  const same = layoutPage(
    { width: 800, height: 600 },
    setup({ size: 'fit', margin: 'normal', orientation: 'portrait' }),
  );
  expect(same).toEqual(small);

  // A sliver still gets a valid page (3 pt at least), with the picture centered on it.
  const sliver = layoutPage({ width: 2, height: 1 }, setup({ size: 'fit' }));
  expect([sliver.width, sliver.height]).toEqual([3, 3]);
  expectBox(sliver.box, { x: 0, y: 0.75, width: 3, height: 1.5 });
});

test('A4 and US Letter: turned to suit each picture, margins kept, picture centered', () => {
  const a4 = PAPER.a4;
  // Auto: a landscape photo gets a landscape page, filling its height.
  const wide = layoutPage(
    { width: 4000, height: 3000 },
    setup({ size: 'a4', orientation: 'auto', margin: 'none' }),
  );
  expect([wide.width, wide.height]).toEqual([a4.height, a4.width]);
  const width = (4000 * a4.width) / 3000;
  expectBox(wide.box, { x: (a4.height - width) / 2, y: 0, width, height: a4.width });

  // Auto: a portrait photo (and a square one) gets a portrait page; margins are respected.
  const tall = layoutPage(
    { width: 3000, height: 4000 },
    setup({ size: 'letter', orientation: 'auto', margin: 'normal' }),
  );
  expect([tall.width, tall.height]).toEqual([612, 792]);
  expectBox(tall.box, { x: 36, y: 36 + (720 - 540 * (4 / 3)) / 2, width: 540, height: 720 });
  const square = layoutPage({ width: 500, height: 500 }, setup({ size: 'letter' }));
  expect([square.width, square.height]).toEqual([612, 792]);
  expectBox(square.box, { x: 18, y: (792 - 576) / 2, width: 576, height: 576 });

  // Fixed: every page turned the same way, whatever the picture.
  const forced = layoutPage(
    { width: 4000, height: 3000 },
    setup({ size: 'letter', orientation: 'portrait', margin: 'small' }),
  );
  expect([forced.width, forced.height]).toEqual([612, 792]);
  expectBox(forced.box, { x: 18, y: (792 - 432) / 2, width: 576, height: 432 });
  const flat = layoutPage(
    { width: 3000, height: 4000 },
    setup({ size: 'a4', orientation: 'landscape', margin: 'small' }),
  );
  expect([flat.width, flat.height]).toEqual([a4.height, a4.width]);
  expect(flat.box.height).toBeCloseTo(a4.width - 36, 2);
  expect(flat.box.y).toBeCloseTo(18, 2);

  // Small pictures are scaled up to fill the space, never stretched.
  const tiny = layoutPage({ width: 40, height: 30 }, setup({ size: 'letter', margin: 'none' }));
  expect(tiny.box.width / tiny.box.height).toBeCloseTo(40 / 30, 5);
  expect(tiny.box.width).toBeCloseTo(792, 2);
});

test('the preview draws each page to scale inside its frame', () => {
  const paper = previewBoxes(
    layoutPage({ width: 4000, height: 3000 }, setup({ size: 'letter', orientation: 'portrait' })),
    4 / 5,
  );
  // A portrait Letter sheet (0.77) is narrower than the 4:5 frame, so it fills the height.
  expect(paper.sheet.height).toBe(100);
  expect(paper.sheet.width).toBeCloseTo((612 / 792 / 0.8) * 100, 5);
  expect(paper.sheet.left).toBeCloseTo((100 - paper.sheet.width) / 2, 5);
  expect(paper.picture.left).toBeCloseTo((18 / 612) * 100, 5);
  expect(paper.picture.width).toBeCloseTo((576 / 612) * 100, 5);
  expect(paper.picture.top).toBeCloseTo(((792 - 432) / 2 / 792) * 100, 5);

  const photo = previewBoxes(layoutPage({ width: 1600, height: 900 }, DEFAULT_SETUP), 4 / 5);
  expect(photo.sheet.width).toBe(100);
  expect(photo.sheet.height).toBeCloseTo((0.8 / (16 / 9)) * 100, 5);
  expect(photo.picture).toEqual({ left: 0, top: 0, width: 100, height: 100 });
});

/** Where a placement sends the stored picture's corners, as pdf-lib draws it. */
function corners({ x, y, width, height, rotate }: Placement) {
  const angle = (rotate * Math.PI) / 180;
  const at = (u: number, v: number) => ({
    x: x + u * width * Math.cos(angle) - v * height * Math.sin(angle),
    y: y + u * width * Math.sin(angle) + v * height * Math.cos(angle),
  });
  return { topLeft: at(0, 1), all: [at(0, 0), at(1, 0), at(0, 1), at(1, 1)] };
}

test('turned phone photos are turned on the page, filling exactly their box', () => {
  const box = { x: 10, y: 20, width: 300, height: 400 };
  // Where the stored picture's top-left corner must land for each EXIF turn.
  const expected: Record<number, { x: number; y: number }> = {
    1: { x: 10, y: 420 },
    3: { x: 310, y: 20 }, // upside down
    6: { x: 310, y: 420 }, // stored lying on its left side
    8: { x: 10, y: 20 }, // stored lying on its right side
  };
  for (const [orientation, topLeft] of Object.entries(expected)) {
    const placed = corners(placeImage(box, Number(orientation)));
    const xs = placed.all.map((point) => point.x);
    const ys = placed.all.map((point) => point.y);
    expect(Math.min(...xs)).toBeCloseTo(box.x, 6);
    expect(Math.max(...xs)).toBeCloseTo(box.x + box.width, 6);
    expect(Math.min(...ys)).toBeCloseTo(box.y, 6);
    expect(Math.max(...ys)).toBeCloseTo(box.y + box.height, 6);
    expect(placed.topLeft.x).toBeCloseTo(topLeft.x, 6);
    expect(placed.topLeft.y).toBeCloseTo(topLeft.y, 6);
  }
  expect(orientedSize({ width: 4032, height: 3024 }, 6)).toEqual({ width: 3024, height: 4032 });
  expect(orientedSize({ width: 4032, height: 3024 }, 3)).toEqual({ width: 4032, height: 3024 });
});

test('EXIF orientation is read from real JPEG bytes, in either byte order', () => {
  expect(jpegOrientation(JPEG)).toBe(1);
  expect(jpegOrientation(withOrientation(JPEG, 6))).toBe(6);
  expect(jpegOrientation(withOrientation(JPEG, 8, 'MM'))).toBe(8);
  expect(jpegOrientation(withOrientation(JPEG, 3))).toBe(3);
  // Nonsense values and non-JPEG bytes read as upright.
  expect(jpegOrientation(withOrientation(JPEG, 42))).toBe(1);
  expect(jpegOrientation(png(2, 2, [0, 0, 0, 255]))).toBe(1);
  expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(1);
  // A view into a bigger buffer reads the same.
  const turned = withOrientation(JPEG, 6);
  const padded = new Uint8Array(turned.length + 7);
  padded.set(turned, 7);
  expect(jpegOrientation(padded.subarray(7))).toBe(6);
});

/** A JPEG segment: marker, length, body. */
function segment(marker: number, body: string) {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(marker, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, Buffer.from(body, 'binary')]);
}

test('camera notes and location are stripped from JPEGs without touching the picture', () => {
  const noted = new Uint8Array(
    Buffer.concat([
      Buffer.from(JPEG.subarray(0, 2)),
      segment(0xffe0, 'JFIF\0 density'),
      Buffer.from(withOrientation(JPEG, 6).subarray(2, 2 + 4 + 6 + 26)), // EXIF, with a turn
      segment(0xffe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta GPSLatitude="41.88"/>'),
      segment(0xffe2, 'ICC_PROFILE\0 colors'),
      segment(0xffed, 'Photoshop 3.0\0 caption'),
      segment(0xffee, 'Adobe\0 color transform'),
      segment(0xfffe, 'Shot at 12 Ember Lane'),
      Buffer.from(JPEG.subarray(2)),
    ]),
  );
  expect(jpegOrientation(noted)).toBe(6);
  const clean = stripJpegMetadata(noted);
  const text = Buffer.from(clean).toString('binary');
  expect(text).not.toContain('Exif');
  expect(text).not.toContain('GPSLatitude');
  expect(text).not.toContain('Photoshop');
  expect(text).not.toContain('Ember Lane');
  // What decides how the picture looks stays, and so does every byte of the picture itself.
  expect(text).toContain('JFIF');
  expect(text).toContain('ICC_PROFILE');
  expect(text).toContain('Adobe');
  expect(Buffer.from(clean).includes(Buffer.from(JPEG.subarray(2)))).toBe(true);
  expect(jpegOrientation(clean)).toBe(1);
  // Already clean, or not a JPEG at all: nothing changes.
  expect(Array.from(stripJpegMetadata(JPEG))).toEqual(Array.from(JPEG));
  const notJpeg = png(1, 1, [0, 0, 0, 255]);
  expect(stripJpegMetadata(notJpeg)).toBe(notJpeg);
  const truncated = noted.subarray(0, 40);
  expect(stripJpegMetadata(truncated)).toBe(truncated);
});

test('format decisions: as-is when a PDF can take it, PNG only for see-through pictures', () => {
  expect(sniffImage(JPEG)).toBe('jpeg');
  expect(sniffImage(png(1, 1, [0, 0, 0, 255]))).toBe('png');
  expect(sniffImage(new TextEncoder().encode('RIFF....WEBP'))).toBeNull();

  // JPEG and PNG go in untouched; turned photos too; mirrored ones and other formats are redrawn.
  expect(embedPlan('jpeg', 1, false)).toEqual({ original: true, redraw: false });
  expect(embedPlan('jpeg', 6, false)).toEqual({ original: true, redraw: false });
  expect(embedPlan('jpeg', 2, false)).toEqual({ original: false, redraw: true });
  expect(embedPlan('png', 1, false)).toEqual({ original: true, redraw: false });
  expect(embedPlan(null, 1, false)).toEqual({ original: false, redraw: true });
  // "Make it smaller" redraws, and still offers the original in case it's lighter.
  expect(embedPlan('jpeg', 1, true)).toEqual({ original: true, redraw: true });
  expect(embedPlan(null, 1, true)).toEqual({ original: false, redraw: true });

  expect(redrawType(true)).toBe('image/png');
  expect(redrawType(false)).toBe('image/jpeg');
  const opaque = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  expect(hasTransparency(opaque)).toBe(false);
  expect(hasTransparency(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 254]))).toBe(true);
  expect(hasTransparency(new Uint8ClampedArray())).toBe(false);

  expect(kindOf({ name: 'IMG_2041.HEIC', type: '' })).toBe('heic');
  expect(kindOf({ name: 'photo.jpg', type: 'image/jpeg' })).toBe('image');
  expect(kindOf({ name: 'scan.webp', type: '' })).toBe('image');
  expect(kindOf({ name: 'menu.pdf', type: 'application/pdf' })).toBe('pdf');
  expect(kindOf({ name: 'logo.svg', type: 'image/svg+xml' })).toBe('other');
  expect(kindOf({ name: 'notes.txt', type: 'text/plain' })).toBe('other');
});

test('redraws are never enlarged and always drawable', () => {
  expect(redrawSize({ width: 4032, height: 3024 }, true)).toEqual({
    width: 2400,
    height: 1800,
    capped: false,
  });
  expect(redrawSize({ width: 1200, height: 900 }, true)).toEqual({
    width: 1200,
    height: 900,
    capped: false,
  });
  expect(redrawSize({ width: 4032, height: 3024 }, false)).toEqual({
    width: 4032,
    height: 3024,
    capped: false,
  });
  // A 48-megapixel photo is brought down to what an iPhone can draw.
  const big = redrawSize({ width: 8064, height: 6048 }, false);
  expect(big.capped).toBe(true);
  expect(big.width * big.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  expect(big.width / big.height).toBeCloseTo(8064 / 6048, 2);
});

test('page images: pixel sizes by resolution, capped where browsers stop', () => {
  const letter = PAPER.letter;
  expect(pagePixels(letter, RESOLUTIONS.screen.dpi)).toMatchObject({ width: 816, height: 1056 });
  expect(pagePixels(letter, RESOLUTIONS.sharp.dpi)).toMatchObject({ width: 1275, height: 1650 });
  expect(pagePixels(letter, RESOLUTIONS.print.dpi)).toEqual({
    width: 2550,
    height: 3300,
    dpi: 300,
    capped: false,
  });
  expect(pagePixels(PAPER.a4, 300)).toMatchObject({ width: 2480, height: 3508 });

  // A poster at print size would be 97 megapixels: it's scaled down, and the real dpi is told.
  const poster = pagePixels({ width: 24 * 72, height: 36 * 72 }, 300);
  expect(poster.capped).toBe(true);
  expect(poster.width * poster.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  expect(poster.dpi).toBeLessThan(300);
  // A long strip stays under the longest side any browser draws.
  const strip = pagePixels({ width: 100, height: 72 * 60 }, 300);
  expect(strip.height).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
});

test('names: zero-padded page numbers, clean bases', () => {
  expect(baseName('Menu.pdf')).toBe('menu');
  expect(baseName('Lunch Menu — Fall.PDF')).toBe('lunch-menu-fall');
  expect(baseName('.pdf')).toBe('document');
  expect(baseName('Café menu.pdf')).toBe('cafe-menu');
  // A long name stops at a whole word, not halfway through "2026".
  expect(
    baseName('Northwind_Bistro_Quarterly_Menu_Final_Version_2026_Signed_Copy_For_Printing.pdf'),
  ).toBe('northwind-bistro-quarterly-menu-final-version');
  expect(pageImageName('menu', 0, 7, 'jpeg')).toBe('menu-page-01.jpg');
  expect(pageImageName('menu', 9, 12, 'png')).toBe('menu-page-10.png');
  expect(pageImageName('menu', 4, 150, 'jpeg')).toBe('menu-page-005.jpg');
  expect(pagesZipName('menu', 'png')).toBe('menu-pages-png.zip');
  expect(pdfName(['IMG_2041.jpg'])).toBe('img-2041.pdf');
  expect(pdfName(['IMG_2041.jpg', 'b.png', 'c.webp'])).toBe('img-2041-and-2-more.pdf');
  expect(pdfName([])).toBe('images.pdf');
  expect(sizeChange(1000, 260)).toBe('74% smaller');
  expect(sizeChange(1000, 1030)).toBe('3% larger');
  expect(sizeChange(1000, 1001)).toBe('about the same');
});

test('round trip: a PNG and a turned JPEG become a two-page PDF of the right sizes', async () => {
  const pictures = [
    { bytes: png(40, 30, [255, 154, 98, 255]), format: 'png' as const, orientation: 1 },
    // Stored 8 × 6, marked "turn a quarter turn clockwise": seen as 6 × 8, portrait.
    { bytes: withOrientation(JPEG, 6), format: 'jpeg' as const, orientation: 6 },
  ];
  const progress: number[] = [];
  const fit = await buildPdf(pictures.length, async (index) => pictures[index], DEFAULT_SETUP, {
    onProgress: (done) => progress.push(done),
  });
  expect(progress).toEqual([1, 2]);
  expect(fit.pages.map(({ index }) => index)).toEqual([0, 1]);
  expect(fit.pages.map(({ layout }) => [layout.width, layout.height])).toEqual([
    [30, 22.5],
    [4.5, 6],
  ]);

  const opened = await PDFDocument.load(fit.bytes);
  expect(opened.getPageCount()).toBe(2);
  expect(opened.getCreator()).toBe('Hyphy Tools · Convert');
  const sizes = opened.getPages().map((page) => page.getSize());
  expect(sizes[0].width).toBeCloseTo(30, 2);
  expect(sizes[0].height).toBeCloseTo(22.5, 2);
  expect(sizes[1].width).toBeCloseTo(4.5, 2);
  expect(sizes[1].height).toBeCloseTo(6, 2);

  // The photo went in as the very same JPEG (no re-encoding, EXIF left out), still stored 8 × 6.
  const jpegs = opened.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (object): object is PDFRawStream =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode'),
    );
  expect(jpegs).toHaveLength(1);
  expect(jpegs[0].dict.get(PDFName.of('Width'))).toEqual(PDFNumber.of(8));
  expect(jpegs[0].dict.get(PDFName.of('Height'))).toEqual(PDFNumber.of(6));
  expect(Array.from(jpegs[0].getContents())).toEqual(Array.from(JPEG));

  // On paper, each page turns to suit its picture.
  const paper = await buildPdf(
    pictures.length,
    async (index) => pictures[index],
    setup({ size: 'a4', orientation: 'auto' }),
  );
  const a4 = (await PDFDocument.load(paper.bytes)).getPages().map((page) => page.getSize());
  expect(a4[0].width).toBeCloseTo(PAPER.a4.height, 2);
  expect(a4[1].width).toBeCloseTo(PAPER.a4.width, 2);
});

test('unreadable pictures fall back to a redrawn copy or are left out; aborting stops', async () => {
  const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // a JPEG with nothing in it
  const redrawn = png(10, 20, [0, 0, 0, 128]);
  const result = await buildPdf(
    1,
    async () => ({
      bytes: broken,
      format: 'jpeg',
      orientation: 1,
      fallback: async () => ({ bytes: redrawn, format: 'png', orientation: 1 }),
    }),
    DEFAULT_SETUP,
  );
  const page = (await PDFDocument.load(result.bytes)).getPage(0).getSize();
  expect([page.width, page.height]).toEqual([7.5, 15]);

  await expect(
    buildPdf(1, async () => ({ bytes: broken, format: 'jpeg', orientation: 1 }), DEFAULT_SETUP),
  ).rejects.toThrow();

  // A picture that can't be opened is left out; the pages say which pictures they show.
  const kept = await buildPdf(
    3,
    async (index) =>
      index === 1 ? null : { bytes: png(4, 4, [0, 0, 0, 255]), format: 'png', orientation: 1 },
    DEFAULT_SETUP,
  );
  expect(kept.pages.map(({ index }) => index)).toEqual([0, 2]);
  expect((await PDFDocument.load(kept.bytes)).getPageCount()).toBe(2);
  await expect(buildPdf(2, async () => null, DEFAULT_SETUP)).rejects.toThrow(
    'None of these pictures could be opened here.',
  );

  const controller = new AbortController();
  controller.abort();
  await expect(
    buildPdf(1, async () => ({ bytes: redrawn, format: 'png', orientation: 1 }), DEFAULT_SETUP, {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
});
