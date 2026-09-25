import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { colorSchema, COLOR_HELPERS_JSX, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * replace_color — 塗り/線の色を一括置換
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItem/ — fillColor, strokeColor
 *
 * マッチングは from_color と同じ色空間で保持されている色のみ（cmyk は CMYKColor、rgb は RGBColor）。
 * gray / none の from_color、特色・グレー・グラデーション・パターンの色にはマッチしない。
 * to_color の色空間は from_color と揃える必要はない（RGB の色を CMYK に置換できる。実機確認済み）。
 * 対象は PathItem の塗り/線のみで、テキストの文字色は置換しない。
 */
const jsxCode = `
${COLOR_HELPERS_JSX}

var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var fromColor = params.from_color;
    var toColor = params.to_color;
    var tolerance = (typeof params.tolerance === "number") ? params.tolerance : 0;
    var target = params.target || "both";
    var scope = params.scope || null;

    function colorsMatch(c1, c2, tol) {
      try {
        if (c1.typename === "CMYKColor" && c2.type === "cmyk") {
          return Math.abs(c1.cyan - c2.c) <= tol &&
                 Math.abs(c1.magenta - c2.m) <= tol &&
                 Math.abs(c1.yellow - c2.y) <= tol &&
                 Math.abs(c1.black - c2.k) <= tol;
        } else if (c1.typename === "RGBColor" && c2.type === "rgb") {
          return Math.abs(c1.red - c2.r) <= tol &&
                 Math.abs(c1.green - c2.g) <= tol &&
                 Math.abs(c1.blue - c2.b) <= tol;
        }
      } catch(e) {}
      return false;
    }

    var newColorObj = createColor(toColor);
    var replacedCount = 0;

    // Determine scope
    var pathSource;
    if (scope) {
      var foundLayer = null;
      function findLayerByName(layers, name) {
        for (var li = 0; li < layers.length; li++) {
          if (layers[li].name === name) return layers[li];
          try {
            var sub = findLayerByName(layers[li].layers, name);
            if (sub) return sub;
          } catch(e2) {}
        }
        return null;
      }
      foundLayer = findLayerByName(doc.layers, scope);
      if (foundLayer) {
        pathSource = foundLayer.pathItems;
      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + scope });
        pathSource = null;
      }
    } else {
      pathSource = doc.pathItems;
    }

    if (pathSource) {
      for (var i = 0; i < pathSource.length; i++) {
        var item = pathSource[i];
        // Replace fill
        if ((target === "fill" || target === "both") && item.filled) {
          try {
            if (colorsMatch(item.fillColor, fromColor, tolerance)) {
              item.fillColor = newColorObj;
              replacedCount++;
            }
          } catch(e) {}
        }
        // Replace stroke
        if ((target === "stroke" || target === "both") && item.stroked) {
          try {
            if (colorsMatch(item.strokeColor, fromColor, tolerance)) {
              item.strokeColor = newColorObj;
              replacedCount++;
            }
          } catch(e) {}
        }
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        replacedCount: replacedCount,
        fromColor: fromColor,
        toColor: toColor,
        verified: { replacedCount: replacedCount }
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Replace color failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'replace_color',
    {
      title: 'Replace Color',
      description:
        'Find and replace fill/stroke colors of paths across the document or within a specific layer (text colors are not changed). from_color must be cmyk or rgb and matches only objects whose current color is stored in that same color type (check with get_colors) — an RGB from_color does not match CMYK-colored objects. to_color can be any type, e.g. replace an RGB color with a CMYK one. Spot, gray, gradient and pattern colors are never matched.',
      inputSchema: {
        from_color: colorSchema.unwrap().describe('Color to find (required). cmyk or rgb, in the same color type the objects currently use'),
        to_color: colorSchema.unwrap().describe('Replacement color (required). Any type; need not match from_color\'s type'),
        tolerance: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .default(0)
          .describe('Color matching tolerance per channel (0 = exact match, 100 = match any)'),
        target: z
          .enum(['fill', 'stroke', 'both'])
          .optional()
          .default('both')
          .describe('Which color attributes to replace'),
        scope: z
          .string()
          .optional()
          .describe('Layer name to limit replacement scope (default: entire document)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return formatToolResult(result);
    },
  );
}
