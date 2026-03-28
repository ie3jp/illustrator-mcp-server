import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/modify/create-document.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'create_document',
    {
      title: 'Create Document',
      description:
        'Create a new Illustrator document. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        width: v
          .number()
          .optional()
          .default(595.28)
          .describe('Document width in points (default: A4 width 595.28pt)'),
        height: v
          .number()
          .optional()
          .default(841.89)
          .describe('Document height in points (default: A4 height 841.89pt)'),
        color_mode: v
          .enum(['rgb', 'cmyk'])
          .optional()
          .default('rgb')
          .describe('Color mode (default: rgb)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
