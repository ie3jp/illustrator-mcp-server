import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX } from './shared.js';

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

    applyOptionalFill(path, params.fill);
    applyStroke(path, params.stroke, path.stroked);

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
      description: 'Create a custom path. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        anchors: z.array(anchorSchema).describe('Array of anchor points'),
        closed: z.boolean().optional().default(false).describe('Whether to close the path'),
        fill: colorSchema.describe('Fill color'),
        stroke: strokeSchema.describe('Stroke settings'),
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
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
