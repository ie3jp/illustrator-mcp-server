import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { register as registerExport } from '../../src/tools/export/export.js';
import { register as registerExportPdf } from '../../src/tools/export/export-pdf.js';
import { register as registerModifyObject } from '../../src/tools/modify/modify-object.js';
import { register as registerCreateLine } from '../../src/tools/modify/create-line.js';
import { colorSchema } from '../../src/tools/modify/shared.js';

function captureInputSchema(register: (server: McpServer) => void) {
  let inputSchema: Record<string, z.ZodTypeAny> | undefined;
  const server = {
    registerTool: vi.fn((_name: string, config: { inputSchema: Record<string, z.ZodTypeAny> }) => {
      inputSchema = config.inputSchema;
    }),
  } as unknown as McpServer;

  register(server);

  if (!inputSchema) {
    throw new Error('Tool schema was not registered');
  }

  return z.object(inputSchema);
}

describe('modify tool schemas', () => {
  it('rejects incomplete RGB colors', () => {
    expect(colorSchema.safeParse({ type: 'rgb', r: 255 }).success).toBe(false);
  });

  it('accepts swatch color type', () => {
    expect(colorSchema.safeParse({ type: 'swatch', name: 'Black' }).success).toBe(true);
  });

  it('allows partial size updates in modify_object', () => {
    const schema = captureInputSchema(registerModifyObject);

    expect(schema.safeParse({
      uuid: 'example-uuid',
      properties: {
        size: { width: 120 },
      },
    }).success).toBe(true);

    expect(schema.safeParse({
      uuid: 'example-uuid',
      properties: {
        size: { height: 48 },
      },
    }).success).toBe(true);
  });

  it('allows create_line stroke updates without requiring weight', () => {
    const schema = captureInputSchema(registerCreateLine);

    expect(schema.safeParse({
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
      stroke: {
        color: { type: 'rgb', r: 10, g: 20, b: 30 },
      },
    }).success).toBe(true);
  });

  it('export and export_pdf do not have coordinate_system', () => {
    const exportSchema = captureInputSchema(registerExport);
    const exportPdfSchema = captureInputSchema(registerExportPdf);

    expect(exportSchema.shape).not.toHaveProperty('coordinate_system');
    expect(exportPdfSchema.shape).not.toHaveProperty('coordinate_system');
  });
});
