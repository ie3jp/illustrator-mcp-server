import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { fixPdfBleedBoxes } from '../../src/tools/export/export-pdf.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function makePdf(pages: Array<{ w: number; h: number; trim?: [number, number, number, number]; bleed?: [number, number, number, number] }>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'export-pdf-bleed-'));
  dirs.push(dir);
  const pdf = await PDFDocument.create();
  for (const p of pages) {
    const page = pdf.addPage([p.w, p.h]);
    if (p.trim) page.setTrimBox(...p.trim);
    if (p.bleed) page.setBleedBox(...p.bleed);
  }
  const path = join(dir, 'out.pdf');
  writeFileSync(path, await pdf.save());
  return path;
}

async function boxes(path: string) {
  const pdf = await PDFDocument.load(readFileSync(path));
  return pdf.getPages().map((p) => ({ media: p.getMediaBox(), trim: p.getTrimBox(), bleed: p.getBleedBox() }));
}

describe('fixPdfBleedBoxes', () => {
  it('artboard method: TrimBox = page minus bleed, BleedBox = page, on every page', async () => {
    // Letter artboards enlarged by 9 pt on each side (two artboards)
    const path = await makePdf([{ w: 630, h: 810 }, { w: 630, h: 810 }]);
    const extra = await fixPdfBleedBoxes(path, 'artboard', 9);
    expect(extra).toEqual({});
    for (const b of await boxes(path)) {
      expect(b.trim).toEqual({ x: 9, y: 9, width: 612, height: 792 });
      expect(b.bleed).toEqual({ x: 0, y: 0, width: 630, height: 810 });
    }
  });

  it('pdf_options method: warns when the PDF has no bleed (BleedBox = TrimBox)', async () => {
    // What Illustrator 29.1 writes for trimMarks + bleedOffsetRect: page grown for marks, but no bleed
    const path = await makePdf([{ w: 678, h: 858, trim: [33, 33, 612, 792], bleed: [33, 33, 612, 792] }]);
    const extra = await fixPdfBleedBoxes(path, 'pdf_options', 8.504);
    expect(extra.bleed_warning).toMatch(/1 of 1 page/);
  });

  it('pdf_options method: no warning and no rewrite when bleed is present', async () => {
    const path = await makePdf([{ w: 678, h: 858, trim: [33, 33, 612, 792], bleed: [24, 24, 630, 810] }]);
    const before = readFileSync(path);
    const extra = await fixPdfBleedBoxes(path, 'pdf_options', 9);
    expect(extra).toEqual({});
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});
