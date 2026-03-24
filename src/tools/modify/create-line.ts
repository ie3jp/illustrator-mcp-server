import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, COLOR_HELPERS_JSX } from './shared.js';

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
      applyStroke(line, params.stroke, true);
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

export function register(server: McpServer): void {
  server.registerTool(
    'create_line',
    {
      title: 'Create Line',
      description: 'Create a line. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        x1: z.number().describe('Start point X coordinate'),
        y1: z.number().describe('Start point Y coordinate'),
        x2: z.number().describe('End point X coordinate'),
        y2: z.number().describe('End point Y coordinate'),
        stroke: z
          .object({
            color: colorSchema.describe('Stroke color'),
            width: z.number().optional().describe('Stroke width'),
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
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
