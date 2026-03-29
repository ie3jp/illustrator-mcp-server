import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS, COLOR_HELPERS_JSX, cmykColorSchema, rgbColorSchema, grayColorSchema } from './shared.js';

/**
 * create_gradient — グラデーション作成・オブジェクトへの適用
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Gradient/ — Gradient, GradientStop, GradientColor
 *
 * JSX API:
 *   Document.gradients.add() → Gradient
 *   Gradient.name → String (writable)
 *   Gradient.type → GradientType (LINEAR | RADIAL)
 *   GradientStops.add() → GradientStop
 *   GradientStop.color → Color (writable)
 *   GradientStop.rampPoint → Number (0-100)
 *   GradientStop.midPoint → Number (13-87)
 *   GradientStop.opacity → Number (0-100)
 *   GradientColor — gradient, angle, origin を設定して fillColor に代入
 */
const jsxCode = `
${COLOR_HELPERS_JSX}

var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var grad = doc.gradients.add();
    grad.name = params.name;
    grad.type = (params.type === "radial") ? GradientType.RADIAL : GradientType.LINEAR;

    var stops = params.stops;
    for (var si = 0; si < stops.length; si++) {
      var gs;
      if (si < grad.gradientStops.length) {
        gs = grad.gradientStops[si];
      } else {
        gs = grad.gradientStops.add();
      }
      gs.color = createColor(stops[si].color);
      gs.rampPoint = stops[si].position;
      if (typeof stops[si].mid_point === "number") gs.midPoint = stops[si].mid_point;
      if (typeof stops[si].opacity === "number") gs.opacity = stops[si].opacity;
    }

    var appliedCount = 0;
    if (params.apply_to_uuids) {
      for (var ai = 0; ai < params.apply_to_uuids.length; ai++) {
        var item = findItemByUUID(params.apply_to_uuids[ai]);
        if (item) {
          var gc = new GradientColor();
          gc.gradient = grad;
          if (typeof params.angle === "number") gc.angle = params.angle;
          item.filled = true;
          item.fillColor = gc;
          appliedCount++;
        }
      }
    }

    var verifiedItems = [];
    if (params.apply_to_uuids) {
      for (var vi = 0; vi < params.apply_to_uuids.length; vi++) {
        var vItem = findItemByUUID(params.apply_to_uuids[vi]);
        if (vItem) verifiedItems.push(verifyItem(vItem));
      }
    }
    writeResultFile(RESULT_PATH, {
      success: true,
      name: params.name,
      type: params.type || "linear",
      stopCount: stops.length,
      appliedCount: appliedCount,
      verified: verifiedItems
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "create_gradient failed: " + e.message, line: e.line });
  }
}
`;

const stopColorSchema = z.discriminatedUnion('type', [cmykColorSchema, rgbColorSchema, grayColorSchema]);

export function register(server: McpServer): void {
  server.registerTool(
    'create_gradient',
    {
      title: 'Create Gradient',
      description:
        'Create a gradient in the document and optionally apply it to objects. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        name: z.string().describe('Gradient name'),
        type: z.enum(['linear', 'radial']).optional().default('linear'),
        stops: z
          .array(
            z.object({
              color: stopColorSchema.describe('Stop color'),
              position: z.number().min(0).max(100).describe('Position on ramp (0-100)'),
              mid_point: z
                .number()
                .min(13)
                .max(87)
                .optional()
                .default(50)
                .describe('Midpoint between this stop and next (13-87)'),
              opacity: z.number().min(0).max(100).optional().default(100),
            }),
          )
          .min(2)
          .describe('Gradient stops (minimum 2)'),
        apply_to_uuids: z
          .array(z.string())
          .optional()
          .describe('UUIDs of objects to apply this gradient as fill'),
        angle: z.number().optional().default(0).describe('Gradient angle (for linear). Note: may not take effect due to a long-standing Illustrator bug (since 2008).'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
