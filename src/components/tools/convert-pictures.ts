'use client';
import {
  embedPlan,
  hasTransparency,
  jpegOrientation,
  kindOf,
  REDRAW_QUALITY,
  redrawSize,
  redrawType,
  SMALLER,
  sniffImage,
  type PdfImage,
  type PdfSource,
  type Size,
} from '@/lib/tools/convert';

/*
 * Convert's pictures, on this device: reading a photo turned upright, redrawing it for a PDF, and
 * saving it as another format. Canvas work, so it lives beside the component rather than in
 * lib/tools/convert.ts (which stays pure and tested in Node).
 */

/** Picture thumbnails, long side in pixels: sharp in a tile on a phone, light in memory. */
const THUMB_SIDE = 360;

/* ---------------- Images → PDF: reading and redrawing pictures ---------------- */

export async function decode(file: Blob) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    // Browsers from before "from-image" reject the option itself; they turn photos anyway.
    if (error instanceof TypeError) return createImageBitmap(file);
    throw error;
  }
}

export const unreadable = (file: File) =>
  kindOf(file) === 'heic'
    ? `“${file.name}” is an iPhone HEIC photo, and only Safari opens those. Open this page in Safari, or share the photo as a JPG.`
    : `“${file.name}” couldn’t be opened here. Try JPG, PNG, WebP or GIF.`;

export function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('This picture is too big to save here.'))),
      type,
      quality,
    ),
  );
}

/** The picture as it's seen (turned upright), shrunk for its tile, and its real size. */
export async function readPicture(file: File): Promise<{ thumb: string; size: Size }> {
  const bitmap = await decode(file);
  const size = { width: bitmap.width, height: bitmap.height };
  const scale = Math.min(1, THUMB_SIDE / Math.max(size.width, size.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size.width * scale));
  canvas.height = Math.max(1, Math.round(size.height * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    // See-through parts show white, as they will on the page.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { thumb: canvas.toDataURL('image/jpeg', 0.8), size };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Looks for see-through pixels a band at a time, so a big picture never needs one huge copy. */
function seeThrough(context: CanvasRenderingContext2D, size: Size) {
  const rows = Math.max(1, Math.floor(1_000_000 / size.width));
  for (let top = 0; top < size.height; top += rows) {
    const band = context.getImageData(0, top, size.width, Math.min(rows, size.height - top));
    if (hasTransparency(band.data)) return true;
  }
  return false;
}

/** A picture redrawn as a JPEG (or a PNG, if it has see-through parts) a PDF can hold. */
async function redraw(
  file: File,
  smaller: boolean,
  opaque: boolean,
): Promise<PdfImage & { capped: boolean }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error(unreadable(file));
  }
  const size = redrawSize(bitmap, smaller);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: !opaque });
    if (!context) throw new Error('This browser couldn’t draw the picture.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const type = redrawType(!opaque && seeThrough(context, size));
    const blob = await toBlob(canvas, type, smaller ? SMALLER.quality : REDRAW_QUALITY);
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      format: type === 'image/png' ? 'png' : 'jpeg',
      orientation: 1,
      capped: size.capped,
    };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * One picture, ready for the PDF: the original bytes when a PDF can take them (the lossless
 * path), otherwise a redrawn copy. With "Make it smaller", whichever of the two is lighter.
 */
export async function sourceFor(
  file: File,
  smaller: boolean,
  notes: { capped: number },
): Promise<PdfSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffImage(bytes);
  const orientation = format === 'jpeg' ? jpegOrientation(bytes) : 1;
  const plan = embedPlan(format, orientation, smaller);
  const opaque = format === 'jpeg';
  let redrawn: Awaited<ReturnType<typeof redraw>> | null = null;
  if (plan.redraw) {
    try {
      redrawn = await redraw(file, smaller, opaque);
    } catch (error) {
      // Only "Make it smaller" wanted a redraw: the original still goes in as it is.
      if (!plan.original) throw error;
    }
  }
  if (plan.original && format && (!redrawn || bytes.length <= redrawn.bytes.length))
    return {
      bytes,
      format,
      orientation,
      fallback: async () => redrawn ?? redraw(file, smaller, opaque),
    };
  if (!redrawn) throw new Error(unreadable(file));
  if (redrawn.capped) notes.capped += 1;
  return redrawn;
}

/** Three photos drawn on this device, plainly samples, so the tool can be tried right away. */
export async function samplePhotos(): Promise<File[]> {
  // A seeded wobble, so the samples come out the same every time.
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const shoot = async (
    name: string,
    width: number,
    height: number,
    draw: (context: CanvasRenderingContext2D) => void,
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    draw(context);
    // Grain, so it weighs what a real photo weighs rather than a flat drawing.
    for (let index = 0; index < 40000; index += 1) {
      context.fillStyle = `rgba(${random() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + random() * 0.05})`;
      context.fillRect(random() * width, random() * height, 4 + random() * 14, 3);
    }
    const blob = await toBlob(canvas, 'image/jpeg', 0.92);
    canvas.width = 0;
    canvas.height = 0;
    return new File([blob], name, { type: 'image/jpeg' });
  };

  const sunset = await shoot('Sample sunset.jpg', 3200, 2400, (context) => {
    const sky = context.createLinearGradient(0, 0, 0, 1700);
    sky.addColorStop(0, '#f08f63');
    sky.addColorStop(0.55, '#f7c98f');
    sky.addColorStop(1, '#efe2c8');
    context.fillStyle = sky;
    context.fillRect(0, 0, 3200, 2400);
    context.fillStyle = '#fff3d6';
    context.beginPath();
    context.arc(2150, 900, 220, 0, Math.PI * 2);
    context.fill();
    const hills: [string, number, number][] = [
      ['#c08a66', 0.55, 150],
      ['#94664c', 0.64, 120],
      ['#5f4636', 0.76, 95],
      ['#33291f', 0.88, 70],
    ];
    for (const [color, base, amplitude] of hills) {
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(0, 2400);
      for (let x = 0; x <= 3200; x += 80)
        context.lineTo(x, 2400 * base + Math.sin(x / 330 + base * 9) * amplitude + random() * 30);
      context.lineTo(3200, 2400);
      context.fill();
    }
  });

  const doorway = await shoot('Sample doorway.jpg', 2400, 3200, (context) => {
    const wall = context.createLinearGradient(0, 0, 2400, 0);
    wall.addColorStop(0, '#e2a47e');
    wall.addColorStop(1, '#c8744d');
    context.fillStyle = wall;
    context.fillRect(0, 0, 2400, 3200);
    context.fillStyle = '#b8aea0';
    context.fillRect(0, 2660, 2400, 540);
    context.fillStyle = '#d3cabd';
    context.fillRect(560, 2560, 1280, 110);
    // The door: a pale arch around a teal door with two panels and a brass knob.
    const arch = (x: number, top: number, width: number, bottom: number) => {
      context.beginPath();
      context.moveTo(x, bottom);
      context.lineTo(x, top + width / 2);
      context.arc(x + width / 2, top + width / 2, width / 2, Math.PI, 0);
      context.lineTo(x + width, bottom);
      context.closePath();
      context.fill();
    };
    context.fillStyle = '#f2e7d8';
    arch(640, 620, 1120, 2560);
    context.fillStyle = '#2f6f73';
    arch(720, 700, 960, 2560);
    context.fillStyle = '#28605f';
    context.fillRect(820, 1320, 320, 560);
    context.fillRect(1260, 1320, 320, 560);
    context.fillRect(820, 1980, 320, 480);
    context.fillRect(1260, 1980, 320, 480);
    context.fillStyle = '#d8b45c';
    context.beginPath();
    context.arc(1560, 1900, 30, 0, Math.PI * 2);
    context.fill();
    // A potted plant by the step.
    context.fillStyle = '#b4552e';
    context.beginPath();
    context.moveTo(1880, 2320);
    context.lineTo(2200, 2320);
    context.lineTo(2150, 2660);
    context.lineTo(1930, 2660);
    context.closePath();
    context.fill();
    for (let leaf = 0; leaf < 14; leaf += 1) {
      context.fillStyle = leaf % 2 ? '#4f8a4b' : '#3d7040';
      context.beginPath();
      context.ellipse(
        2040 + (random() - 0.5) * 260,
        2140 - random() * 320,
        44,
        150,
        (random() - 0.5) * 1.6,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    const shade = context.createLinearGradient(0, 0, 2400, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.16)');
    context.fillStyle = shade;
    context.fillRect(0, 0, 2400, 3200);
  });

  const notes = await shoot('Sample notes.jpg', 2400, 1800, (context) => {
    context.fillStyle = '#8b5e3c';
    context.fillRect(0, 0, 2400, 1800);
    for (let line = 0; line < 70; line += 1) {
      const y = random() * 1800;
      context.strokeStyle = `rgba(60,35,20,${0.2 + random() * 0.25})`;
      context.lineWidth = 3 + random() * 8;
      context.beginPath();
      context.moveTo(0, y);
      for (let x = 0; x <= 2400; x += 120) context.lineTo(x, y + Math.sin(x / 260 + line) * 14);
      context.stroke();
    }
    // A sheet of lined paper, slightly turned, with a few lines of handwriting.
    context.save();
    context.translate(1150, 900);
    context.rotate(-0.05);
    context.fillStyle = 'rgba(0,0,0,0.28)';
    context.fillRect(-730, -520, 1500, 1100);
    context.fillStyle = '#fbfaf5';
    context.fillRect(-750, -550, 1500, 1100);
    context.strokeStyle = '#b9d3ee';
    context.lineWidth = 3;
    for (let y = -390; y < 530; y += 72) {
      context.beginPath();
      context.moveTo(-750, y);
      context.lineTo(750, y);
      context.stroke();
    }
    context.strokeStyle = '#e8a0a0';
    context.beginPath();
    context.moveTo(-600, -550);
    context.lineTo(-600, 550);
    context.stroke();
    context.fillStyle = '#27327a';
    context.font = 'italic 600 86px Georgia, serif';
    context.fillText('Sample notes', -560, -420);
    context.strokeStyle = '#2b3a8f';
    context.lineWidth = 6;
    context.lineCap = 'round';
    for (let row = 0; row < 9; row += 1) {
      const y = -330 + row * 72;
      const end = 200 + random() * 480;
      context.beginPath();
      context.moveTo(-560, y);
      for (let x = -560; x < end; x += 34)
        context.quadraticCurveTo(x + 17, y - 26 * random(), x + 34, y - 4 + 8 * random());
      context.stroke();
    }
    context.restore();
  });

  return [sunset, doorway, notes];
}

/* ---------------- Pictures → other pictures ---------------- */

export type ImageTarget = 'jpeg' | 'png' | 'webp';

export const IMAGE_TYPES: Record<ImageTarget, { type: string; ext: string; label: string }> = {
  jpeg: { type: 'image/jpeg', ext: 'jpg', label: 'JPG' },
  png: { type: 'image/png', ext: 'png', label: 'PNG' },
  webp: { type: 'image/webp', ext: 'webp', label: 'WebP' },
};

/**
 * One picture saved as another format, turned upright and at its full size (scaled down only
 * when it's bigger than a browser can draw). JPG has no see-through parts: those turn white.
 * Nothing but the pixels is copied, so camera details and location stay behind.
 */
export async function convertPicture(
  file: File,
  target: ImageTarget,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number; capped: boolean }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error(unreadable(file));
  }
  const size = redrawSize(bitmap, false);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser couldn’t draw the picture.');
    if (target === 'jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.width, size.height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const { type, label } = IMAGE_TYPES[target];
    const blob = await toBlob(canvas, type, target === 'png' ? undefined : quality);
    // A browser that can't write a format hands back a PNG instead: say so rather than mislabel it.
    if (blob.type !== type)
      throw new Error(`This browser can’t save ${label} files. Try JPG or PNG.`);
    return { blob, width: size.width, height: size.height, capped: size.capped };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** The format a picture is in, for people: “JPG”, “PNG”, “HEIC”. */
export function formatOf(file: { name: string; type: string }) {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const sub = file.type.toLowerCase().split('/')[1] ?? '';
  const raw = extension || sub;
  if (/^(jpe?g|jfif|pjpeg)$/.test(raw) || sub === 'jpeg') return 'JPG';
  if (raw === 'png' || sub === 'png') return 'PNG';
  if (raw === 'webp' || sub === 'webp') return 'WebP';
  if (/^hei[cf]$/.test(raw) || /^hei[cf]/.test(sub)) return 'HEIC';
  if (raw === 'pdf') return 'PDF';
  if (raw) return raw.toUpperCase().slice(0, 5);
  return kindOf(file) === 'image' ? 'Photo' : 'File';
}
