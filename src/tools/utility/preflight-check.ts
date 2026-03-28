import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { readImageDimensions } from '../../utils/image-header.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/utility/preflight-check.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'preflight_check',
    {
      title: 'Preflight Check',
      description: 'Run pre-press quality checks',
      inputSchema: {
        coordinate_system: v
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web'),
        min_dpi: v
          .number()
          .int()
          .min(1)
          .optional()
          .default(300)
          .describe('Minimum acceptable DPI for images (default: 300)'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = (await executeJsx(jsxCode, params)) as {
        checkCount: number;
        results: Array<{
          level: string;
          category: string;
          message: string;
          uuid: string | null;
          details: Record<string, unknown>;
        }>;
        placedImageData?: Array<{
          uuid: string;
          name: string;
          filePath: string;
          widthPt: number;
          heightPt: number;
        }>;
        minDPI?: number;
        [key: string]: unknown;
      };

      // Post-process: check PlacedItem DPI using Node.js file reading
      const minDpi = result?.minDPI ?? params.min_dpi ?? 300;
      if (result?.placedImageData) {
        for (const placed of result.placedImageData) {
          if (!placed.filePath || placed.widthPt <= 0 || placed.heightPt <= 0) continue;
          try {
            const dims = readImageDimensions(placed.filePath);
            if (dims) {
              const widthInches = placed.widthPt / 72;
              const heightInches = placed.heightPt / 72;
              const ppiH = Math.round(dims.width / widthInches);
              const ppiV = Math.round(dims.height / heightInches);
              const effectivePPI = Math.min(ppiH, ppiV);
              if (effectivePPI < minDpi) {
                result.results.push({
                  level: 'error',
                  category: 'low_resolution',
                  message: `Linked image resolution ${effectivePPI} DPI is below minimum ${minDpi} DPI`,
                  uuid: placed.uuid,
                  details: {
                    name: placed.name,
                    effectivePPI,
                    minDPI: minDpi,
                    pixelWidth: dims.width,
                    pixelHeight: dims.height,
                    filePath: placed.filePath,
                  },
                });
              }
            }
          } catch {
            // Skip unreadable files
          }
        }
        delete result.placedImageData;
        delete result.minDPI;
        result.checkCount = result.results.length;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
