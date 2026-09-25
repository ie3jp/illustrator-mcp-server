import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { DESTRUCTIVE_ANNOTATIONS, COLOR_HELPERS_JSX, cmykColorSchema, rgbColorSchema, grayColorSchema } from './shared.js';

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
 *
 * グループ・複合パスへの適用は配下のパス（複合パス内部を含む）とテキストの文字に塗り、読み返して検証する。
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
    var coordSystem = params.coordinate_system || "artboard-web";

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

    // verified の bounds は他ツールと同じく解決済みの座標系で返す
    var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;
    var gradName = grad.name;
    var appliedCount = 0;
    var notFound = [];
    var errors = [];
    var warnings = [];
    var verifiedItems = [];

    function newGradientColor() {
      var gc = new GradientColor();
      gc.gradient = grad;
      if (typeof params.angle === "number") gc.angle = params.angle;
      return gc;
    }

    // グループ・複合パスは配下の末端に塗り、末端を読み返して確かめる
    function applyGradientTo(uuid, item) {
      var skipped = {};
      var targets = collectPaintLeaves(item, skipped);
      var changed = 0;
      var failed = [];
      var mismatched = 0;
      for (var ti = 0; ti < targets.length; ti++) {
        var t = targets[ti];
        try {
          if (t.typename === "TextFrame") {
            t.textRange.characterAttributes.fillColor = newGradientColor();
          } else {
            t.filled = true;
            t.fillColor = newGradientColor();
          }
          var after = readTargetFill(t);
          if (after.type === "gradient" && after.name === gradName) {
            changed++;
          } else {
            mismatched++;
          }
        } catch(eT) {
          failed.push(eT.message);
        }
      }
      var label = uuid + " (" + getItemType(item) + ")";
      if (targets.length === 0) errors.push(label + ": no path or text object to paint");
      if (failed.length > 0) {
        errors.push(label + ": failed on " + failed.length + " of " + targets.length + " objects (e.g. " + failed[0] + ")");
      }
      if (mismatched > 0) {
        errors.push(label + ": " + mismatched + " of " + targets.length + " objects did not take the gradient when read back");
      }
      var skippedText = describeSkippedPaint(skipped);
      if (skippedText) warnings.push(label + ": skipped " + skippedText);
      if (targets.length > 0 && changed === targets.length) appliedCount++;
    }

    if (params.apply_to_uuids) {
      for (var ai = 0; ai < params.apply_to_uuids.length; ai++) {
        var item = findItemByUUID(params.apply_to_uuids[ai]);
        if (item) {
          applyGradientTo(params.apply_to_uuids[ai], item);
          var snap = verifyItem(item, coordSystem, abRect);
          if (isPaintContainer(item)) verifyPaintContainer(snap, item);
          verifiedItems.push(snap);
        } else {
          notFound.push(params.apply_to_uuids[ai]);
        }
      }
    }
    var result = {
      success: notFound.length === 0 && errors.length === 0,
      name: gradName,
      type: params.type || "linear",
      stopCount: stops.length,
      appliedCount: appliedCount,
      coordinateSystem: coordSystem,
      verified: verifiedItems
    };
    if (notFound.length > 0) result.notFound = notFound;
    if (errors.length > 0) result.errors = errors;
    if (warnings.length > 0) result.warnings = warnings;
    writeResultFile(RESULT_PATH, appendColorSpaceWarnings(result));
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
          .describe('UUIDs of objects to apply this gradient as fill. For groups/compound paths it is applied to every path and text inside (clipping paths and guides are skipped) and checked by reading back; verified then reports descendantFills. UUIDs that cannot be found are listed in notFound, objects that could not be painted in errors; either makes success false (the gradient itself is still created).'),
        angle: z.number().optional().default(0).describe('Gradient angle (for linear). Note: may not take effect due to a long-standing Illustrator bug (since 2008).'),
        coordinate_system: coordinateSystemSchema,
      },
      // apply_to_uuids を指定すると既存の塗りを上書きする
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true, resolveCoordinate: true });
    },
  );
}
