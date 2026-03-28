import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/read/get-colors.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'get_colors',
    {
      title: 'Get Colors',
      description: 'Get all color information used in the document',
      inputSchema: {
        include_swatches: v
          .boolean()
          .optional()
          .default(true)
          .describe('Include swatch list'),
        include_used_colors: v
          .boolean()
          .optional()
          .default(true)
          .describe('Include used color collection'),
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
