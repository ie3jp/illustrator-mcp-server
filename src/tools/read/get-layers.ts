import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coordinateSystemSchema } from '../session.js';
import { executeToolJsx } from '../tool-executor.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_layers — レイヤー一覧の取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Layers/ — Layers collection
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Layer/ — name, visible, locked, color
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var includeSublayers = params.include_sublayers !== false;
    var includeItems = params.include_items === true;
    var coordSystem = params.coordinate_system || "artboard-web";

    var doc = app.activeDocument;
    var artboardRect = null;
    if (coordSystem === "artboard-web") {
      artboardRect = getActiveArtboardRect();
    }

    function extractLayerColor(layer) {
      try {
        var c = layer.color;
        return { r: c.red, g: c.green, b: c.blue };
      } catch (e) {
        return null;
      }
    }

    function extractItems(layer) {
      var items = [];
      for (var i = 0; i < layer.pageItems.length; i++) {
        var item = layer.pageItems[i];
        items.push({
          uuid: ensureUUID(item),
          name: item.name || "",
          type: getItemType(item),
          bounds: getBounds(item, coordSystem, artboardRect)
        });
      }
      return items;
    }

    function traverseLayer(layer) {
      var info = {
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        color: extractLayerColor(layer),
        item_count: layer.pageItems.length
      };

      if (includeItems) {
        info.items = extractItems(layer);
      }

      if (includeSublayers && layer.layers.length > 0) {
        var sublayers = [];
        for (var j = 0; j < layer.layers.length; j++) {
          sublayers.push(traverseLayer(layer.layers[j]));
        }
        info.sublayers = sublayers;
      }

      return info;
    }

    var layers = [];
    for (var i = 0; i < doc.layers.length; i++) {
      layers.push(traverseLayer(doc.layers[i]));
    }

    writeResultFile(RESULT_PATH, { layers: layers });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_layers: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_layers',
    {
      title: 'Get Layers',
      description: 'Get layer structure as a tree',
      inputSchema: {
        include_sublayers: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include sublayers'),
        include_items: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include items within each layer'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { resolveCoordinate: true });
    },
  );
}
