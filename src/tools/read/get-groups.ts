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

    function buildChildTree(container, currentDepth, coordSys) {
      var children = [];
      if (currentDepth >= maxDepth) { return children; }
      for (var i = 0; i < container.pageItems.length; i++) {
        var child = container.pageItems[i];
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
        if (childType === "group" || childType === "compound-path") {
          try {
            childInfo.children = buildChildTree(child, currentDepth + 1, coordSys);
          } catch(e) {
            childInfo.children = [];
          }
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

    // Collect groups
    var groupSource = sourceLayer ? sourceLayer.groupItems : doc.groupItems;
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
      try {
        info.children = buildChildTree(group, 0, coordSystem);
      } catch(e) {
        info.children = [];
      }
      results.push(info);
    }

    // Collect compound paths
    var cpSource = sourceLayer ? sourceLayer.compoundPathItems : doc.compoundPathItems;
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
      try {
        for (var pi = 0; pi < cp.pathItems.length; pi++) {
          var pathChild = cp.pathItems[pi];
          var pcUuid = ensureUUID(pathChild);
          var pcAbIdx = getArtboardIndexForItem(pathChild);
          var pcAbRect = getArtboardRectByIndex(pcAbIdx);
          var pcBounds = getBounds(pathChild, coordSystem, pcAbRect);
          cpInfo.children.push({
            uuid: pcUuid,
            name: pathChild.name || "",
            type: "path",
            bounds: pcBounds
          });
        }
      } catch(e) {}
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
      description: 'Get structure of groups, clipping masks, and compound paths',
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
