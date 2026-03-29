import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, WRITE_ANNOTATIONS } from './shared.js';

/**
 * create_rectangle — 矩形の作成
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItems/ — PathItems.rectangle(top, left, width, height)
 * JSX API: PathItems.rectangle(), PathItems.roundedRectangle()
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

    var inputX = params.x;
    var inputY = params.y;
    var w = params.width;
    var h = params.height;
    var cornerRadius = params.corner_radius || 0;

    var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;
    var pos = webToAiPoint(inputX, inputY, coordSystem, abRect);
    var left = pos[0];
    var top = pos[1];

    var targetLayer = resolveTargetLayer(doc, params.layer_name);

    var rect;
    if (cornerRadius > 0) {
      rect = targetLayer.pathItems.roundedRectangle(top, left, w, h, cornerRadius, cornerRadius);
    } else {
      rect = targetLayer.pathItems.rectangle(top, left, w, h);
    }

    applyOptionalFill(rect, params.fill);
    applyStroke(rect, params.stroke, rect.stroked);

    if (params.name) {
      rect.name = params.name;
    }

    var uuid = ensureUUID(rect);
    writeResultFile(RESULT_PATH, { uuid: uuid, verified: verifyItem(rect, coordSystem, abRect) });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create rectangle: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_rectangle',
    {
      title: 'Create Rectangle',
      description: 'Create a rectangle. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        x: z.number().describe('Top-left X coordinate'),
        y: z.number().describe('Top-left Y coordinate'),
        width: z.number().describe('Width'),
        height: z.number().describe('Height'),
        corner_radius: z.number().optional().default(0).describe('Corner radius'),
        fill: colorSchema.describe('Fill color'),
        stroke: strokeSchema.describe('Stroke settings'),
        layer_name: z.string().optional().describe('Target layer name'),
        name: z.string().optional().describe('Object name'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
