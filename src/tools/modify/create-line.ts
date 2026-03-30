import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { strokeSchema, COLOR_HELPERS_JSX, WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    ${COLOR_HELPERS_JSX}

    var x1 = params.x1;
    var y1 = params.y1;
    var x2 = params.x2;
    var y2 = params.y2;

    var page = resolveTargetPage(doc, params.page_index);
    var targetLayer = resolveTargetLayer(doc, params.layer_name);

    // Use bounding rect for graphicLine placement then set path
    var top    = Math.min(y1, y2);
    var left   = Math.min(x1, x2);
    var bottom = Math.max(y1, y2);
    var right  = Math.max(x1, x2);

    // Avoid zero-dimension bounds
    if (top === bottom) { bottom = top + 0.001; }
    if (left === right) { right = left + 0.001; }

    var line = page.graphicLines.add(targetLayer, LocationOptions.UNKNOWN, {
      geometricBounds: [top, left, bottom, right]
    });

    // Set actual path endpoints
    line.paths[0].entirePath = [[x1, y1], [x2, y2]];

    applyStroke(line, doc, params.stroke);

    var uuid = ensureUUID(line);
    writeResultFile(RESULT_PATH, { uuid: uuid, verified: verifyItem(line) });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create line: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_line',
    {
      title: 'Create Line',
      description: 'Create a straight graphic line on the active InDesign document page.',
      inputSchema: {
        x1: z.number().describe('Start point X coordinate (points from page left)'),
        y1: z.number().describe('Start point Y coordinate (points from page top)'),
        x2: z.number().describe('End point X coordinate (points from page left)'),
        y2: z.number().describe('End point Y coordinate (points from page top)'),
        stroke: strokeSchema.describe('Stroke settings (color + weight)'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index (default: active page)'),
        layer_name: z.string().optional().describe('Target layer name (created if not exists)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
