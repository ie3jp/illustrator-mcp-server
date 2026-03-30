import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_groups — グループアイテム情報の取得
 * Groups from doc.allPageItems, filter by Group type. Show children.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "page-relative";
    var maxDepth = (params && params.depth !== undefined) ? params.depth : 10;
    var layerName = (params && params.layer_name) ? params.layer_name : null;
    var filterPage = (params && typeof params.page_index === "number") ? params.page_index : null;
    var doc = app.activeDocument;

    function buildChildTree(container, currentDepth, coordSys) {
      var children = [];
      if (currentDepth >= maxDepth) { return children; }
      var items = null;
      try { items = container.pageItems; } catch (e) { return children; }
      for (var i = 0; i < items.length; i++) {
        var child = items[i];
        var childUuid = ensureUUID(child);
        var childType = getItemType(child);

        var childPageIdx = -1;
        try {
          var childPP = child.parentPage;
          if (childPP) childPageIdx = childPP.index;
        } catch (e) {}

        var childBounds = null;
        try {
          childBounds = getBoundsOnPage(child, childPageIdx);
        } catch (e) {
          try {
            var cgb = child.geometricBounds;
            childBounds = { top: cgh[0], left: cgh[1], bottom: cgh[2], right: cgh[3],
                            width: cgh[3] - cgh[1], height: cgh[2] - cgh[0] };
          } catch (e2) {}
        }

        var childInfo = {
          uuid: childUuid,
          name: "",
          type: childType,
          bounds: childBounds
        };
        try { childInfo.name = child.name || ""; } catch (e) {}

        if (childType === "Group") {
          try {
            childInfo.children = buildChildTree(child, currentDepth + 1, coordSys);
          } catch (e) {
            childInfo.children = [];
          }
        }
        children.push(childInfo);
      }
      return children;
    }

    var results = [];

    // レイヤーフィルタ検証
    if (layerName) {
      var foundLayer = null;
      for (var li = 0; li < doc.layers.length; li++) {
        if (doc.layers[li].name === layerName) {
          foundLayer = doc.layers[li];
          break;
        }
      }
      if (!foundLayer) {
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + layerName });
        foundLayer = null;
      }
    }

    // allPageItems を走査してGroupを収集
    var allItems = doc.allPageItems;
    for (var i = 0; i < allItems.length; i++) {
      var item = allItems[i];
      if (getItemType(item) !== "Group") continue;

      // レイヤーフィルタ
      if (layerName) {
        var itemLayerName = getParentLayerName(item);
        if (itemLayerName !== layerName) continue;
      }

      // ページフィルタ
      var groupPageIdx = -1;
      try {
        var gpp = item.parentPage;
        if (gpp) groupPageIdx = gpp.index;
      } catch (e) {}

      if (filterPage !== null && groupPageIdx !== filterPage) continue;

      // 親がGroupでない（最上位グループのみ）かどうか
      var parentIsGroup = false;
      try {
        var par = item.parent;
        if (par && getItemType(par) === "Group") parentIsGroup = true;
      } catch (e) {}

      if (parentIsGroup) continue; // サブグループはツリーで取得

      var uuid = ensureUUID(item);

      var groupBounds = null;
      try {
        groupBounds = getBoundsOnPage(item, groupPageIdx);
      } catch (e) {
        try {
          var ggb = item.geometricBounds;
          groupBounds = { top: ggb[0], left: ggb[1], bottom: ggb[2], right: ggb[3],
                          width: ggb[3] - ggb[1], height: ggb[2] - ggb[0] };
        } catch (e2) {}
      }

      var info = {
        uuid: uuid,
        name: "",
        type: "Group",
        pageIndex: groupPageIdx,
        bounds: groupBounds,
        layerName: getParentLayerName(item),
        children: []
      };
      try { info.name = item.name || ""; } catch (e) {}
      try {
        info.children = buildChildTree(item, 0, coordSystem);
      } catch (e) {
        info.children = [];
      }
      results.push(info);
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      count: results.length,
      groups: results
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_groups',
    {
      title: 'Get Groups',
      description: 'Get top-level groups from InDesign document with child item tree. Supports layer and page_index filters.',
      inputSchema: {
        layer_name: z.string().optional().describe('Filter by layer name (all layers if omitted)'),
        page_index: z.number().int().min(0).optional().describe('Filter by page index (0-based)'),
        depth: z.number().optional().default(10).describe('Maximum traversal depth for children (default: 10)'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = {
        ...params,
        coordinate_system: await resolveCoordinateSystem(params.coordinate_system),
      };
      const result = await executeJsx(jsxCode, resolvedParams);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
