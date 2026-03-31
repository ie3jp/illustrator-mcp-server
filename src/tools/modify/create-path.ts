import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coordinateSystemSchema } from '../session.js';
import { executeToolJsx } from '../tool-executor.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, WRITE_ANNOTATIONS, coerceBoolean } from './shared.js';

/**
 * create_path — カスタムパスの作成
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItems/ — PathItems.add()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItem/ — setEntirePath(), closed
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathPoint/ — anchor, leftDirection, rightDirection, pointType
 */
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

    var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;

    var targetLayer = resolveTargetLayer(doc, params.layer_name);

    var anchors = params.anchors;
    var closed = params.closed || false;

    // まずアンカーポイントの座標を変換
    var anchorPositions = [];
    for (var i = 0; i < anchors.length; i++) {
      var pt = anchors[i];
      var aiCoords = webToAiPoint(pt.x, pt.y, coordSystem, abRect);
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
        var lh = webToAiPoint(pt.left_handle.x, pt.left_handle.y, coordSystem, abRect);
        pp.leftDirection = lh;
      }

      if (pt.right_handle) {
        var rh = webToAiPoint(pt.right_handle.x, pt.right_handle.y, coordSystem, abRect);
        pp.rightDirection = rh;
      }
    }

    applyOptionalFill(path, params.fill);
    applyStroke(path, params.stroke, path.stroked);

    if (params.name) {
      path.name = params.name;
    }

    var uuid = ensureUUID(path);
    writeResultFile(RESULT_PATH, { uuid: uuid, verified: verifyItem(path, coordSystem, abRect) });
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
        closed: coerceBoolean.optional().default(false).describe('Whether to close the path'),
        fill: colorSchema.describe('Fill color'),
        stroke: strokeSchema.describe('Stroke settings'),
        layer_name: z.string().optional().describe('Target layer name'),
        name: z.string().optional().describe('Object name'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true, resolveCoordinate: true });
    },
  );
}
