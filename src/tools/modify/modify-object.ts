import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, FONT_HELPERS_JSX, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    ${COLOR_HELPERS_JSX}
    ${FONT_HELPERS_JSX}

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "No object found matching UUID: " + params.uuid });
    } else {
      var errors = [];

      // Position / size via geometricBounds: [top, left, bottom, right]
      var bounds = null;
      try { bounds = item.geometricBounds; } catch(e) {}

      if (bounds) {
        var curTop   = bounds[0];
        var curLeft  = bounds[1];
        var curBot   = bounds[2];
        var curRight = bounds[3];
        var curW = curRight - curLeft;
        var curH = curBot   - curTop;

        var newX = (typeof params.x === "number") ? params.x : curLeft;
        var newY = (typeof params.y === "number") ? params.y : curTop;
        var newW = (typeof params.width  === "number") ? params.width  : curW;
        var newH = (typeof params.height === "number") ? params.height : curH;

        if (typeof params.x === "number" || typeof params.y === "number" ||
            typeof params.width === "number" || typeof params.height === "number") {
          try {
            item.geometricBounds = [newY, newX, newY + newH, newX + newW];
          } catch(e) { errors.push("bounds: " + e.message); }
        }
      }

      if (typeof params.fill !== "undefined") {
        try { applyFill(item, doc, params.fill); }
        catch(e) { errors.push("fill: " + e.message); }
      }

      if (params.stroke) {
        try { applyStroke(item, doc, params.stroke); }
        catch(e) { errors.push("stroke: " + e.message); }
      }

      if (typeof params.opacity === "number") {
        try { item.transparencySettings.blendingSettings.opacity = params.opacity; }
        catch(e) { errors.push("opacity: " + e.message); }
      }

      if (typeof params.rotation === "number") {
        try { item.rotationAngle = params.rotation; }
        catch(e) { errors.push("rotation: " + e.message); }
      }

      if (typeof params.name === "string") {
        try { item.name = params.name; }
        catch(e) { errors.push("name: " + e.message); }
      }

      if (typeof params.visible === "boolean") {
        try { item.visible = params.visible; }
        catch(e) { errors.push("visible: " + e.message); }
      }

      if (typeof params.locked === "boolean") {
        try { item.locked = params.locked; }
        catch(e) { errors.push("locked: " + e.message); }
      }

      if (typeof params.contents === "string") {
        try {
          var rawContents = params.contents.replace(/\\\\n/g, "\\n");
          item.contents = rawContents;
        } catch(e) { errors.push("contents: " + e.message); }
      }

      var fontCandidates = null;
      if (params.font_name) {
        try {
          item.texts[0].appliedFont = app.fonts.item(params.font_name);
        } catch(e) {
          errors.push("font_name: Font '" + params.font_name + "' not found.");
          fontCandidates = findFontCandidates(params.font_name);
        }
      }

      if (typeof params.font_size === "number") {
        try { item.texts[0].pointSize = params.font_size; }
        catch(e) { errors.push("font_size: " + e.message); }
      }

      var verifiedState = verifyItem(item);
      if (errors.length > 0) {
        var result = { success: false, uuid: params.uuid, errors: errors, verified: verifiedState };
        if (fontCandidates !== null) { result.font_candidates = fontCandidates; }
        writeResultFile(RESULT_PATH, result);
      } else {
        writeResultFile(RESULT_PATH, { success: true, uuid: params.uuid, verified: verifiedState });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to modify object: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'modify_object',
    {
      title: 'Modify Object',
      description: 'Modify properties of an existing InDesign page item by UUID.',
      inputSchema: {
        uuid: z.string().describe('UUID of the target object'),
        x: z.number().optional().describe('Left edge X coordinate in points'),
        y: z.number().optional().describe('Top edge Y coordinate in points'),
        width: z.number().optional().describe('Width in points'),
        height: z.number().optional().describe('Height in points'),
        fill: colorSchema.describe('Fill color'),
        stroke: strokeSchema.describe('Stroke settings'),
        opacity: z.number().min(0).max(100).optional().describe('Opacity (0-100)'),
        rotation: z.number().optional().describe('Absolute rotation angle in degrees'),
        name: z.string().optional().describe('Object name'),
        visible: z.boolean().optional().describe('Visibility'),
        locked: z.boolean().optional().describe('Lock state'),
        contents: z.string().optional().describe('Text contents (for text frames). Use \\n for line breaks.'),
        font_name: z.string().optional().describe('Font name for text frames'),
        font_size: z.number().optional().describe('Font size in points for text frames'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
