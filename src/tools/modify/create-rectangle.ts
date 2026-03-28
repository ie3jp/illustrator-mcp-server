import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX } from './shared.ts';
import { inlineTemplateText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineTemplateText('src/tools/modify/create-rectangle.jsx', {
  '__COLOR_HELPERS_JSX__': COLOR_HELPERS_JSX,
});

export function register(server: ToolRegistry): void {
  server.registerTool(
    'create_rectangle',
    {
      title: 'Create Rectangle',
      description: 'Create a rectangle. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        x: v.number().describe('Top-left X coordinate'),
        y: v.number().describe('Top-left Y coordinate'),
        width: v.number().describe('Width'),
        height: v.number().describe('Height'),
        corner_radius: v.number().optional().default(0).describe('Corner radius'),
        fill: colorSchema.describe('Fill color'),
        stroke: strokeSchema.describe('Stroke settings'),
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
