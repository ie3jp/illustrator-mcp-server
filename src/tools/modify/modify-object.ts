import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, FONT_HELPERS_JSX } from './shared.ts';
import { inlineTemplateText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineTemplateText('src/tools/modify/modify-object.jsx', {
  '__COLOR_HELPERS_JSX__': COLOR_HELPERS_JSX,
  '__FONT_HELPERS_JSX__': FONT_HELPERS_JSX,
});

export function register(server: ToolRegistry): void {
  server.registerTool(
    'modify_object',
    {
      title: 'Modify Object',
      description: 'Modify properties of an existing object. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuid: v.string().describe('UUID of the target object'),
        properties: v
          .object({
            position: v
              .object({
                x: v.number().describe('X coordinate'),
                y: v.number().describe('Y coordinate'),
              })
              .optional()
              .describe('Position'),
            size: v
              .object({
                width: v.number().optional().describe('Width'),
                height: v.number().optional().describe('Height'),
              })
              .optional()
              .describe('Size'),
            fill: colorSchema.describe('Fill color'),
            stroke: strokeSchema.describe('Stroke settings'),
            opacity: v.number().optional().describe('Opacity (0-100)'),
            rotation: v.number().optional().describe('Rotation delta in degrees (additive — each call adds to current rotation)'),
            name: v.string().optional().describe('Object name'),
            contents: v.string().optional().describe('Text contents (for text frames)'),
            font_name: v.string().optional().describe('Font name for text frames (partial match supported)'),
            font_size: v.number().optional().describe('Font size (for text frames)'),
          })
          .describe('Properties to modify'),
        coordinate_system: v
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe('Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)'),
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
