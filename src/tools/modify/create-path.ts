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

    var abRect = null;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      abRect = ab.artboardRect;
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

    var anchors = params.anchors;
    var closed = params.closed || false;

    // まずアンカーポイントの座標を変換
    var anchorPositions = [];
    for (var i = 0; i < anchors.length; i++) {
      var pt = anchors[i];
      var aiCoords = webToAiCoords(pt.x, pt.y, abRect);
      anchorPositions.push(aiCoords);
    }

    var path = targetLayer.pathItems.add();
    path.closed = closed;

    // setEntirePathでアンカー位置を設定
    path.setEntirePath(anchorPositions);

    // ハンドルやポイントタイプの設定
    for (var i = 0; i < anchors.length; i++) {
      var pt = anchors[i];
      var pp = path.pathPoints[i];

      if (pt.point_type === "smooth") {
        pp.pointType = PointType.SMOOTH;
      } else {
        pp.pointType = PointType.CORNER;
      }

      if (pt.left_handle) {
        var lh = webToAiCoords(pt.left_handle.x, pt.left_handle.y, abRect);
        pp.leftDirection = lh;
      }

      if (pt.right_handle) {
        var rh = webToAiCoords(pt.right_handle.x, pt.right_handle.y, abRect);
        pp.rightDirection = rh;
      }
    }

    if (params.fill) {
      path.filled = true;
      path.fillColor = createColor(params.fill);
    } else {
      path.filled = false;
    }

    if (params.stroke) {
      path.stroked = true;
      if (params.stroke.color) {
        path.strokeColor = createColor(params.stroke.color);
      }
      if (typeof params.stroke.width === "number") {
        path.strokeWidth = params.stroke.width;
      }
    }

    if (params.name) {
      path.name = params.name;
    }

    var uuid = ensureUUID(path);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create path: " + e.message, line: e.line });
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

const anchorSchema = z.object({
  x: z.number().describe('Anchor point X coordinate'),
  y: z.number().describe('Anchor point Y coordinate'),
  left_handle: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional()
    .describe('Left direction handle coordinates'),
  right_handle: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional()
    .describe('Right direction handle coordinates'),
  point_type: z
    .enum(['corner', 'smooth'])
    .optional()
    .default('corner')
    .describe('Point type'),
});

export function register(server: McpServer): void {
  server.registerTool(
    'create_path',
    {
      title: 'Create Path',
      description: 'Create a custom path',
      inputSchema: {
        anchors: z.array(anchorSchema).describe('Array of anchor points'),
        closed: z.boolean().optional().default(false).describe('Whether to close the path'),
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
