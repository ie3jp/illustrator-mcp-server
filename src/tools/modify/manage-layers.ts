import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
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

    function getLayerInfo(layer) {
      return {
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        itemCount: layer.pageItems.length
      };
    }

    if (action === "add") {
      var newLayer;
      if (above) {
        try {
          var refLayer = doc.layers.getByName(above);
          newLayer = doc.layers.add();
          newLayer.move(refLayer, ElementPlacement.PLACEBEFORE);
        } catch(e) {
          newLayer = doc.layers.add();
        }
      } else {
        newLayer = doc.layers.add();
      }
      if (layerName) newLayer.name = layerName;
      writeResultFile(RESULT_PATH, { success: true, action: "add", layer: getLayerInfo(newLayer) });

    } else if (action === "rename") {
      if (!layerName || !newName) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name and new_name are required for rename" });
      } else {
        var layer = doc.layers.getByName(layerName);
        layer.name = newName;
        writeResultFile(RESULT_PATH, { success: true, action: "rename", from: layerName, to: newName });
      }

    } else if (action === "show" || action === "hide") {
      if (!layerName) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name is required" });
      } else {
        var layer2 = doc.layers.getByName(layerName);
        layer2.visible = (action === "show");
        writeResultFile(RESULT_PATH, { success: true, action: action, layer: getLayerInfo(layer2) });
      }

    } else if (action === "lock" || action === "unlock") {
      if (!layerName) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name is required" });
      } else {
        var layer3 = doc.layers.getByName(layerName);
        layer3.locked = (action === "lock");
        writeResultFile(RESULT_PATH, { success: true, action: action, layer: getLayerInfo(layer3) });
      }

    } else if (action === "reorder") {
      if (!layerName || position === null) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name and position are required for reorder" });
      } else {
        var layer4 = doc.layers.getByName(layerName);
        if (position <= 0) {
          layer4.move(doc.layers[0], ElementPlacement.PLACEBEFORE);
        } else if (position >= doc.layers.length - 1) {
          layer4.move(doc.layers[doc.layers.length - 1], ElementPlacement.PLACEAFTER);
        } else {
          layer4.move(doc.layers[position], ElementPlacement.PLACEBEFORE);
        }
        writeResultFile(RESULT_PATH, { success: true, action: "reorder", layer: layerName, position: position });
      }

    } else if (action === "delete") {
      if (!layerName) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name is required for delete" });
      } else {
        var layer5 = doc.layers.getByName(layerName);
        var info = getLayerInfo(layer5);
        layer5.remove();
        writeResultFile(RESULT_PATH, { success: true, action: "delete", deletedLayer: info });
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Layer operation failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_layers',
    {
      title: 'Manage Layers',
      description: 'Add, rename, show/hide, lock/unlock, reorder, or delete layers',
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
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
