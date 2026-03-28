import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { colorSchema, COLOR_HELPERS_JSX, FONT_HELPERS_JSX } from './shared.ts';
import { inlineTemplateText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineTemplateText('src/tools/modify/create-text-frame.jsx', {
  '__COLOR_HELPERS_JSX__': COLOR_HELPERS_JSX,
  '__FONT_HELPERS_JSX__': FONT_HELPERS_JSX,
});

export function register(server: ToolRegistry): void {
  server.registerTool(
    'create_text_frame',
    {
      title: 'Create Text Frame',
      description: 'Create a text frame. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        x: v.number().describe('X coordinate'),
        y: v.number().describe('Y coordinate'),
        contents: v.string().describe('Text contents'),
        kind: v
          .enum(['point', 'area'])
          .optional()
          .default('point')
          .describe('Text frame type (point or area)'),
        width: v.number().optional().describe('Area text width'),
        height: v.number().optional().describe('Area text height'),
        font_name: v.string().optional().describe('Font name (partial match, e.g. "Arial", "Helvetica"). Use list_fonts to find exact PostScript names.'),
        font_size: v.number().optional().describe('Font size (pt)'),
        fill: colorSchema.describe('Text color'),
        layer_name: v.string().optional().describe('Target layer name'),
        name: v.string().optional().describe('Object name'),
        coordinate_system: v
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe('Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)'),
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
