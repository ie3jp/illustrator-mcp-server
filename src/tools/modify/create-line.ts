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

    var ix1 = params.x1;
    var iy1 = params.y1;
    var ix2 = params.x2;
    var iy2 = params.y2;

    var px1, py1, px2, py2;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      var abRect = ab.artboardRect;
      px1 = abRect[0] + ix1;
      py1 = abRect[1] + (-iy1);
      px2 = abRect[0] + ix2;
      py2 = abRect[1] + (-iy2);
    } else {
      px1 = ix1;
      py1 = iy1;
      px2 = ix2;
      py2 = iy2;
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

    var line = targetLayer.pathItems.add();
    line.setEntirePath([[px1, py1], [px2, py2]]);
    line.filled = false;

    if (params.stroke) {
      line.stroked = true;
      if (params.stroke.color) {
        line.strokeColor = createColor(params.stroke.color);
      }
      if (typeof params.stroke.width === "number") {
        line.strokeWidth = params.stroke.width;
      }
      if (params.stroke.cap) {
        if (params.stroke.cap === "round") {
          line.strokeCap = StrokeCap.ROUNDENDCAP;
        } else if (params.stroke.cap === "projecting") {
          line.strokeCap = StrokeCap.PROJECTINGENDCAP;
        } else {
          line.strokeCap = StrokeCap.BUTTENDCAP;
        }
      }
    } else {
      line.stroked = true;
    }

    if (params.name) {
      line.name = params.name;
    }

    var uuid = ensureUUID(line);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create line: " + e.message, line: e.line });
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
    'create_line',
    {
      title: 'Create Line',
      description: 'Create a line',
      inputSchema: {
        x1: z.number().describe('Start point X coordinate'),
        y1: z.number().describe('Start point Y coordinate'),
        x2: z.number().describe('End point X coordinate'),
        y2: z.number().describe('End point Y coordinate'),
        stroke: z
          .object({
            color: colorSchema.describe('Stroke color'),
            width: z.number().describe('Stroke width'),
            cap: z
              .enum(['butt', 'round', 'projecting'])
              .optional()
              .describe('Line cap style'),
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
