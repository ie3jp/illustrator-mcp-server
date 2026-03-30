import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, COLOR_HELPERS_JSX, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    ${COLOR_HELPERS_JSX}

    var fromColor = params.from_color;
    var toColor = params.to_color;
    var tolerance = (typeof params.tolerance === "number") ? params.tolerance : 0;
    var target = params.target || "both";
    var replacedCount = 0;

    // Create the replacement color
    var newColorObj = createColor(doc, toColor);

    function colorValuesMatch(colorValue, fromC, tol) {
      // colorValue is an array from InDesign item.fillColor.colorValue
      // fromC is the params color object
      if (!colorValue || !fromC) return false;
      if (fromC.type === "cmyk" && colorValue.length >= 4) {
        return Math.abs(colorValue[0] - fromC.c) <= tol &&
               Math.abs(colorValue[1] - fromC.m) <= tol &&
               Math.abs(colorValue[2] - fromC.y) <= tol &&
               Math.abs(colorValue[3] - fromC.k) <= tol;
      }
      if (fromC.type === "rgb" && colorValue.length >= 3) {
        return Math.abs(colorValue[0] - fromC.r) <= tol &&
               Math.abs(colorValue[1] - fromC.g) <= tol &&
               Math.abs(colorValue[2] - fromC.b) <= tol;
      }
      return false;
    }

    function processItem(item) {
      // Fill
      if (target === "fill" || target === "both") {
        try {
          var fc = item.fillColor;
          if (fc && fc.colorValue) {
            if (colorValuesMatch(fc.colorValue, fromColor, tolerance)) {
              item.fillColor = newColorObj;
              replacedCount++;
            }
          }
        } catch(e) {}
      }
      // Stroke
      if (target === "stroke" || target === "both") {
        try {
          var sc = item.strokeColor;
          if (sc && sc.colorValue) {
            if (colorValuesMatch(sc.colorValue, fromColor, tolerance)) {
              item.strokeColor = newColorObj;
              replacedCount++;
            }
          }
        } catch(e) {}
      }
    }

    // Scope: specific layer or all page items
    var pageItems;
    if (params.scope) {
      var scopeLayer = doc.layers.itemByName(params.scope);
      if (!scopeLayer || !scopeLayer.isValid) {
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + params.scope });
        pageItems = null;
      } else {
        pageItems = scopeLayer.allPageItems;
      }
    } else {
      pageItems = doc.allPageItems;
    }

    if (pageItems) {
      for (var i = 0; i < pageItems.length; i++) {
        processItem(pageItems[i]);
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
    writeResultFile(RESULT_PATH, { error: true, message: "replace_color failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'replace_color',
    {
      title: 'Replace Color',
      description: 'Find and replace colors across the InDesign document or within a specific layer.',
      inputSchema: {
        from_color: colorSchema.unwrap().describe('Color to find (required)'),
        to_color: colorSchema.unwrap().describe('Replacement color (required)'),
        tolerance: z.number().min(0).max(100).optional().default(0).describe('Color matching tolerance per channel (0 = exact match)'),
        target: z.enum(['fill', 'stroke', 'both']).optional().default('both').describe('Which color attributes to replace'),
        scope: z.string().optional().describe('Layer name to limit replacement scope (default: entire document)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
