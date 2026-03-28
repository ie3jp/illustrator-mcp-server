import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/read/get-path-items.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'get_path_items',
    {
      title: 'Get Path Items',
      description: 'Get path and shape data',
      inputSchema: {
        layer_name: v
          .string()
          .optional()
          .describe('Filter by layer name'),
        include_points: v
          .boolean()
          .optional()
          .default(false)
          .describe('Include anchor point details'),
        selection_only: v
          .boolean()
          .optional()
          .default(false)
          .describe('Get selected paths only'),
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
