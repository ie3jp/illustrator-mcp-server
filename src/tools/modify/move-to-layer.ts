import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * move_to_layer — オブジェクトを別レイヤーに移動
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — PageItem.move()
 *
 * JSX API:
 *   PageItem.move(relativeObject: Layer, insertionLocation?: ElementPlacement) → PageItem
 *   ElementPlacement: PLACEATBEGINNING (最前面) | PLACEATEND (最背面)
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    // 同名のトップレベルレイヤーが複数あるときは最上位へ移動し、警告を返す
    var warnings = [];
    var resolvedLayer = resolveTopLevelLayer(doc, params.target_layer, warnings);
    var targetLayer = resolvedLayer ? resolvedLayer.layer : null;
    if (!targetLayer) {
      writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + params.target_layer });
    }

    if (targetLayer) {
      var placement = (params.position === "end")
        ? ElementPlacement.PLACEATEND
        : ElementPlacement.PLACEATBEGINNING;

      // アイテムごとに独立した操作なので見つかったものは移動し、欠落・失敗は結果で報告する
      var moved = [];
      var notFound = [];
      var errors = [];
      for (var i = 0; i < params.uuids.length; i++) {
        var item = findItemByUUID(params.uuids[i]);
        if (!item) {
          notFound.push(params.uuids[i]);
          continue;
        }
        try {
          item.move(targetLayer, placement);
          moved.push(item);
        } catch (moveErr) {
          errors.push({ uuid: params.uuids[i], message: moveErr.message });
        }
      }

      var verifiedItems = [];
      for (var vi = 0; vi < moved.length; vi++) {
        verifiedItems.push(verifyItem(moved[vi]));
      }
      var moveResult = {
        success: notFound.length === 0 && errors.length === 0,
        movedCount: moved.length,
        targetLayer: params.target_layer,
        notFound: notFound,
        errors: errors,
        verified: verifiedItems
      };
      if (warnings.length > 0) moveResult.warnings = warnings;
      writeResultFile(RESULT_PATH, moveResult);
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "move_to_layer failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'move_to_layer',
    {
      title: 'Move to Layer',
      description:
        'Move one or more objects to a different layer. Objects that are found are moved; missing UUIDs are listed in notFound and per-object failures in errors (success is false if either is non-empty). Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to move'),
        target_layer: z.string().describe('Target top-level layer name. If several layers share the name, the topmost one is used and a warning is returned'),
        position: z
          .enum(['beginning', 'end'])
          .optional()
          .default('beginning')
          .describe('beginning = front of layer, end = back of layer'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
