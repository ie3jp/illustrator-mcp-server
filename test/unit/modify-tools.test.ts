import { describe, expect, it } from 'vitest';
import { register as registerExport } from '../../src/tools/export/export.js';
import { register as registerExportPdf } from '../../src/tools/export/export-pdf.js';
import { register as registerApplyColorProfile } from '../../src/tools/modify/apply-color-profile.js';
import { register as registerConvertToOutlines } from '../../src/tools/modify/convert-to-outlines.js';
import { register as registerModifyObject } from '../../src/tools/modify/modify-object.js';
import { register as registerCreateLine } from '../../src/tools/modify/create-line.js';
import { colorSchema } from '../../src/tools/modify/shared.js';
import { captureInputSchema } from './helpers/tool-schema.js';

describe('modify tool schemas', () => {
  it('rejects incomplete RGB colors', () => {
    expect(colorSchema.safeParse({ type: 'rgb', r: 255 }).success).toBe(false);
  });

  it('allows partial size updates and stroke updates in modify_object', () => {
    const schema = captureInputSchema(registerModifyObject);

    expect(schema.safeParse({
      uuid: 'example-uuid',
      properties: {
        size: { width: 120 },
        stroke: { color: { type: 'none' } },
      },
    }).success).toBe(true);

    expect(schema.safeParse({
      uuid: 'example-uuid',
      properties: {
        size: { height: 48 },
        stroke: { width: 2 },
      },
    }).success).toBe(true);
  });

  it('allows create_line stroke updates without requiring width', () => {
    const schema = captureInputSchema(registerCreateLine);

    expect(schema.safeParse({
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
      stroke: {
        color: { type: 'rgb', r: 10, g: 20, b: 30 },
        cap: 'round',
      },
    }).success).toBe(true);
  });

  it('removes coordinate_system from tools that do not use coordinates', () => {
    const exportSchema = captureInputSchema(registerExport);
    const exportPdfSchema = captureInputSchema(registerExportPdf);
    const outlinesSchema = captureInputSchema(registerConvertToOutlines);
    const colorProfileSchema = captureInputSchema(registerApplyColorProfile);

    expect(exportSchema.shape).not.toHaveProperty('coordinate_system');
    expect(exportPdfSchema.shape).not.toHaveProperty('coordinate_system');
    expect(outlinesSchema.shape).not.toHaveProperty('coordinate_system');
    expect(colorProfileSchema.shape).not.toHaveProperty('coordinate_system');
  });
});
