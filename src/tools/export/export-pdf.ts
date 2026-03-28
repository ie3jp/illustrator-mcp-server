import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsxHeavy } from '../../executor/jsx-runner.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/export/export-pdf.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'export_pdf',
    {
      title: 'Export PDF',
      description: 'Export print-ready PDF. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        output_path: v.string().describe('Output file path'),
        preset: v
          .string()
          .optional()
          .describe('PDF preset name (e.g. "[PDF/X-4:2008]")'),
        options: v
          .object({
            trim_marks: v.boolean().optional().describe('Add trim marks'),
            marks_style: v.enum(['japanese', 'roman']).optional().describe('Trim mark style (japanese or roman)'),
            trim_mark_weight: v.enum(['0.125', '0.25', '0.5']).optional().describe('Trim mark weight (pt)'),
            registration_marks: v.boolean().optional().describe('Registration marks'),
            color_bars: v.boolean().optional().describe('Color bars'),
            page_information: v.boolean().optional().describe('Page information'),
            bleed: v.boolean().optional().describe('Include bleed (3mm)'),
            downsample: v.boolean().optional().describe('Downsample images'),
          })
          .optional()
          .describe('PDF export options'),
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
