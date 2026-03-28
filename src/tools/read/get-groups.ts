import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/read/get-groups.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'get_groups',
    {
      title: 'Get Groups',
      description: 'Get structure of groups, clipping masks, and compound paths',
      inputSchema: {
        layer_name: v.string().optional().describe('Filter by layer name (all layers if omitted)'),
        depth: v.number().optional().default(10).describe('Maximum traversal depth'),
        coordinate_system: v
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web'),
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
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
