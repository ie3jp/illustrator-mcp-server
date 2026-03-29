import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = params.coordinate_system || "artboard-web";
    var includePoints = params.include_points === true;
    var selectionOnly = params.selection_only === true;
    var layerName = params.layer_name || null;
    var doc = app.activeDocument;

    function getStrokeCapStr(cap) {
      try {
        if (cap === StrokeCap.BUTTENDCAP) return "butt";
        if (cap === StrokeCap.ROUNDENDCAP) return "round";
        if (cap === StrokeCap.PROJECTINGENDCAP) return "projecting";
      } catch (e) {}
      return null;
    }

    function getStrokeJoinStr(join) {
      try {
        if (join === StrokeJoin.MITERENDJOIN) return "miter";
        if (join === StrokeJoin.ROUNDENDJOIN) return "round";
        if (join === StrokeJoin.BEVELENDJOIN) return "bevel";
      } catch (e) {}
      return null;
    }

    function getStrokeDashes(item) {
      try {
        var dashes = item.strokeDashes;
        if (dashes && dashes.length > 0) {
          var arr = [];
          for (var d = 0; d < dashes.length; d++) {
            arr.push(dashes[d]);
          }
          return arr;
        }
      } catch (e) {}
      return [];
    }

    function convertPoint(pt, artboardRect) {
      var pos = { x: pt.anchor[0], y: pt.anchor[1] };
      var left = { x: pt.leftDirection[0], y: pt.leftDirection[1] };
      var right = { x: pt.rightDirection[0], y: pt.rightDirection[1] };

      if (coordSystem === "artboard-web" && artboardRect) {
        var abLeft = artboardRect[0];
        var abTop = artboardRect[1];
        pos.x = pos.x - abLeft;
        pos.y = -(pos.y - abTop);
        left.x = left.x - abLeft;
        left.y = -(left.y - abTop);
        right.x = right.x - abLeft;
        right.y = -(right.y - abTop);
      }

      var pointType = "corner";
      try {
        if (pt.pointType === PointType.SMOOTH) pointType = "smooth";
        else if (pt.pointType === PointType.CORNER) pointType = "corner";
      } catch (e) {}

      return {
        position: pos,
        leftDirection: left,
        rightDirection: right,
        pointType: pointType
      };
    }

    function extractPathInfo(item) {
      var abIndex = getArtboardIndexForItem(item);
      var artboardRect = getArtboardRectByIndex(abIndex);

      var bounds = getBounds(item, coordSystem, artboardRect);
      var uuid = ensureUUID(item);
      var zIdx = getZIndex(item);

      var info = {
        uuid: uuid,
        zIndex: zIdx,
        name: "",
        closed: false,
        artboardIndex: abIndex,
        bounds: bounds,
        fill: null,
        stroke: null,
        opacity: 100,
        cornerRadius: null,
        transform: {
          rotation: null,
          scaleX: null,
          scaleY: null,
          reflect: null
        }
      };

      try { info.name = item.name || ""; } catch (e) {}
      try { info.closed = item.closed; } catch (e) {}
      try { info.opacity = item.opacity; } catch (e) {}

      // fill
      // Note: ExtendScript does not expose per-fill opacity on pathItems.
      // item.opacity is the object-level opacity, exposed separately in info.opacity.
      try {
        if (item.filled) {
          info.fill = {
            color: colorToObject(item.fillColor)
          };
        } else {
          info.fill = { color: { type: "none" } };
        }
      } catch (e) {
        info.fill = { color: { type: "none" } };
      }

      // stroke
      try {
        if (item.stroked) {
          info.stroke = {
            color: colorToObject(item.strokeColor),
            width: item.strokeWidth,
            cap: getStrokeCapStr(item.strokeCap),
            join: getStrokeJoinStr(item.strokeJoin),
            dashPattern: getStrokeDashes(item)
          };
        } else {
          info.stroke = null;
        }
      } catch (e) {
        info.stroke = null;
      }

      // anchor points
      if (includePoints) {
        try {
          var points = [];
          for (var p = 0; p < item.pathPoints.length; p++) {
            points.push(convertPoint(item.pathPoints[p], artboardRect));
          }
          info.anchorPoints = points;
        } catch (e) {
          info.anchorPoints = [];
        }
      }

      return info;
    }

    var pathItems = [];
    var hasError = false;

    if (selectionOnly) {
      var sel = doc.selection;
      if (sel && sel.length > 0) {
        for (var i = 0; i < sel.length; i++) {
          if (sel[i].typename === "PathItem" && !sel[i].guides) {
            pathItems.push(extractPathInfo(sel[i]));
          }
        }
      }
    } else if (layerName) {
      var targetLayer = null;
      for (var li = 0; li < doc.layers.length; li++) {
        if (doc.layers[li].name === layerName) {
          targetLayer = doc.layers[li];
          break;
        }
      }
      if (!targetLayer) {
        hasError = true;
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "Layer '" + layerName + "' not found"
        });
      } else {
        for (var j = 0; j < targetLayer.pathItems.length; j++) {
          var pi = targetLayer.pathItems[j];
          if (!pi.guides) {
            pathItems.push(extractPathInfo(pi));
          }
        }
      }
    } else {
      for (var k = 0; k < doc.pathItems.length; k++) {
        var pk = doc.pathItems[k];
        if (!pk.guides) {
          pathItems.push(extractPathInfo(pk));
        }
      }
    }

    if (!hasError) {
      writeResultFile(RESULT_PATH, {
        coordinateSystem: coordSystem,
        count: pathItems.length,
        pathItems: pathItems
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_path_items: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_path_items',
    {
      title: 'Get Path Items',
      description: 'Get path and shape data',
      inputSchema: {
        layer_name: z
          .string()
          .optional()
          .describe('Filter by layer name'),
        include_points: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include anchor point details'),
        selection_only: z
          .boolean()
          .optional()
          .default(false)
          .describe('Get selected paths only'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
