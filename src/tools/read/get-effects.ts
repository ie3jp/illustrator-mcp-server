import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/read/get-effects.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'get_effects',
    {
      title: 'Get Effects',
      description: 'Get effect and appearance information',
      inputSchema: {
        target: v.string().optional().describe('Filter by UUID for a specific object'),
        selection_only: v.boolean().optional().default(false).describe('Selected objects only'),
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
