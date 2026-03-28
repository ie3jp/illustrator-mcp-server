import type { ToolRegistry } from '../../src/tool-server.ts';
import { schema as v, type SchemaShape } from '../../src/schema.ts';
import { describe, expect, it, vi } from 'vitest';
import { register as registerExport } from '../../src/tools/export/export.ts';
import { register as registerExportPdf } from '../../src/tools/export/export-pdf.ts';
import { register as registerApplyColorProfile } from '../../src/tools/modify/apply-color-profile.ts';
import { register as registerConvertToOutlines } from '../../src/tools/modify/convert-to-outlines.ts';
import { register as registerModifyObject } from '../../src/tools/modify/modify-object.ts';
import { register as registerCreateLine } from '../../src/tools/modify/create-line.ts';
import { colorSchema } from '../../src/tools/modify/shared.ts';

function captureInputSchema(register: (server: ToolRegistry) => void) {
  let inputSchema: SchemaShape | undefined;
  const server = {
    registerTool: vi.fn((_name: string, config: { inputSchema: SchemaShape }) => {
      inputSchema = config.inputSchema;
    }),
  } as unknown as ToolRegistry;

  register(server);

  if (!inputSchema) {
    throw new Error('Tool schema was not registered');
  }

  return v.object(inputSchema);
}

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
