import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, FONT_HELPERS_JSX } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    ${COLOR_HELPERS_JSX}
    ${FONT_HELPERS_JSX}

    function findItemByUUID(uuid) {
      var doc = app.activeDocument;
      function search(items) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          try {
            if (item.note === uuid) return item;
          } catch(e) {}
          if (item.typename === "GroupItem") {
            var found = search(item.pageItems);
            if (found) return found;
          }
        }
        return null;
      }
      for (var li = 0; li < doc.layers.length; li++) {
        var found = search(doc.layers[li].pageItems);
        if (found) return found;
      }
      return null;
    }

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "No object found matching UUID: " + params.uuid });
    } else {
      var props = params.properties;
      var errors = [];

      if (props.position) {
        try {
          var px = props.position.x;
          var py = props.position.y;
          if (coordSystem === "artboard-web") {
            var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
            var abRect = ab.artboardRect;
            px = abRect[0] + px;
            py = abRect[1] + (-py);
          }
          item.position = [px, py];
        } catch(e) { errors.push("position: " + e.message); }
      }

      if (props.size) {
        try {
          if (typeof props.size.width === "number") {
            item.width = props.size.width;
          }
          if (typeof props.size.height === "number") {
            item.height = props.size.height;
          }
        } catch(e) { errors.push("size: " + e.message); }
      }

      if (typeof props.fill !== "undefined") {
        try {
          applyOptionalFill(item, props.fill);
        } catch(e) { errors.push("fill: " + e.message); }
      }

      if (props.stroke) {
        try {
          applyStroke(item, props.stroke, item.stroked);
        } catch(e) { errors.push("stroke: " + e.message); }
      }

      if (typeof props.opacity === "number") {
        try { item.opacity = props.opacity; }
        catch(e) { errors.push("opacity: " + e.message); }
      }

      if (typeof props.rotation === "number") {
        try { item.rotate(props.rotation); }
        catch(e) { errors.push("rotation: " + e.message); }
      }

      if (typeof props.name === "string") {
        try { item.name = props.name; }
        catch(e) { errors.push("name: " + e.message); }
      }

      if (typeof props.contents === "string") {
        try { item.contents = props.contents; }
        catch(e) { errors.push("contents: " + e.message); }
      }

      var fontCandidates = null;
      if (props.font_name) {
        try {
          var resolvedFont = app.textFonts.getByName(props.font_name);
          for (var ri = 0; ri < item.textRanges.length; ri++) {
            item.textRanges[ri].characterAttributes.textFont = resolvedFont;
          }
        } catch(e) {
          errors.push("font_name: Font '" + props.font_name + "' not found.");
          fontCandidates = findFontCandidates(props.font_name);
        }
      }

      if (typeof props.font_size === "number") {
        try {
          for (var ri2 = 0; ri2 < item.textRanges.length; ri2++) {
            item.textRanges[ri2].characterAttributes.size = props.font_size;
          }
        } catch(e) { errors.push("font_size: " + e.message); }
      }

      if (errors.length > 0) {
        var result = { success: false, uuid: params.uuid, errors: errors };
        if (fontCandidates !== null) { result.font_candidates = fontCandidates; }
        writeResultFile(RESULT_PATH, result);
      } else {
        writeResultFile(RESULT_PATH, { success: true, uuid: params.uuid });
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
      description: 'Modify properties of an existing object. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuid: z.string().describe('UUID of the target object'),
        properties: z
          .object({
            position: z
              .object({
                x: z.number().describe('X coordinate'),
                y: z.number().describe('Y coordinate'),
              })
              .optional()
              .describe('Position'),
            size: z
              .object({
                width: z.number().optional().describe('Width'),
                height: z.number().optional().describe('Height'),
              })
              .optional()
              .describe('Size'),
            fill: colorSchema.describe('Fill color'),
            stroke: strokeSchema.describe('Stroke settings'),
            opacity: z.number().optional().describe('Opacity (0-100)'),
            rotation: z.number().optional().describe('Rotation delta in degrees (additive — each call adds to current rotation)'),
            name: z.string().optional().describe('Object name'),
            contents: z.string().optional().describe('Text contents (for text frames)'),
            font_name: z.string().optional().describe('Font name for text frames (partial match supported)'),
            font_size: z.number().optional().describe('Font size (for text frames)'),
          })
          .describe('Properties to modify'),
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe('Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
