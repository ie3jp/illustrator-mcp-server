import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * manage_artboards — アートボードの追加・削除・リサイズ・リネーム・整列
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Artboards/ — Artboards collection
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — Document.rearrangeArtboards(), fitArtboardToSelectedArt()
 *
 * JSX API:
 *   Artboards.add(artboardRect: Rect) → Artboard
 *   Artboards.remove(index: Number) → void  ※最後の1つは削除不可
 *   Artboard.artboardRect → Rect [left, top, right, bottom] (writable)
 *   Artboard.name → String (writable)
 *   Document.fitArtboardToSelectedArt([index]) → Boolean  ※要選択
 *   Document.rearrangeArtboards(layout, rowsOrCols, spacing, moveArtwork) → Boolean
 *
 * rect パラメータはドキュメント座標系 (Y-up)。artboardRect への変換:
 *   [r.x, r.y + r.height, r.x + r.width, r.y]
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;

    if (action === "add") {
      if (!params.rect) {
        writeResultFile(RESULT_PATH, { error: true, message: "rect is required for add action" });
      } else {
        var r = params.rect;
        // artboardRect = [left, top, right, bottom] (document coordinates, Y-up)
        var abRect = [r.x, r.y + r.height, r.x + r.width, r.y];
        var ab = doc.artboards.add(abRect);
        invalidateArtboardCache();
        if (params.name) ab.name = params.name;
        var addedRect = ab.artboardRect;
        writeResultFile(RESULT_PATH, {
          success: true,
          index: doc.artboards.length - 1,
          name: ab.name,
          verified: { artboardRect: addedRect }
        });
      }
    } else if (action === "remove") {
      if (typeof params.index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "index is required for remove action" });
      } else if (doc.artboards.length <= 1) {
        writeResultFile(RESULT_PATH, { error: true, message: "Cannot remove the last artboard" });
      } else {
        // Artboards.remove(index: Number) → void
        doc.artboards.remove(params.index);
        invalidateArtboardCache();
        writeResultFile(RESULT_PATH, { success: true, removedIndex: params.index });
      }
    } else if (action === "resize") {
      if (typeof params.index !== "number" || !params.rect) {
        writeResultFile(RESULT_PATH, { error: true, message: "index and rect required for resize" });
      } else {
        var r2 = params.rect;
        // Artboard.artboardRect = [left, top, right, bottom] (document coordinates, Y-up)
        doc.artboards[params.index].artboardRect = [r2.x, r2.y + r2.height, r2.x + r2.width, r2.y];
        var resizedRect = doc.artboards[params.index].artboardRect;
        writeResultFile(RESULT_PATH, { success: true, index: params.index, verified: { artboardRect: resizedRect } });
      }
    } else if (action === "rename") {
      if (typeof params.index !== "number" || !params.name) {
        writeResultFile(RESULT_PATH, { error: true, message: "index and name required for rename" });
      } else {
        doc.artboards[params.index].name = params.name;
        var renamedName = doc.artboards[params.index].name;
        writeResultFile(RESULT_PATH, { success: true, index: params.index, name: params.name, verified: { name: renamedName } });
      }
    } else if (action === "fit_to_art") {
      if (!doc.selection || doc.selection.length === 0) {
        writeResultFile(RESULT_PATH, { error: true, message: "fit_to_art requires objects to be selected first" });
      } else {
        var fitIdx = (typeof params.index === "number") ? params.index : 0;
        doc.fitArtboardToSelectedArt(fitIdx);
        writeResultFile(RESULT_PATH, { success: true, index: fitIdx, verified: { artboardRect: doc.artboards[fitIdx].artboardRect } });
      }
    } else if (action === "rearrange") {
      var layoutMap = {
        "grid_by_row": DocumentArtboardLayout.GridByRow,
        "grid_by_col": DocumentArtboardLayout.GridByCol,
        "row": DocumentArtboardLayout.Row,
        "column": DocumentArtboardLayout.Column
      };
      var layout = layoutMap[params.layout] || DocumentArtboardLayout.GridByRow;
      var rowsOrCols = params.rows_or_cols || 1;
      var spacing = (typeof params.spacing === "number") ? params.spacing : 20;
      doc.rearrangeArtboards(layout, rowsOrCols, spacing, true);
      var rearrangedInfo = [];
      for (var rai = 0; rai < doc.artboards.length; rai++) {
        rearrangedInfo.push({ index: rai, name: doc.artboards[rai].name, rect: doc.artboards[rai].artboardRect });
      }
      writeResultFile(RESULT_PATH, { success: true, verified: { artboardCount: doc.artboards.length, artboards: rearrangedInfo } });
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_artboards failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_artboards',
    {
      title: 'Manage Artboards',
      description:
        'Add, remove, resize, rename, fit, or rearrange artboards. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        action: z
          .enum(['add', 'remove', 'resize', 'rename', 'fit_to_art', 'rearrange'])
          .describe('Action to perform'),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Target artboard index (0-based). Required for remove/resize/rename/fit_to_art. Note: the last remaining artboard cannot be removed.'),
        rect: z
          .object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          })
          .optional()
          .describe('Position and size for add/resize (document coordinates)'),
        name: z.string().optional().describe('New name for rename action'),
        layout: z
          .enum(['grid_by_row', 'grid_by_col', 'row', 'column'])
          .optional()
          .describe('Artboard layout for rearrange'),
        rows_or_cols: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Number of rows or columns for rearrange'),
        spacing: z.number().optional().default(20).describe('Spacing in points for rearrange'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
