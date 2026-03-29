import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, WRITE_ANNOTATIONS } from './shared.js';

/**
 * create_ellipse — 楕円の作成
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItems/ — PathItems.ellipse(top, left, width, height)
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

    var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;
    var pos = webToAiPoint(inputX, inputY, coordSystem, abRect);
    var left = pos[0];
    var top = pos[1];

    var targetLayer = resolveTargetLayer(doc, params.layer_name);

    var ellipse = targetLayer.pathItems.ellipse(top, left, w, h);

    applyOptionalFill(ellipse, params.fill);
    applyStroke(ellipse, params.stroke, ellipse.stroked);

    if (params.name) {
      ellipse.name = params.name;
    }

    var uuid = ensureUUID(ellipse);
    writeResultFile(RESULT_PATH, { uuid: uuid, verified: verifyItem(ellipse, coordSystem, abRect) });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create ellipse: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_ellipse',
    {
      title: 'Create Ellipse',
      description: 'Create an ellipse. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        x: z.number().describe('Bounding box top-left X coordinate'),
        y: z.number().describe('Bounding box top-left Y coordinate'),
        width: z.number().describe('Width'),
        height: z.number().describe('Height'),
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
