import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    ${COLOR_HELPERS_JSX}

    var x = params.x;
    var y = params.y;
    var w = params.width;
    var h = params.height;

    var page = resolveTargetPage(doc, params.page_index);
    var targetLayer = resolveTargetLayer(doc, params.layer_name);

    var rect = page.rectangles.add(targetLayer, LocationOptions.UNKNOWN, {
      geometricBounds: [y, x, y + h, x + w]
    });

    applyFill(rect, doc, params.fill);
    applyStroke(rect, doc, params.stroke);

    if (params.name) {
      rect.name = params.name;
    }

    var uuid = ensureUUID(rect);
    writeResultFile(RESULT_PATH, { uuid: uuid, verified: verifyItem(rect) });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create rectangle: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_rectangle',
    {
      title: 'Create Rectangle',
      description: 'Create a rectangle on the active InDesign document page.',
      inputSchema: {
        x: z.number().describe('Left edge X coordinate (points from page left)'),
        y: z.number().describe('Top edge Y coordinate (points from page top)'),
        width: z.number().describe('Width in points'),
        height: z.number().describe('Height in points'),
        fill: colorSchema.describe('Fill color'),
        stroke: strokeSchema.describe('Stroke settings'),
        layer_name: z.string().optional().describe('Target layer name (created if not exists)'),
        name: z.string().optional().describe('Object name'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index (default: active page)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
