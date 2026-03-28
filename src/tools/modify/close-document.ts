import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/modify/close-document.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'close_document',
    {
      title: 'Close Document',
      description:
        'Close the active Illustrator document. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        save: v
          .boolean()
          .optional()
          .default(false)
          .describe('Whether to save before closing (default: false)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
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
