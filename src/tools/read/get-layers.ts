import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_layers — レイヤー一覧の取得
 * doc.layers collection. Show visibility, lock, color, sublayers.
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
        if (c === UIColors.BLACK) return "black";
        if (c === UIColors.BLUE) return "blue";
        if (c === UIColors.BRICK_RED) return "brick-red";
        if (c === UIColors.BROWN) return "brown";
        if (c === UIColors.BURGUNDY) return "burgundy";
        if (c === UIColors.CARNATION) return "carnation";
        if (c === UIColors.CUTE_TEAL) return "cute-teal";
        if (c === UIColors.CYAN) return "cyan";
        if (c === UIColors.DARK_BLUE) return "dark-blue";
        if (c === UIColors.DARK_GREEN) return "dark-green";
        if (c === UIColors.FIESTA) return "fiesta";
        if (c === UIColors.GOLD) return "gold";
        if (c === UIColors.GRASS_GREEN) return "grass-green";
        if (c === UIColors.GRAY) return "gray";
        if (c === UIColors.GREEN) return "green";
        if (c === UIColors.GRID_BLUE) return "grid-blue";
        if (c === UIColors.GRID_ORANGE) return "grid-orange";
        if (c === UIColors.LAVENDER) return "lavender";
        if (c === UIColors.LIGHT_BLUE) return "light-blue";
        if (c === UIColors.LIGHT_GRAY) return "light-gray";
        if (c === UIColors.LIGHT_OLIVE) return "light-olive";
        if (c === UIColors.LIPSTICK) return "lipstick";
        if (c === UIColors.MAGENTA) return "magenta";
        if (c === UIColors.OLIVE) return "olive";
        if (c === UIColors.ORANGE) return "orange";
        if (c === UIColors.PEACH) return "peach";
        if (c === UIColors.PINK) return "pink";
        if (c === UIColors.PURPLE) return "purple";
        if (c === UIColors.RED) return "red";
        if (c === UIColors.SULPHUR) return "sulphur";
        if (c === UIColors.TAN) return "tan";
        if (c === UIColors.TEAL) return "teal";
        if (c === UIColors.ULTRA_MARINE) return "ultra-marine";
        if (c === UIColors.VIOLET) return "violet";
        if (c === UIColors.WHITE) return "white";
        if (c === UIColors.YELLOW) return "yellow";
        if (c === UIColors.YELLOW_GREEN) return "yellow-green";
        return String(c);
      } catch (e) {
        return null;
      }
    }

    function extractItems(layer) {
      var items = [];
      try {
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
            var b = item.geometricBounds; // [top, left, bottom, right]
            entry.bounds = { top: b[0], left: b[1], bottom: b[2], right: b[3] };
          } catch (e) {}
          try {
            var pp = item.parentPage;
            entry.pageIndex = pp ? pp.index : -1;
          } catch (e) { entry.pageIndex = -1; }
          items.push(entry);
        }
      } catch (e) {}
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
      description: 'Get InDesign layer structure as a tree with visibility, lock state, color label, and sublayers.',
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
