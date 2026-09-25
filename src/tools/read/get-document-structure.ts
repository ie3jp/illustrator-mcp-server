import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_document_structure — レイヤー・グループ・オブジェクトのツリー構造取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — layers
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Layer/ — pageItems, layers (sublayers)
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — typename, name, geometricBounds
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var maxDepth = (params.depth !== undefined) ? params.depth : 999;
    var filterArtboard = (params.artboard_index !== undefined) ? params.artboard_index : -1;
    var coordSystem = params.coordinate_system || "artboard-web";
    var doc = app.activeDocument;

    function shouldIncludeItem(item) {
      if (filterArtboard < 0) { return true; }
      var abIdx = getArtboardIndexForItem(item);
      return abIdx === filterArtboard;
    }

    // children が空なのが「子なし」か「深度上限で打ち切り」かを区別する
    function markTruncated(info, count) {
      if (count > 0) {
        info.childrenTruncated = true;
        info.childCount = count;
      }
    }

    function traverseItems(container, currentDepth) {
      var children = [];
      for (var i = 0; i < container.pageItems.length; i++) {
        var item = container.pageItems[i];
        if (!shouldIncludeItem(item)) { continue; }
        var itemType = getItemType(item);
        var abRect = getArtboardRectByIndex(getArtboardIndexForItem(item));
        var child = {
          uuid: ensureUUID(item),
          name: "",
          type: itemType,
          zIndex: getZIndex(item),
          bounds: getBounds(item, coordSystem, abRect)
        };
        try { child.name = item.name || ""; } catch (e) {}
        if (itemType === "group") {
          child.children = [];
          if (currentDepth + 1 >= maxDepth) {
            var groupCount = 0;
            try { groupCount = item.pageItems.length; } catch (e) {}
            markTruncated(child, groupCount);
          } else {
            try {
              child.children = traverseItems(item, currentDepth + 1);
            } catch (e) {}
          }
        }
        children.push(child);
      }
      return children;
    }

    function traverseLayer(layer, currentDepth) {
      var info = {
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        zIndex: 0,
        children: []
      };
      try { info.zIndex = layer.zOrderPosition; } catch (e) {}

      if (currentDepth < maxDepth) {
        info.children = traverseItems(layer, currentDepth);

        // Include sublayers as nested layers
        for (var s = 0; s < layer.layers.length; s++) {
          info.children.push(traverseLayer(layer.layers[s], currentDepth + 1));
        }
      } else {
        var layerCount = 0;
        try { layerCount = layer.pageItems.length + layer.layers.length; } catch (e) {}
        markTruncated(info, layerCount);
      }

      return info;
    }

    var layers = [];
    for (var i = 0; i < doc.layers.length; i++) {
      layers.push(traverseLayer(doc.layers[i], 0));
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      layers: layers
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_document_structure: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_document_structure',
    {
      title: 'Get Document Structure',
      description: 'Get tree structure of layers, groups, and objects',
      inputSchema: {
        depth: z
          .number()
          .optional()
          .describe('Maximum traversal depth (unlimited if omitted). Layers/groups cut off by the limit have childrenTruncated: true and childCount.'),
        artboard_index: z
          .number()
          .optional()
          .describe('Filter by artboard index (0-based integer)'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { resolveCoordinate: true });
    },
  );
}
