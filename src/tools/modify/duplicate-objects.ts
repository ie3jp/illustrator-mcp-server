import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
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
 * 座標系は resolveCoordinate で解決する（CMYK 文書は document になり、offset.y は上向き正）。
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
    var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;

    var targetLayer = null;
    var layerError = false;
    var warnings = [];
    if (params.target_layer) {
      // 同名のトップレベルレイヤーが複数あるときは最上位を使い、警告を返す
      var resolvedLayer = resolveTopLevelLayer(doc, params.target_layer, warnings);
      if (resolvedLayer) {
        targetLayer = resolvedLayer.layer;
      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + params.target_layer });
        layerError = true;
      }
    }

    if (!layerError) {
      var results = [];
      var notFound = [];
      var failed = [];
      for (var i = 0; i < params.uuids.length; i++) {
        var item = findItemByUUID(params.uuids[i]);
        if (!item) {
          notFound.push(params.uuids[i]);
          continue;
        }

        // 1 件ごとに try する。途中で throw しても、それまでの複製の UUID を必ず返す
        var dup = null;
        var newUuid = null;
        try {
          if (targetLayer) {
            dup = item.duplicate(targetLayer, ElementPlacement.PLACEATEND);
          } else {
            dup = item.duplicate();
          }

          // duplicate() は note を継承する（実機確認済み）ため、複製と子孫の UUID を振り直す
          reassignUUIDDeep(dup);
          newUuid = ensureUUID(dup);

          if (params.offset) {
            var dx = params.offset.x || 0;
            var dy = params.offset.y || 0;
            if (coordSystem === "artboard-web") {
              dup.translate(dx, -dy);
            } else {
              dup.translate(dx, dy);
            }
          }

          results.push({ sourceUuid: params.uuids[i], newUuid: newUuid, verified: verifyItem(dup, coordSystem, abRect) });
        } catch (dupErr) {
          var failure = { sourceUuid: params.uuids[i], message: dupErr.message };
          // 複製自体はできていたら回収できるよう UUID を返す（再採番前に落ちた場合はここで振り直す）
          if (dup) {
            if (!newUuid) {
              try { newUuid = reassignUUID(dup); } catch (eUuid) {}
            }
            if (newUuid) failure.newUuid = newUuid;
          }
          failed.push(failure);
        }
      }

      var result = {
        success: notFound.length === 0 && failed.length === 0,
        coordinateSystem: coordSystem,
        duplicatedCount: results.length,
        items: results
      };
      if (notFound.length > 0) result.notFound = notFound;
      if (failed.length > 0) result.failed = failed;
      if (warnings.length > 0) result.warnings = warnings;
      writeResultFile(RESULT_PATH, result);
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
        'Duplicate one or more objects, optionally offsetting the copies. Copies (and their group/compound-path children) get new UUIDs; notes/memos are kept. Missing UUIDs are listed in notFound and per-item failures in failed (success is then false, but copies that were made are still returned). Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to duplicate'),
        offset: z
          .object({
            x: z.number().describe('X offset from original'),
            y: z.number().describe('Y offset from original. Positive = down in artboard-web, up in document coordinates.'),
          })
          .optional()
          .describe('Offset for duplicated objects'),
        target_layer: z.string().optional().describe('Top-level layer name to place duplicates in. If several layers share the name, the topmost one is used and a warning is returned'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true, resolveCoordinate: true });
    },
  );
}
