'use client';
import { BASE_PATH } from '@/lib/base-path';
import { parseReceipt, type ParsedReceipt, type ReceiptLine } from './receipt';

/*
 * Who reads a receipt photo. Split talks to a `ReceiptReader`, never to an engine directly, so a
 * better reader (a vision model behind a Hyphy server route, say) can replace or back up the one
 * here without touching the tool. Each reader says where the photo goes, and Split shows exactly
 * that next to the camera button — a reader that uploads must say so.
 *
 * Today there's one: Tesseract, compiled to WebAssembly and served by this app (see
 * scripts/vendor-ocr.mjs). The photo is read in a worker on the device and never leaves it; the
 * first scan downloads the reader itself (about 4 MB, then cached by the browser).
 */

export type ReadProgress = {
  stage: 'preparing' | 'loading' | 'reading';
  /** 0–1 within the stage. */
  progress: number;
};

export type ReceiptReader = {
  id: string;
  /** Where the photo goes: shown to the person before they choose one. */
  where: 'device' | 'server';
  /** One plain sentence for the camera screen. */
  privacy: string;
  read(
    photo: Blob,
    options: { onProgress?: (progress: ReadProgress) => void; signal?: AbortSignal },
  ): Promise<ParsedReceipt>;
};

/**
 * The photo, ready to read: upright, at most 2000px on the long side, grey, with the contrast
 * stretched so faded thermal paper reads as ink.
 */
async function prepare(photo: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  // Tiny screenshots read better a little larger.
  const grow = Math.max(bitmap.width, bitmap.height) < 900 ? 1.6 : 1;
  const width = Math.round(bitmap.width * scale * grow);
  const height = Math.round(bitmap.height * scale * grow);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser can’t prepare the photo.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 4) {
    const grey = Math.round(
      0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2],
    );
    data[index] = grey;
    histogram[grey] += 1;
  }
  // Stretch between the 2nd and 98th percentiles.
  const pixels = width * height;
  let low = 0;
  let high = 255;
  for (let sum = 0, level = 0; level < 256; level += 1) {
    sum += histogram[level];
    if (sum > pixels * 0.02) {
      low = level;
      break;
    }
  }
  for (let sum = 0, level = 255; level >= 0; level -= 1) {
    sum += histogram[level];
    if (sum > pixels * 0.02) {
      high = level;
      break;
    }
  }
  const range = Math.max(24, high - low);
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.max(0, Math.min(255, ((data[index] - low) * 255) / range));
    data[index] = data[index + 1] = data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

type Line = { text: string; confidence: number };
type Block = { paragraphs?: { lines?: Line[] }[] };

const deviceReader: ReceiptReader = {
  id: 'device',
  where: 'device',
  privacy: 'Read right here on your device. The photo never leaves it.',
  async read(photo, { onProgress, signal } = {}) {
    const abort = () => {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    };
    onProgress?.({ stage: 'preparing', progress: 0 });
    const canvas = await prepare(photo);
    abort();

    const { createWorker, PSM } = await import('tesseract.js');
    abort();
    const vendor = `${window.location.origin}${BASE_PATH}/vendor/ocr`;
    const worker = await createWorker('eng', 1, {
      workerPath: `${vendor}/worker.min.js`,
      corePath: vendor,
      langPath: vendor,
      gzip: true,
      logger: (message: { status: string; progress: number }) => {
        if (message.status === 'recognizing text')
          onProgress?.({ stage: 'reading', progress: message.progress });
        else if (/loading|initializ/.test(message.status))
          onProgress?.({ stage: 'loading', progress: message.progress });
      },
    });
    const stop = () => void worker.terminate();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      abort();
      await worker.setParameters({
        // One block of rows: keeps each item's name and its price (far right) on the same line.
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
      });
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
      abort();
      const blocks = (data.blocks ?? []) as Block[];
      const lines: ReceiptLine[] = blocks.flatMap((block) =>
        (block.paragraphs ?? []).flatMap((paragraph) =>
          (paragraph.lines ?? []).map((line) => ({
            text: line.text,
            confidence: line.confidence,
          })),
        ),
      );
      return parseReceipt(lines.length ? lines : data.text.split('\n'));
    } finally {
      signal?.removeEventListener('abort', stop);
      stop();
    }
  },
};

/** The reader Split uses. */
export function receiptReader(): ReceiptReader {
  return deviceReader;
}
