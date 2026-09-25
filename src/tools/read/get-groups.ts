import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_groups — グループアイテム情報の取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/GroupItems/ — GroupItems collection
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/GroupItem/ — clipped, pageItems
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var maxDepth = (params && params.depth !== undefined) ? params.depth : 10;
    var layerName = (params && params.layer_name) ? params.layer_name : null;
    var doc = app.activeDocument;

    // 子アイテムのコレクション。CompoundPathItem は pageItems を持たず pathItems のみ
    function getChildCollection(container) {
      if (container.typename === "CompoundPathItem") return container.pathItems;
      return container.pageItems;
    }

    // クリッピングマスクのマスクパスか（複合パスは内部パスの clipping を見る）
    function isClippingPath(item) {
      try {
        if (item.typename === "PathItem") return item.clipping === true;
        if (item.typename === "CompoundPathItem" && item.pathItems.length > 0) {
          return item.pathItems[0].clipping === true;
        }
      } catch(e) {}
      return false;
    }

    // 深度上限で打ち切った場合は「子なし」と区別できるよう childrenTruncated と childCount を付ける
    function attachChildren(info, container, currentDepth, coordSys) {
      if (currentDepth >= maxDepth) {
        info.children = [];
        var count = 0;
        try { count = getChildCollection(container).length; } catch(e) {}
        if (count > 0) {
          info.childrenTruncated = true;
          info.childCount = count;
        }
        return;
      }
      try {
        info.children = buildChildTree(container, currentDepth, coordSys);
      } catch(e) {
        info.children = [];
      }
    }

    function buildChildTree(container, currentDepth, coordSys) {
      var children = [];
      var coll = getChildCollection(container);
      for (var i = 0; i < coll.length; i++) {
        var child = coll[i];
        var childUuid = ensureUUID(child);
        var childType = getItemType(child);
        var abIdx = getArtboardIndexForItem(child);
        var abRect = getArtboardRectByIndex(abIdx);
        var childBounds = getBounds(child, coordSys, abRect);
        var childInfo = {
          uuid: childUuid,
          name: "",
          type: childType,
          bounds: childBounds
        };
        try { childInfo.name = child.name || ""; } catch(e) {}
        if (isClippingPath(child)) childInfo.clipping = true;
        if (childType === "group" || childType === "compound-path") {
          attachChildren(childInfo, child, currentDepth + 1, coordSys);
        }
        children.push(childInfo);
      }
      return children;
    }

    var results = [];

    // Determine source container
    var sourceLayer = null;
    if (layerName) {
      for (var li = 0; li < doc.layers.length; li++) {
        if (doc.layers[li].name === layerName) {
          sourceLayer = doc.layers[li];
          break;
        }
      }
      if (!sourceLayer) {
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + layerName });
      }
    }

    if (layerName && !sourceLayer) {
      // Already wrote error above; skip rest
    } else {

    // 収集対象。Document.groupItems / compoundPathItems はネストしたものも含むが、
    // Layer のコレクションはグループ内・サブレイヤー内を含まないため、レイヤー指定時は再帰的に集める
    var groupSource;
    var cpSource;
    if (sourceLayer) {
      groupSource = [];
      cpSource = [];
      iterateAllItems(sourceLayer, function(it) {
        if (it.typename === "GroupItem") groupSource.push(it);
        else if (it.typename === "CompoundPathItem") cpSource.push(it);
      });
    } else {
      groupSource = doc.groupItems;
      cpSource = doc.compoundPathItems;
    }

    // Collect groups
    for (var g = 0; g < groupSource.length; g++) {
      var group = groupSource[g];
      var uuid = ensureUUID(group);
      var zIdx = getZIndex(group);
      var abIndex = getArtboardIndexForItem(group);
      var artboardRect = getArtboardRectByIndex(abIndex);
      var bounds = getBounds(group, coordSystem, artboardRect);

      var groupType = "group";
      try {
        if (group.clipped === true) { groupType = "clipping-mask"; }
      } catch(e) {}

      var info = {
        uuid: uuid,
        zIndex: zIdx,
        name: "",
        type: groupType,
        bounds: bounds,
        children: []
      };
      try { info.name = group.name || ""; } catch(e) {}
      attachChildren(info, group, 0, coordSystem);
      results.push(info);
    }

    // Collect compound paths
    for (var c = 0; c < cpSource.length; c++) {
      var cp = cpSource[c];
      var cpUuid = ensureUUID(cp);
      var cpZIdx = getZIndex(cp);
      var cpAbIndex = getArtboardIndexForItem(cp);
      var cpAbRect = getArtboardRectByIndex(cpAbIndex);
      var cpBounds = getBounds(cp, coordSystem, cpAbRect);

      var cpInfo = {
        uuid: cpUuid,
        zIndex: cpZIdx,
        name: "",
        type: "compound-path",
        bounds: cpBounds,
        children: []
      };
      try { cpInfo.name = cp.name || ""; } catch(e) {}
      if (isClippingPath(cp)) cpInfo.clipping = true;
      attachChildren(cpInfo, cp, 0, coordSystem);
      results.push(cpInfo);
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      count: results.length,
      groups: results
    });

    } // end of layerName && !sourceLayer guard
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
      description:
        'Get structure of groups, clipping masks, and compound paths. Children of a clipping-mask group mark the mask path with clipping: true. When depth cuts the tree off, the item has childrenTruncated: true and childCount (children is empty only because of the depth limit).',
      inputSchema: {
        layer_name: z.string().optional().describe('Filter by layer name (all layers if omitted)'),
        depth: z.number().optional().default(10).describe('Maximum traversal depth'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { resolveCoordinate: true });
    },
  );
}
