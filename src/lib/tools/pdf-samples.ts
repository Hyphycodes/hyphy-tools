/**
 * Sample PDFs, drawn on this device with pdf-lib, so anyone can try Merge or Extract without
 * hunting for a file. They are plainly samples: generic documents from an invented company.
 */
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';

type Doc = {
  name: string;
  accent: [number, number, number];
  pages: { title: string; kind: 'letter' | 'table' | 'photos' | 'signature' }[];
};

const merge: Doc[] = [
  {
    name: 'Sample invoice.pdf',
    accent: [1, 0.42, 0.24],
    pages: [{ title: 'Invoice 1042', kind: 'table' }],
  },
  {
    name: 'Sample permit.pdf',
    accent: [0.2, 0.25, 1],
    pages: [
      { title: 'Building permit', kind: 'letter' },
      { title: 'Conditions', kind: 'letter' },
    ],
  },
  {
    name: 'Sample photo log.pdf',
    accent: [0.13, 0.83, 0.57],
    pages: [
      { title: 'Photo log — week 1', kind: 'photos' },
      { title: 'Photo log — week 2', kind: 'photos' },
      { title: 'Photo log — week 3', kind: 'photos' },
    ],
  },
];

const extract: Doc[] = [
  {
    name: 'Sample contract packet.pdf',
    accent: [0.09, 0.08, 0.06],
    pages: [
      { title: 'Contract packet', kind: 'letter' },
      { title: 'Scope of work', kind: 'letter' },
      { title: 'Schedule', kind: 'table' },
      { title: 'Pricing', kind: 'table' },
      { title: 'Site photos', kind: 'photos' },
      { title: 'Terms', kind: 'letter' },
      { title: 'Signatures', kind: 'signature' },
    ],
  },
];

function drawPage(
  page: PDFPage,
  doc: Doc,
  index: number,
  fonts: { bold: PDFFont; regular: PDFFont },
  rgb: (r: number, g: number, b: number) => RGB,
) {
  const { width, height } = page.getSize();
  const accent = rgb(...doc.accent);
  const ink = rgb(0.09, 0.08, 0.06);
  const line = rgb(0.86, 0.85, 0.82);
  const soft = rgb(0.95, 0.94, 0.92);
  const spec = doc.pages[index];

  page.drawRectangle({ x: 0, y: height - 14, width, height: 14, color: accent });
  page.drawText('SAMPLE CO.', { x: 56, y: height - 62, size: 10, font: fonts.bold, color: ink });
  page.drawText(`${index + 1} / ${doc.pages.length}`, {
    x: width - 96,
    y: height - 62,
    size: 10,
    font: fonts.regular,
    color: rgb(0.45, 0.43, 0.39),
  });
  page.drawText(spec.title, { x: 56, y: height - 120, size: 30, font: fonts.bold, color: ink });
  page.drawRectangle({ x: 56, y: height - 140, width: 64, height: 4, color: accent });

  const top = height - 190;
  if (spec.kind === 'letter') {
    for (let row = 0; row < 16; row += 1) {
      const short = row % 5 === 4;
      page.drawRectangle({
        x: 56,
        y: top - row * 24,
        width: short ? 260 : width - 112 - (row % 3) * 30,
        height: 7,
        color: line,
      });
    }
  } else if (spec.kind === 'table') {
    page.drawRectangle({ x: 56, y: top - 8, width: width - 112, height: 26, color: soft });
    for (let row = 1; row < 11; row += 1) {
      const y = top - row * 34;
      page.drawRectangle({ x: 56, y, width: 220 - (row % 4) * 24, height: 7, color: line });
      page.drawRectangle({ x: width - 136, y, width: 80, height: 7, color: line });
      page.drawLine({
        start: { x: 56, y: y - 14 },
        end: { x: width - 56, y: y - 14 },
        thickness: 0.6,
        color: line,
      });
    }
    page.drawRectangle({ x: width - 216, y: top - 400, width: 160, height: 34, color: accent });
  } else if (spec.kind === 'photos') {
    const size = (width - 112 - 16) / 2;
    for (let cell = 0; cell < 4; cell += 1) {
      const x = 56 + (cell % 2) * (size + 16);
      const y = top - size - Math.floor(cell / 2) * (size + 16);
      const shade = 0.55 + ((cell + index) % 4) * 0.08;
      page.drawRectangle({
        x,
        y,
        width: size,
        height: size,
        color: rgb(shade, shade - 0.06, shade - 0.14),
      });
      page.drawRectangle({
        x,
        y,
        width: size,
        height: size * 0.38,
        color: rgb(shade - 0.18, shade - 0.22, shade - 0.26),
      });
    }
  } else {
    for (let block = 0; block < 2; block += 1) {
      const y = top - 120 - block * 180;
      page.drawLine({ start: { x: 56, y }, end: { x: 300, y }, thickness: 1, color: ink });
      page.drawRectangle({ x: 56, y: y - 22, width: 120, height: 7, color: line });
      page.drawText(block ? 'Owner' : 'Contractor', {
        x: 56,
        y: y + 12,
        size: 11,
        font: fonts.regular,
        color: rgb(0.45, 0.43, 0.39),
      });
    }
  }
  page.drawText('Sample document made on this device by Hyphy Tools', {
    x: 56,
    y: 40,
    size: 8,
    font: fonts.regular,
    color: rgb(0.63, 0.61, 0.57),
  });
}

/** Three short PDFs to merge, or one seven-page packet to pull pages from. */
export async function samplePdfs(mode: 'merge' | 'extract'): Promise<File[]> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const files: File[] = [];
  for (const doc of mode === 'merge' ? merge : extract) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(doc.name.replace(/\.pdf$/, ''));
    const fonts = {
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      regular: await pdf.embedFont(StandardFonts.Helvetica),
    };
    doc.pages.forEach((_, index) => drawPage(pdf.addPage([612, 792]), doc, index, fonts, rgb));
    const bytes = await pdf.save();
    files.push(new File([new Uint8Array(bytes)], doc.name, { type: 'application/pdf' }));
  }
  return files;
}
