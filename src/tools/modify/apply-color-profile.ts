import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/modify/apply-color-profile.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'apply_color_profile',
    {
      title: 'Apply Color Profile',
      description: 'Apply or convert color profile. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        profile: v.string().describe('Color profile name or path'),
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
