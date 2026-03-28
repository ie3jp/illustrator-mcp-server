import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX } from './shared.ts';
import { inlineTemplateText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineTemplateText('src/tools/modify/create-path.jsx', {
  '__COLOR_HELPERS_JSX__': COLOR_HELPERS_JSX,
});

const anchorSchema = v.object({
  x: v.number().describe('Anchor point X coordinate'),
  y: v.number().describe('Anchor point Y coordinate'),
  left_handle: v
    .object({
      x: v.number(),
      y: v.number(),
    })
    .optional()
    .describe('Left direction handle coordinates'),
  right_handle: v
    .object({
      x: v.number(),
      y: v.number(),
    })
    .optional()
    .describe('Right direction handle coordinates'),
  point_type: v
    .enum(['corner', 'smooth'])
    .optional()
    .default('corner')
    .describe('Point type'),
});

export function register(server: ToolRegistry): void {
  server.registerTool(
    'create_path',
    {
      title: 'Create Path',
      description: 'Create a custom path. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        anchors: v.array(anchorSchema).describe('Array of anchor points'),
        closed: v.boolean().optional().default(false).describe('Whether to close the path'),
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
