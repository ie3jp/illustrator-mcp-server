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
        var c = new RGBColor();
        c.red = (typeof colorObj.r === "number") ? colorObj.r : 0;
        c.green = (typeof colorObj.g === "number") ? colorObj.g : 0;
        c.blue = (typeof colorObj.b === "number") ? colorObj.b : 0;
        return c;
      }
      return new NoColor();
    }

    var inputX = params.x;
    var inputY = params.y;
    var w = params.width;
    var h = params.height;
    var cornerRadius = params.corner_radius || 0;

    var left = inputX;
    var top;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      var abRect = ab.artboardRect;
      left = abRect[0] + inputX;
      top = abRect[1] + (-inputY);
    } else {
      top = inputY;
    }

    var targetLayer = doc.activeLayer;
    if (params.layer_name) {
      try {
        targetLayer = doc.layers.getByName(params.layer_name);
      } catch (e) {
        targetLayer = doc.layers.add();
        targetLayer.name = params.layer_name;
      }
    }

    var rect;
    if (cornerRadius > 0) {
      rect = targetLayer.pathItems.roundedRectangle(top, left, w, h, cornerRadius, cornerRadius);
    } else {
      rect = targetLayer.pathItems.rectangle(top, left, w, h);
    }

    if (params.fill) {
      rect.filled = true;
      rect.fillColor = createColor(params.fill);
    }

    if (params.stroke) {
      rect.stroked = true;
      if (params.stroke.color) {
        rect.strokeColor = createColor(params.stroke.color);
      }
      if (typeof params.stroke.width === "number") {
        rect.strokeWidth = params.stroke.width;
      }
    }

    if (params.name) {
      rect.name = params.name;
    }

    var uuid = ensureUUID(rect);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create rectangle: " + e.message, line: e.line });
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
    'create_rectangle',
    {
      title: 'Create Rectangle',
      description: 'Create a rectangle',
      inputSchema: {
        x: z.number().describe('Top-left X coordinate'),
        y: z.number().describe('Top-left Y coordinate'),
        width: z.number().describe('Width'),
        height: z.number().describe('Height'),
        corner_radius: z.number().optional().default(0).describe('Corner radius'),
        fill: colorSchema.describe('Fill color'),
        stroke: z
          .object({
            color: colorSchema.describe('Stroke color'),
            width: z.number().describe('Stroke width'),
          })
          .optional()
          .describe('Stroke settings'),
        layer_name: z.string().optional().describe('Target layer name'),
        name: z.string().optional().describe('Object name'),
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
