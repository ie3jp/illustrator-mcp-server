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

    function webToAiCoords(x, y, artboardRect) {
      if (artboardRect) {
        return [artboardRect[0] + x, artboardRect[1] - y];
      }
      return [x, y];
    }

    var inputX = params.x;
    var inputY = params.y;
    var kind = params.kind || "point";

    var abRect = null;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      abRect = ab.artboardRect;
    }

    var aiCoords = webToAiCoords(inputX, inputY, abRect);
    var aiX = aiCoords[0];
    var aiY = aiCoords[1];

    var targetLayer = doc.activeLayer;
    if (params.layer_name) {
      try {
        targetLayer = doc.layers.getByName(params.layer_name);
      } catch (e) {
        targetLayer = doc.layers.add();
        targetLayer.name = params.layer_name;
      }
    }

    var tf;
    if (kind === "area") {
      var w = params.width || 100;
      var h = params.height || 100;
      var rectPath = targetLayer.pathItems.rectangle(aiY, aiX, w, h);
      tf = targetLayer.textFrames.areaText(rectPath);
    } else {
      tf = targetLayer.textFrames.pointText([aiX, aiY]);
    }

    tf.contents = params.contents || "";

    if (params.name) {
      tf.name = params.name;
    }

    var charAttrs = tf.textRange.characterAttributes;

    if (params.font_name) {
      try {
        charAttrs.textFont = app.textFonts.getByName(params.font_name);
      } catch (e) {
        // フォントが見つからない場合は無視
      }
    }

    if (typeof params.font_size === "number") {
      charAttrs.size = params.font_size;
    }

    if (params.fill) {
      charAttrs.fillColor = createColor(params.fill);
    }

    var uuid = ensureUUID(tf);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create text frame: " + e.message, line: e.line });
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
    'create_text_frame',
    {
      title: 'Create Text Frame',
      description: 'Create a text frame',
      inputSchema: {
        x: z.number().describe('X coordinate'),
        y: z.number().describe('Y coordinate'),
        contents: z.string().describe('Text contents'),
        kind: z
          .enum(['point', 'area'])
          .optional()
          .default('point')
          .describe('Text frame type (point or area)'),
        width: z.number().optional().describe('Area text width'),
        height: z.number().optional().describe('Area text height'),
        font_name: z.string().optional().describe('Font name (PostScript name)'),
        font_size: z.number().optional().describe('Font size (pt)'),
        fill: colorSchema.describe('Text color'),
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
