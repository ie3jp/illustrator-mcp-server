import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var filePath = params.file_path;
    var imgFile = new File(filePath);
    if (!imgFile.exists) {
      writeResultFile(RESULT_PATH, { error: true, message: "Image file not found: " + filePath });
    } else {
      var page = resolveTargetPage(doc, params.page_index);
      var targetLayer = resolveTargetLayer(doc, params.layer_name);

      // Place returns an array of placed items
      var placed = page.place(imgFile)[0];

      if (targetLayer) {
        try { placed.itemLayer = targetLayer; } catch(e) {}
      }

      // If x/y/width/height specified, set geometric bounds
      if (typeof params.x === "number" && typeof params.y === "number") {
        var x = params.x;
        var y = params.y;
        var curBounds = placed.geometricBounds;
        var curW = curBounds[3] - curBounds[1];
        var curH = curBounds[2] - curBounds[0];
        var w = (typeof params.width  === "number") ? params.width  : curW;
        var h = (typeof params.height === "number") ? params.height : curH;
        placed.geometricBounds = [y, x, y + h, x + w];
        try { placed.fit(FitOptions.FILL_PROPORTIONALLY); } catch(e) {}
      } else if (typeof params.width === "number" && typeof params.height === "number") {
        var ob = placed.geometricBounds;
        placed.geometricBounds = [ob[0], ob[1], ob[0] + params.height, ob[1] + params.width];
        try { placed.fit(FitOptions.FILL_PROPORTIONALLY); } catch(e) {}
      }

      var uuid = ensureUUID(placed);
      var finalBounds = placed.geometricBounds;

      writeResultFile(RESULT_PATH, {
        uuid: uuid,
        filePath: filePath,
        verified: verifyItem(placed)
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to place image: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'place_image',
    {
      title: 'Place Image',
      description: 'Place an image file (PNG, JPG, TIFF, PSD, PDF, etc.) into an InDesign document page as a linked image.',
      inputSchema: {
        file_path: z.string().describe('Absolute path to the image file'),
        x: z.number().optional().describe('Left edge X position in points'),
        y: z.number().optional().describe('Top edge Y position in points'),
        width: z.number().optional().describe('Frame width in points'),
        height: z.number().optional().describe('Frame height in points'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index (default: active page)'),
        layer_name: z.string().optional().describe('Target layer name'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
