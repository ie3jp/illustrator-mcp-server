import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * manage_layers — レイヤーの追加・削除・リネーム・表示/ロック操作
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Layers/ — Layers.add(), getByName()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Layer/ — name, visible, locked, remove(), move()
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
    var layerName = params.layer_name || null;
    var newName = params.new_name || null;
    var position = (typeof params.position === "number") ? params.position : null;
    var above = params.above || null;
    var warnings = [];

    function getLayerInfo(layer) {
      return {
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        itemCount: layer.pageItems.length
      };
    }

    // トップレベルレイヤーから名前一致のインデックスを全件返す（getByName は最初の 1 件しか返さない）
    function findLayerIndices(name) {
      var result = [];
      for (var li = 0; li < doc.layers.length; li++) {
        if (doc.layers[li].name === name) result.push(li);
      }
      return result;
    }

    // 名前でレイヤーを解決する。見つからなければ null。
    // 同名が複数あるときは最上位（index 最小）を返し、warnings に記録する
    function resolveLayer(name) {
      var indices = findLayerIndices(name);
      if (indices.length === 0) return null;
      if (indices.length > 1) {
        warnings.push(indices.length + " top-level layers are named '" + name + "'; operated on the topmost one (position " + indices[0] + "). Rename layers to make them unique.");
      }
      return { layer: doc.layers[indices[0]], index: indices[0] };
    }

    function writeResult(result) {
      if (warnings.length > 0) result.warnings = warnings;
      writeResultFile(RESULT_PATH, result);
    }

    function layerNotFound(name) {
      var names = [];
      for (var ni = 0; ni < doc.layers.length; ni++) names.push(doc.layers[ni].name);
      writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + name, existing_layers: names });
    }

    if (action === "add") {
      if (layerName && findLayerIndices(layerName).length > 0) {
        warnings.push("A layer named '" + layerName + "' already exists; created another layer with the same name. Name-based operations will target the topmost one.");
      }
      var newLayer;
      if (above) {
        var refResolved = resolveLayer(above);
        newLayer = doc.layers.add();
        if (refResolved) {
          newLayer.move(refResolved.layer, ElementPlacement.PLACEBEFORE);
        } else {
          warnings.push("Layer '" + above + "' (above) not found; the new layer was created at the top.");
        }
      } else {
        newLayer = doc.layers.add();
      }
      if (layerName) newLayer.name = layerName;
      writeResult({ success: true, action: "add", layer: getLayerInfo(newLayer) });

    } else if (!layerName) {
      writeResultFile(RESULT_PATH, { error: true, message: "layer_name is required for " + action });

    } else if (action === "delete") {
      // 削除は取り返しがつきにくいので、同名が複数あるときは曖昧としてエラーにする
      var delIndices = findLayerIndices(layerName);
      if (delIndices.length === 0) {
        layerNotFound(layerName);
      } else if (delIndices.length > 1) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: delIndices.length + " top-level layers are named '" + layerName + "'; refusing to delete an ambiguous layer. Rename one of them first (rename targets the topmost one).",
          positions: delIndices
        });
      } else {
        var layer5 = doc.layers[delIndices[0]];
        var info = getLayerInfo(layer5);
        layer5.remove();
        writeResult({ success: true, action: "delete", deletedLayer: info });
      }

    } else {
      var resolved = resolveLayer(layerName);
      if (!resolved) {
        layerNotFound(layerName);

      } else if (action === "rename") {
        if (!newName) {
          writeResultFile(RESULT_PATH, { error: true, message: "layer_name and new_name are required for rename" });
        } else {
          resolved.layer.name = newName;
          writeResult({ success: true, action: "rename", from: layerName, to: newName });
        }

      } else if (action === "show" || action === "hide") {
        resolved.layer.visible = (action === "show");
        writeResult({ success: true, action: action, layer: getLayerInfo(resolved.layer) });

      } else if (action === "lock" || action === "unlock") {
        resolved.layer.locked = (action === "lock");
        writeResult({ success: true, action: action, layer: getLayerInfo(resolved.layer) });

      } else if (action === "reorder") {
        if (position === null) {
          writeResultFile(RESULT_PATH, { error: true, message: "layer_name and position are required for reorder" });
        } else {
          var fromIdx = resolved.index;
          var toIdx = position;
          if (toIdx < 0) toIdx = 0;
          if (toIdx > doc.layers.length - 1) toIdx = doc.layers.length - 1;
          // 下方向へ動かすときは目標位置のレイヤーの「後ろ」に置く。
          // PLACEBEFORE だと自分が抜けた分ずれて 1 つ手前で止まる（[A,B,C,D] の A→2 が index 1 になる）
          if (toIdx < fromIdx) {
            resolved.layer.move(doc.layers[toIdx], ElementPlacement.PLACEBEFORE);
          } else if (toIdx > fromIdx) {
            resolved.layer.move(doc.layers[toIdx], ElementPlacement.PLACEAFTER);
          }
          writeResult({ success: true, action: "reorder", layer: layerName, from: fromIdx, position: toIdx });
        }

      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action });
      }
    }
  } catch (e) {
    var existingLayers = [];
    try {
      for (var li = 0; li < doc.layers.length; li++) {
        existingLayers.push(doc.layers[li].name);
      }
    } catch(_ignore) {}
    writeResultFile(RESULT_PATH, { error: true, message: "Layer operation failed: " + e.message, line: e.line, existing_layers: existingLayers });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_layers',
    {
      title: 'Manage Layers',
      description:
        'Add, rename, show/hide, lock/unlock, reorder, or delete top-level layers by name. ' +
        'If several layers share a name, rename/show/hide/lock/unlock/reorder act on the topmost one with a warning, and delete is refused.',
      inputSchema: {
        action: z
          .enum(['add', 'rename', 'show', 'hide', 'lock', 'unlock', 'reorder', 'delete'])
          .describe('Layer operation to perform'),
        layer_name: z
          .string()
          .optional()
          .describe('Target layer name (for add: new layer name)'),
        new_name: z
          .string()
          .optional()
          .describe('New name (required for rename action)'),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Target position for reorder (0 = topmost)'),
        above: z
          .string()
          .optional()
          .describe('For add: create above this layer name'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return formatToolResult(result);
    },
  );
}
