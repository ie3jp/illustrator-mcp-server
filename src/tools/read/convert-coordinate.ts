import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * convert_coordinate — 座標系間の座標変換（InDesign版）
 * Convert between page-relative and spread coordinates.
 * InDesign Y-axis is DOWN (no flip needed).
 * geometricBounds = [top, left, bottom, right]
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var fromSys = params.from;
    var toSys = params.to;
    var x = params.point.x;
    var y = params.point.y;
    var pageIndex = (typeof params.page_index === "number") ? params.page_index : 0;

    if (pageIndex < 0 || pageIndex >= doc.pages.length) {
      writeResultFile(RESULT_PATH, {
        error: true,
        message: "page_index " + pageIndex + " out of range (0-" + (doc.pages.length - 1) + ")"
      });
    } else {
      var pg = doc.pages[pageIndex];
      var pgBounds = pg.bounds; // [top, left, bottom, right]
      var pgTop = pgBounds[0];
      var pgLeft = pgBounds[1];

      var resultX = x;
      var resultY = y;

      if (fromSys === "page-relative" && toSys === "spread") {
        // ページ相対 → スプレッド: ページ原点オフセットを加算
        resultX = x + pgLeft;
        resultY = y + pgTop;
      } else if (fromSys === "spread" && toSys === "page-relative") {
        // スプレッド → ページ相対: ページ原点オフセットを減算
        resultX = x - pgLeft;
        resultY = y - pgTop;
      } else if (fromSys === toSys) {
        // 同一座標系なら変換なし
        resultX = x;
        resultY = y;
      } else {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "Invalid coordinate systems: from='" + fromSys + "', to='" + toSys + "'"
        });
        resultX = null;
      }

      if (resultX !== null) {
        writeResultFile(RESULT_PATH, {
          x: resultX,
          y: resultY,
          from: fromSys,
          to: toSys,
          pageIndex: pageIndex,
          pageOriginInSpread: { x: pgLeft, y: pgTop }
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "convert_coordinate failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'convert_coordinate',
    {
      title: 'Convert Coordinate',
      description:
        'Convert a point between page-relative and spread coordinate systems in InDesign. InDesign Y-axis is DOWN (top=0 increases downward). page-relative: origin at page top-left. spread: pasteboard/spread origin.',
      inputSchema: {
        point: z
          .object({
            x: z.number().describe('X value'),
            y: z.number().describe('Y value'),
          })
          .describe('Point to convert'),
        from: z
          .enum(['page-relative', 'spread'])
          .describe('Source coordinate system'),
        to: z
          .enum(['page-relative', 'spread'])
          .describe('Destination coordinate system'),
        page_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe('Page index (0-based) used for the page origin offset (default: 0)'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
