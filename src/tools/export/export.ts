import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsxHeavy } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/export/export.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'export',
    {
      title: 'Export',
      description: 'Export objects, groups, artboards, or selection. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        target: v
          .string()
          .describe('UUID, "artboard:<index>", or "selection"'),
        // WebP is not supported by ExtendScript API
        // format: v.enum(['svg', 'png', 'webp', 'jpg']).describe('Export format'),
        format: v.enum(['svg', 'png', 'jpg']).describe('Export format'),
        output_path: v.string().describe('Output file path'),
        scale: v.number().optional().default(1).describe('Scale factor'),
        svg_options: v
          .object({
            text_outline: v.boolean().optional().describe('Convert text to outlines'),
            css_properties: v.boolean().optional().describe('Export as CSS properties'),
            embed_images: v.boolean().optional().describe('Embed raster images'),
             id_naming: v
               .enum(['layer', 'object', 'auto'])
               .optional()
               .describe('ID naming scheme'),
             decimal_places: v.number().optional().describe('Decimal places'),
           })
           .optional()
           .describe('SVG export options'),
        raster_options: v
          .object({
            dpi: v.number().optional().describe('Resolution (DPI)'),
            background: v
              .string()
              .optional()
              .describe('"transparent", "white", or color code'),
             antialiasing: v.boolean().optional().describe('Anti-aliasing'),
           })
           .optional()
           .describe('Raster export options'),
       },
       annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsxHeavy(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
