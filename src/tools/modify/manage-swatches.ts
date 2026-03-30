import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { DESTRUCTIVE_ANNOTATIONS, COLOR_HELPERS_JSX, colorSchema } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;
    ${COLOR_HELPERS_JSX}

    function getSwatchInfo(swatch) {
      return { name: swatch.name };
    }

    if (action === "add") {
      if (!params.color) {
        writeResultFile(RESULT_PATH, { error: true, message: "color is required for add action" });
      } else {
        var color = createColor(doc, params.color);
        // In InDesign, createColor already adds it to doc.colors
        // Create a named swatch
        var swatch = null;
        try {
          swatch = doc.swatches.itemByName(params.name);
          if (!swatch || !swatch.isValid) {
            // Add new color with the name
            var newColor = doc.colors.add();
            if (params.color.type === "cmyk") {
              newColor.model = ColorModel.PROCESS;
              newColor.space = ColorSpace.CMYK;
              newColor.colorValue = [params.color.c, params.color.m, params.color.y, params.color.k];
            } else if (params.color.type === "rgb") {
              newColor.model = ColorModel.PROCESS;
              newColor.space = ColorSpace.RGB;
              newColor.colorValue = [params.color.r, params.color.g, params.color.b];
            }
            newColor.name = params.name;
            swatch = newColor;
          }
        } catch(e) {
          writeResultFile(RESULT_PATH, { error: true, message: "Failed to add swatch: " + e.message });
          swatch = null;
        }
        if (swatch) {
          writeResultFile(RESULT_PATH, { success: true, action: "add", name: params.name, verified: { swatchCount: doc.swatches.length } });
        }
      }

    } else if (action === "update") {
      var existing = doc.swatches.itemByName(params.name);
      if (!existing || !existing.isValid) {
        writeResultFile(RESULT_PATH, { error: true, message: "Swatch not found: " + params.name });
      } else {
        if (params.color && params.color.type === "cmyk") {
          existing.colorValue = [params.color.c, params.color.m, params.color.y, params.color.k];
        } else if (params.color && params.color.type === "rgb") {
          existing.colorValue = [params.color.r, params.color.g, params.color.b];
        }
        if (params.new_name) {
          existing.name = params.new_name;
        }
        writeResultFile(RESULT_PATH, { success: true, action: "update", name: params.name, verified: { swatchCount: doc.swatches.length } });
      }

    } else if (action === "delete") {
      var toDelete = doc.swatches.itemByName(params.name);
      if (!toDelete || !toDelete.isValid) {
        writeResultFile(RESULT_PATH, { error: true, message: "Swatch not found: " + params.name });
      } else {
        toDelete.remove(doc.swatches.itemByName("None"));
        writeResultFile(RESULT_PATH, { success: true, action: "delete", name: params.name, verified: { swatchCount: doc.swatches.length } });
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_swatches failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_swatches',
    {
      title: 'Manage Swatches',
      description: 'Add, update, or delete color swatches in the active InDesign document.',
      inputSchema: {
        action: z.enum(['add', 'update', 'delete']).describe('Action to perform'),
        name: z.string().describe('Swatch name'),
        new_name: z.string().optional().describe('New swatch name (for update action)'),
        color: colorSchema.describe('Color for add/update (required for add)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
