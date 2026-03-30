import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_layers — レイヤー一覧の取得
 * doc.layers collection, visibility, lock, color, sublayers
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var includeSublayers = (params && params.include_sublayers !== false) ? true : false;
    var includeItems = (params && params.include_items === true) ? true : false;
    var doc = app.activeDocument;

    function extractLayerColor(layer) {
      try {
        var c = layer.layerColor;
        if (c && typeof c === "object") {
          if (c.red !== void 0) return { r: c.red, g: c.green, b: c.blue };
        }
        return String(c);
      } catch (e) {
        return null;
      }
    }

    function extractItems(layer) {
      var items = [];
      var layerItems = layer.pageItems;
      for (var i = 0; i < layerItems.length; i++) {
        var item = layerItems[i];
        var entry = {
          uuid: ensureUUID(item),
          name: "",
          type: getItemType(item)
        };
        try { entry.name = item.name || ""; } catch (e) {}
        try {
          var b = item.geometricBounds;
          entry.bounds = { top: b[0], left: b[1], bottom: b[2], right: b[3] };
        } catch (e) {}
        items.push(entry);
      }
      return items;
    }

    function traverseLayer(layer) {
      var info = {
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        printable: true,
        color: extractLayerColor(layer),
        itemCount: 0
      };
      try { info.printable = layer.printable; } catch (e) {}
      try { info.itemCount = layer.pageItems.length; } catch (e) {}

      if (includeItems) {
        try { info.items = extractItems(layer); } catch (e) {}
      }

      if (includeSublayers) {
        try {
          var sublayers = layer.layers;
          if (sublayers && sublayers.length > 0) {
            var sub = [];
            for (var j = 0; j < sublayers.length; j++) {
              sub.push(traverseLayer(sublayers[j]));
            }
            info.sublayers = sub;
          }
        } catch (e) {}
      }

      return info;
    }

    var layers = [];
    for (var i = 0; i < doc.layers.length; i++) {
      layers.push(traverseLayer(doc.layers[i]));
    }

    var activeLayerName = "";
    try { activeLayerName = doc.activeLayer.name; } catch (e) {}

    writeResultFile(RESULT_PATH, {
      layerCount: layers.length,
      activeLayer: activeLayerName,
      layers: layers
    });
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
      description: 'Get InDesign layer structure as a tree with visibility, lock state, color, and sublayers.',
      inputSchema: {
        include_sublayers: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include sublayers (default: true)'),
        include_items: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include page items within each layer (default: false)'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
