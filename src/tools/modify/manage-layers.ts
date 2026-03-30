import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

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

    function getLayerInfo(layer) {
      return {
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        printable: layer.printable
      };
    }

    if (action === "add") {
      var newLayer = doc.layers.add({ name: layerName || "New Layer" });
      if (params.above) {
        try {
          var refLayer = doc.layers.itemByName(params.above);
          newLayer.move(LocationOptions.BEFORE, refLayer);
        } catch(e) {}
      }
      writeResultFile(RESULT_PATH, { success: true, action: "add", layer: getLayerInfo(newLayer) });

    } else if (action === "rename") {
      if (!layerName || !newName) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name and new_name are required for rename" });
      } else {
        var layer = doc.layers.itemByName(layerName);
        if (!layer || !layer.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + layerName });
        } else {
          layer.name = newName;
          writeResultFile(RESULT_PATH, { success: true, action: "rename", from: layerName, to: newName });
        }
      }

    } else if (action === "show" || action === "hide") {
      if (!layerName) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name is required" });
      } else {
        var layer2 = doc.layers.itemByName(layerName);
        if (!layer2 || !layer2.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + layerName });
        } else {
          layer2.visible = (action === "show");
          writeResultFile(RESULT_PATH, { success: true, action: action, layer: getLayerInfo(layer2) });
        }
      }

    } else if (action === "lock" || action === "unlock") {
      if (!layerName) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name is required" });
      } else {
        var layer3 = doc.layers.itemByName(layerName);
        if (!layer3 || !layer3.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + layerName });
        } else {
          layer3.locked = (action === "lock");
          writeResultFile(RESULT_PATH, { success: true, action: action, layer: getLayerInfo(layer3) });
        }
      }

    } else if (action === "reorder") {
      if (!layerName || typeof params.position !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name and position are required for reorder" });
      } else {
        var layer4 = doc.layers.itemByName(layerName);
        if (!layer4 || !layer4.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + layerName });
        } else {
          var pos = params.position;
          if (pos <= 0) {
            layer4.move(LocationOptions.AT_BEGINNING);
          } else if (pos >= doc.layers.length - 1) {
            layer4.move(LocationOptions.AT_END);
          } else {
            var refLayer2 = doc.layers.item(pos);
            layer4.move(LocationOptions.BEFORE, refLayer2);
          }
          writeResultFile(RESULT_PATH, { success: true, action: "reorder", layer: layerName, position: pos });
        }
      }

    } else if (action === "delete") {
      if (!layerName) {
        writeResultFile(RESULT_PATH, { error: true, message: "layer_name is required for delete" });
      } else {
        var layer5 = doc.layers.itemByName(layerName);
        if (!layer5 || !layer5.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + layerName });
        } else {
          var info = getLayerInfo(layer5);
          layer5.remove();
          writeResultFile(RESULT_PATH, { success: true, action: "delete", deletedLayer: info });
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action });
    }
  } catch (e) {
    var existingLayers = [];
    try {
      for (var li = 0; li < doc.layers.length; li++) {
        existingLayers.push(doc.layers.item(li).name);
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
      description: 'Add, rename, show/hide, lock/unlock, reorder, or delete layers in the active InDesign document.',
      inputSchema: {
        action: z
          .enum(['add', 'rename', 'show', 'hide', 'lock', 'unlock', 'reorder', 'delete'])
          .describe('Layer operation to perform'),
        layer_name: z.string().optional().describe('Target layer name (for add: new layer name)'),
        new_name: z.string().optional().describe('New name (required for rename action)'),
        position: z.number().int().min(0).optional().describe('Target position for reorder (0 = topmost)'),
        above: z.string().optional().describe('For add: create above this layer name'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
