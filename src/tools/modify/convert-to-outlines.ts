import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/modify/convert-to-outlines.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'convert_to_outlines',
    {
      title: 'Convert to Outlines',
      description: 'Convert text to outlines. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        target: v
          .string()
          .describe('Target: "selection" (selected), "all" (all text), or layer name'),
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
