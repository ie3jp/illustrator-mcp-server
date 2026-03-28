import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/modify/place-image.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'place_image',
    {
      title: 'Place Image',
      description:
        'Place an image file (PNG, JPG, TIFF, PSD, etc.) into the document as a linked or embedded image. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        file_path: v.string().describe('Absolute path to the image file'),
        x: v.number().optional().describe('X position'),
        y: v.number().optional().describe('Y position'),
        embed: v
          .boolean()
          .optional()
          .default(false)
          .describe('Embed the image instead of linking (default: false)'),
        layer_name: v.string().optional().describe('Target layer name'),
        name: v.string().optional().describe('Object name'),
        coordinate_system: v
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe(
            'Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)',
          ),
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
