import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/read/get-layers.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'get_layers',
    {
      title: 'Get Layers',
      description: 'Get layer structure as a tree',
      inputSchema: {
        include_sublayers: v
          .boolean()
          .optional()
          .default(true)
          .describe('Include sublayers'),
        include_items: v
          .boolean()
          .optional()
          .default(false)
          .describe('Include items within each layer'),
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
