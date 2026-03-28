import type { ToolRegistry } from '../../tool-server.ts';
import { schema as v } from '../../schema.ts';
import { executeJsx } from '../../executor/jsx-runner.ts';
import { readImageDimensions } from '../../utils/image-header.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


export const jsxCode = inlineText('src/tools/read/get-images.jsx');

export function register(server: ToolRegistry): void {
  server.registerTool(
    'get_images',
    {
      title: 'Get Images',
      description: 'Get embedded and linked image information',
      inputSchema: {
        coordinate_system: v
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web'),
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
        imageCount: number;
        coordinateSystem: string;
        images: Array<{
          type: string;
          filePath: string;
          linkBroken: boolean;
          pixelWidth: number | null;
          pixelHeight: number | null;
          resolution: number | null;
          widthPt?: number | null;
          heightPt?: number | null;
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      };

      // Post-process: compute pixel dimensions and DPI for linked images
      if (result?.images) {
        for (const img of result.images) {
          if (img.type === 'linked' && img.filePath && !img.linkBroken) {
            try {
              const dims = readImageDimensions(img.filePath);
              if (dims && img.widthPt && img.heightPt) {
                img.pixelWidth = dims.width;
                img.pixelHeight = dims.height;
                const widthInches = img.widthPt / 72;
                const heightInches = img.heightPt / 72;
                const ppiH = Math.round(dims.width / widthInches);
                const ppiV = Math.round(dims.height / heightInches);
                img.resolution = Math.min(ppiH, ppiV);
              }
            } catch {
              // Skip unreadable files
            }
          }
          // Clean up internal fields
          delete img.widthPt;
          delete img.heightPt;
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
