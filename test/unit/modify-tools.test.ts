import { describe, expect, it } from 'vitest';
import { register as registerExport } from '../../src/tools/export/export.js';
import { register as registerExportPdf } from '../../src/tools/export/export-pdf.js';
import { register as registerApplyColorProfile } from '../../src/tools/modify/apply-color-profile.js';
import { register as registerConvertToOutlines } from '../../src/tools/modify/convert-to-outlines.js';
import { register as registerModifyObject } from '../../src/tools/modify/modify-object.js';
import { register as registerDeleteObjects } from '../../src/tools/modify/delete-objects.js';
import { register as registerCreateLine } from '../../src/tools/modify/create-line.js';
import { register as registerCreateTextFrame } from '../../src/tools/modify/create-text-frame.js';
import { register as registerCreatePathText } from '../../src/tools/modify/create-path-text.js';
import { register as registerPlaceImage } from '../../src/tools/modify/place-image.js';
import { register as registerImportSvgAsEditable } from '../../src/tools/modify/import-svg-as-editable.js';
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

  it('accepts tracking within Illustrator range in create_text_frame', () => {
    const schema = captureInputSchema(registerCreateTextFrame);
    const base = { x: 0, y: 0, contents: 'NGG' };

    expect(schema.safeParse({ ...base, tracking: 0 }).success).toBe(true);
    expect(schema.safeParse({ ...base, tracking: 120 }).success).toBe(true);
    expect(schema.safeParse({ ...base, tracking: -1000 }).success).toBe(true);
    expect(schema.safeParse({ ...base, tracking: 10000 }).success).toBe(true);

    // out of range
    expect(schema.safeParse({ ...base, tracking: -1001 }).success).toBe(false);
    expect(schema.safeParse({ ...base, tracking: 10001 }).success).toBe(false);
    // wrong type
    expect(schema.safeParse({ ...base, tracking: '120' }).success).toBe(false);
    // optional
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('accepts tracking in create_path_text and modify_object', () => {
    const pathTextSchema = captureInputSchema(registerCreatePathText);
    expect(pathTextSchema.safeParse({
      path_uuid: 'example-uuid', contents: 'NGG', tracking: 80,
    }).success).toBe(true);
    expect(pathTextSchema.safeParse({
      path_uuid: 'example-uuid', contents: 'NGG', tracking: 99999,
    }).success).toBe(false);

    const modifySchema = captureInputSchema(registerModifyObject);
    expect(modifySchema.safeParse({
      uuid: 'example-uuid', properties: { tracking: -50 },
    }).success).toBe(true);
    expect(modifySchema.safeParse({
      uuid: 'example-uuid', properties: { tracking: 'loose' },
    }).success).toBe(false);
  });

  it('accepts hidden / locked booleans in modify_object', () => {
    const schema = captureInputSchema(registerModifyObject);

    expect(schema.safeParse({
      uuid: 'example-uuid',
      properties: { hidden: true, locked: false },
    }).success).toBe(true);

    expect(schema.safeParse({
      uuid: 'example-uuid',
      properties: { hidden: 'yes' },
    }).success).toBe(false);
  });

  it('requires at least one uuid in delete_objects and defaults force_unlock to false', () => {
    const schema = captureInputSchema(registerDeleteObjects);

    expect(schema.safeParse({ uuids: [] }).success).toBe(false);
    expect(schema.safeParse({ uuids: ['a'] }).success).toBe(true);

    const parsed = schema.parse({ uuids: ['a', 'b'] }) as { uuids: string[]; force_unlock: boolean };
    expect(parsed.force_unlock).toBe(false);
    expect(schema.safeParse({ uuids: ['a'], force_unlock: true }).success).toBe(true);
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

  it('exposes import_svg_as_editable schema with expected fields', () => {
    const schema = captureInputSchema(registerImportSvgAsEditable);

    expect(schema.safeParse({ file_path: '/tmp/icon.svg' }).success).toBe(true);
    expect(
      schema.safeParse({
        file_path: '/tmp/icon.svg',
        x: 10,
        y: 20,
        layer_name: 'Imported',
        group: true,
        fit_to_artboard: false,
        padding: 8,
        name: 'icon',
      }).success,
    ).toBe(true);
    // file_path is required
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('place_image schema accepts non-svg path, advertises SVG is rejected', () => {
    const schema = captureInputSchema(registerPlaceImage);
    expect(schema.safeParse({ file_path: '/tmp/x.png' }).success).toBe(true);
    // Note: SVG runtime rejection is enforced in the JSX layer, not the schema.
    expect(schema.safeParse({ file_path: '/tmp/x.svg' }).success).toBe(true);
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
