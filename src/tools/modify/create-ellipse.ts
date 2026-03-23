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

    var ellipse = targetLayer.pathItems.ellipse(top, left, w, h);

    if (params.fill) {
      ellipse.filled = true;
      ellipse.fillColor = createColor(params.fill);
    }

    if (params.stroke) {
      ellipse.stroked = true;
      if (params.stroke.color) {
        ellipse.strokeColor = createColor(params.stroke.color);
      }
      if (typeof params.stroke.width === "number") {
        ellipse.strokeWidth = params.stroke.width;
      }
    }

    if (params.name) {
      ellipse.name = params.name;
    }

    var uuid = ensureUUID(ellipse);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create ellipse: " + e.message, line: e.line });
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
    'create_ellipse',
    {
      title: 'Create Ellipse',
      description: 'Create an ellipse',
      inputSchema: {
        x: z.number().describe('Bounding box top-left X coordinate'),
        y: z.number().describe('Bounding box top-left Y coordinate'),
        width: z.number().describe('Width'),
        height: z.number().describe('Height'),
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
