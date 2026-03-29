import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, COLOR_HELPERS_JSX, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

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
        toColor: toColor
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
      description: 'Find and replace colors across the document or within a specific layer',
      inputSchema: {
        from_color: colorSchema.unwrap().describe('Color to find (required)'),
        to_color: colorSchema.unwrap().describe('Replacement color (required)'),
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
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
