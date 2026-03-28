import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/read/list-text-frames.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'list_text_frames',
    {
      title: 'List Text Frames',
      description: 'List text frames with summary-level information',
      inputSchema: {
        layer_name: v.string().optional().describe('Filter by layer name'),
        artboard_index: v.number().int().min(0).optional().describe('Filter by artboard index (0-based integer)'),
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
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
