import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { coordinateSystemSchema } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * duplicate_objects — オブジェクトの複製（オフセット・別レイヤー指定可）
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — PageItem.duplicate(), PageItem.translate()
 *
 * JSX API:
 *   PageItem.duplicate([relativeObject] [, insertionLocation: ElementPlacement]) → PageItem
 *   PageItem.translate(deltaX: Number, deltaY: Number) → void
 *
 * artboard-web 座標系の場合、offset.y を反転して translate に渡す。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";

    var targetLayer = null;
    var layerError = false;
    if (params.target_layer) {
      try {
        targetLayer = doc.layers.getByName(params.target_layer);
      } catch(e) {
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + params.target_layer });
        layerError = true;
      }
    }

    if (!layerError) {
      var results = [];
      for (var i = 0; i < params.uuids.length; i++) {
        var item = findItemByUUID(params.uuids[i]);
        if (!item) continue;

        var dup;
        if (targetLayer) {
          dup = item.duplicate(targetLayer, ElementPlacement.PLACEATEND);
        } else {
          dup = item.duplicate();
        }

        if (params.offset) {
          var dx = params.offset.x || 0;
          var dy = params.offset.y || 0;
          if (coordSystem === "artboard-web") {
            dup.translate(dx, -dy);
          } else {
            dup.translate(dx, dy);
          }
        }

        var uuid = ensureUUID(dup);
        results.push({ sourceUuid: params.uuids[i], newUuid: uuid, verified: verifyItem(dup) });
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        duplicatedCount: results.length,
        items: results
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "duplicate_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'duplicate_objects',
    {
      title: 'Duplicate Objects',
      description:
        'Duplicate one or more objects, optionally offsetting the copies. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to duplicate'),
        offset: z
          .object({
            x: z.number().describe('X offset from original'),
            y: z.number().describe('Y offset from original'),
          })
          .optional()
          .describe('Offset for duplicated objects'),
        target_layer: z.string().optional().describe('Layer name to place duplicates in'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
