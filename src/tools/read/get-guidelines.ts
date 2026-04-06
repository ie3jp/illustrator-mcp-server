import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_guidelines — ガイドライン情報の取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItem/ — guides property
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = params.coordinate_system || "artboard-web";
    var doc = app.activeDocument;

    var artboardRect = null;
    if (coordSystem === "artboard-web") {
      artboardRect = getActiveArtboardRect();
    }

    var horizontal = [];
    var vertical = [];

    function checkGuide(item) {
      if (!item.guides) return;
      var pts = item.pathPoints;
      if (pts.length < 2) return;

      var allSameY = true;
      var allSameX = true;
      var firstY = pts[0].anchor[1];
      var firstX = pts[0].anchor[0];

      for (var p = 1; p < pts.length; p++) {
        if (Math.abs(pts[p].anchor[1] - firstY) > 0.01) allSameY = false;
        if (Math.abs(pts[p].anchor[0] - firstX) > 0.01) allSameX = false;
      }

      if (allSameY) {
        var yVal = firstY;
        if (coordSystem === "artboard-web" && artboardRect) {
          yVal = -(firstY - artboardRect[1]);
        }
        horizontal.push({ position: yVal, locked: item.locked });
      } else if (allSameX) {
        var xVal = firstX;
        if (coordSystem === "artboard-web" && artboardRect) {
          xVal = firstX - artboardRect[0];
        }
        vertical.push({ position: xVal, locked: item.locked });
      }
    }

    // 全レイヤーを再帰的に走査してガイドを収集
    function scanLayer(layer) {
      for (var i = 0; i < layer.pathItems.length; i++) {
        checkGuide(layer.pathItems[i]);
      }
      for (var j = 0; j < layer.layers.length; j++) {
        scanLayer(layer.layers[j]);
      }
    }

    for (var li = 0; li < doc.layers.length; li++) {
      scanLayer(doc.layers[li]);
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      horizontal: horizontal,
      vertical: vertical,
      totalCount: horizontal.length + vertical.length
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_guidelines: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_guidelines',
    {
      title: 'Get Guidelines',
      description: 'Get guide information',
      inputSchema: {
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { resolveCoordinate: true });
    },
  );
}
