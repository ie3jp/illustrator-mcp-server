import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/read/find-objects.jsx');

const colorSchema = v.object({
  type: v.enum(['cmyk', 'rgb']),
  c: v.number().optional(),
  m: v.number().optional(),
  y: v.number().optional(),
  k: v.number().optional(),
  r: v.number().optional(),
  g: v.number().optional(),
  b: v.number().optional(),
  tolerance: v.number().optional(),
}).optional();

export function register(server: ToolRegistry): void {
  server.registerTool(
    'find_objects',
    {
      title: 'Find Objects',
      description: 'Search for objects by specified criteria',
      inputSchema: {
        name: v.string().optional().describe('Object name (partial match)'),
        type: v
          .enum(['text', 'path', 'image', 'group', 'compound-path', 'symbol'])
          .optional()
          .describe('Object type'),
        layer_name: v.string().optional().describe('Layer name'),
        fill_color: colorSchema.describe('Search by fill color (default tolerance: 5)'),
        stroke_color: colorSchema.describe('Search by stroke color (default tolerance: 5)'),
        font_name: v.string().optional().describe('Font name (partial match)'),
        font_size: v
          .object({
            min: v.number().optional(),
            max: v.number().optional(),
          })
          .optional()
          .describe('Font size range'),
        artboard_index: v.number().int().min(0).optional().describe('Artboard index (0-based integer)'),
        coordinate_system: v
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe('Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
