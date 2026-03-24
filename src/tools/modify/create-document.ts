import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

const jsxCode = `
try {
  var verErr = checkIllustratorVersion();
  if (verErr) {
    writeResultFile(RESULT_PATH, verErr);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var w = params.width || 595.28;
    var h = params.height || 841.89;
    var colorMode = (params.color_mode === "cmyk")
      ? DocumentColorSpace.CMYK
      : DocumentColorSpace.RGB;

    var doc = app.documents.add(colorMode, w, h);

    // Set artboard to match requested size
    doc.artboards[0].artboardRect = [0, h, w, 0];

    writeResultFile(RESULT_PATH, {
      success: true,
      fileName: doc.name,
      width: w,
      height: h,
      colorMode: (colorMode === DocumentColorSpace.CMYK) ? "CMYK" : "RGB"
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "Failed to create document: " + e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_document',
    {
      title: 'Create Document',
      description:
        'Create a new Illustrator document. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        width: z
          .number()
          .optional()
          .default(595.28)
          .describe('Document width in points (default: A4 width 595.28pt)'),
        height: z
          .number()
          .optional()
          .default(841.89)
          .describe('Document height in points (default: A4 height 841.89pt)'),
        color_mode: z
          .enum(['rgb', 'cmyk'])
          .optional()
          .default('rgb')
          .describe('Color mode (default: rgb)'),
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
