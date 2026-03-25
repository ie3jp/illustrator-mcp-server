import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
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
        var abRect = null;
        if (abIdx >= 0) { abRect = doc.artboards[abIdx].artboardRect; }
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
      var artboardRect = null;
      if (abIndex >= 0) { artboardRect = doc.artboards[abIndex].artboardRect; }
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
      var cpAbRect = null;
      if (cpAbIndex >= 0) { cpAbRect = doc.artboards[cpAbIndex].artboardRect; }
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
          var pcAbRect = null;
          if (pcAbIdx >= 0) { pcAbRect = doc.artboards[pcAbIdx].artboardRect; }
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
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
