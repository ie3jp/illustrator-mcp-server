import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";

    function createColor(colorObj) {
      if (!colorObj || colorObj.type === "none") return new NoColor();
      if (colorObj.type === "cmyk") {
        var c = new CMYKColor();
        c.cyan = (typeof colorObj.c === "number") ? colorObj.c : 0;
        c.magenta = (typeof colorObj.m === "number") ? colorObj.m : 0;
        c.yellow = (typeof colorObj.y === "number") ? colorObj.y : 0;
        c.black = (typeof colorObj.k === "number") ? colorObj.k : 0;
        return c;
      }
      if (colorObj.type === "rgb") {
        if (typeof colorObj.r !== "number" && typeof colorObj.g !== "number" && typeof colorObj.b !== "number") {
          return new NoColor(); // チャンネル未指定は NoColor 扱い
        }
        var c = new RGBColor();
        c.red = (typeof colorObj.r === "number") ? colorObj.r : 0;
        c.green = (typeof colorObj.g === "number") ? colorObj.g : 0;
        c.blue = (typeof colorObj.b === "number") ? colorObj.b : 0;
        return c;
      }
      return new NoColor();
    }

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

      if (props.fill) {
        try {
          item.fillColor = createColor(props.fill);
          item.filled = true;
        } catch(e) { errors.push("fill: " + e.message); }
      }

      if (props.stroke) {
        try {
          if (props.stroke.color) {
            item.strokeColor = createColor(props.stroke.color);
          }
          if (typeof props.stroke.width === "number") {
            item.strokeWidth = props.stroke.width;
          }
          item.stroked = true;
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

      if (props.font_name) {
        try {
          var tf = app.textFonts.getByName(props.font_name);
          for (var ri = 0; ri < item.textRanges.length; ri++) {
            item.textRanges[ri].characterAttributes.textFont = tf;
          }
        } catch(e) { errors.push("font_name: " + e.message); }
      }

      if (typeof props.font_size === "number") {
        try {
          for (var ri2 = 0; ri2 < item.textRanges.length; ri2++) {
            item.textRanges[ri2].characterAttributes.size = props.font_size;
          }
        } catch(e) { errors.push("font_size: " + e.message); }
      }

      if (errors.length > 0) {
        writeResultFile(RESULT_PATH, { success: false, uuid: params.uuid, errors: errors });
      } else {
        writeResultFile(RESULT_PATH, { success: true, uuid: params.uuid });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to modify object: " + e.message, line: e.line });
  }
}
`;

const colorSchema = z
  .object({
    type: z.enum(['cmyk', 'rgb', 'none']).describe('Color type'),
    c: z.number().optional(),
    m: z.number().optional(),
    y: z.number().optional(),
    k: z.number().optional(),
    r: z.number().optional(),
    g: z.number().optional(),
    b: z.number().optional(),
  })
  .optional();

export function register(server: McpServer): void {
  server.registerTool(
    'modify_object',
    {
      title: 'Modify Object',
      description: 'Modify properties of an existing object',
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
                width: z.number().describe('Width'),
                height: z.number().describe('Height'),
              })
              .optional()
              .describe('Size'),
            fill: colorSchema.describe('Fill color'),
            stroke: z
              .object({
                color: colorSchema.describe('Stroke color'),
                width: z.number().describe('Stroke width'),
              })
              .optional()
              .describe('Stroke settings'),
            opacity: z.number().optional().describe('Opacity (0-100)'),
            rotation: z.number().optional().describe('Rotation angle (degrees), relative to current angle'),
            name: z.string().optional().describe('Object name'),
            contents: z.string().optional().describe('Text contents (for text frames)'),
            font_name: z.string().optional().describe('Font name (for text frames)'),
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
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
