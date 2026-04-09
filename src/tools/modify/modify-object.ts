import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, FONT_HELPERS_JSX, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * modify_object — オブジェクトのプロパティ変更
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — position, width, height, opacity, locked, hidden, name
 *
 * 注意: rotation の累積角度は item.note のメタデータ (::rot=N) に記録される。
 * Illustrator UI で直接回転した場合はこの値と実際の角度がずれる。
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
    ${FONT_HELPERS_JSX}

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "No object found matching UUID: " + params.uuid });
    } else {
      var props = params.properties;
      var errors = [];
      var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;

      if (props.position) {
        try {
          var pos = webToAiPoint(props.position.x, props.position.y, coordSystem, abRect);
          item.position = pos;
        } catch(e) { errors.push("position: " + e.message); }
      }

      if (props.size) {
        try {
          if (typeof props.size.width === "number") {
            item.width = props.size.width;
          }
          if (typeof props.size.height === "number") {
            item.height = props.size.height;
          }
        } catch(e) { errors.push("size: " + e.message); }
      }

      if (typeof props.fill !== "undefined") {
        try {
          applyOptionalFill(item, props.fill);
        } catch(e) { errors.push("fill: " + e.message); }
      }

      if (props.stroke) {
        try {
          applyStroke(item, props.stroke, item.stroked);
        } catch(e) { errors.push("stroke: " + e.message); }
      }

      if (typeof props.opacity === "number") {
        try { item.opacity = props.opacity; }
        catch(e) { errors.push("opacity: " + e.message); }
      }

      if (typeof props.rotation === "number") {
        try {
          var rotMode = props.rotation_mode || "delta";
          if (rotMode === "absolute") {
            // note メタデータから現在の累積回転角度を読み取り、差分を適用
            var noteStr = item.note || "";
            var currentDeg = parseFloat(getNoteMeta(noteStr, "rot")) || 0;
            var delta = props.rotation - currentDeg;
            if (Math.abs(delta) > 0.001) {
              item.rotate(delta);
            }
            setNoteMeta(item, "rot", String(Math.round(props.rotation * 1000) / 1000));
          } else {
            item.rotate(props.rotation);
            // delta 回転時も累積角度を更新
            var noteStr2 = item.note || "";
            var prevDeg = parseFloat(getNoteMeta(noteStr2, "rot")) || 0;
            setNoteMeta(item, "rot", String(Math.round((prevDeg + props.rotation) * 1000) / 1000));
          }
        }
        catch(e) { errors.push("rotation: " + e.message + " (line: " + (e.line || "?") + ")"); }
      }

      if (typeof props.name === "string") {
        try { item.name = props.name; }
        catch(e) { errors.push("name: " + e.message); }
      }

      if (typeof props.contents === "string") {
        try { item.contents = props.contents.split(String.fromCharCode(10)).join(String.fromCharCode(13)); }
        catch(e) { errors.push("contents: " + e.message); }
      }

      var fontCandidates = null;
      if (props.font_name) {
        try {
          var resolvedFont = app.textFonts.getByName(props.font_name);
          for (var ri = 0; ri < item.textRanges.length; ri++) {
            item.textRanges[ri].characterAttributes.textFont = resolvedFont;
          }
        } catch(e) {
          errors.push("font_name: Font '" + props.font_name + "' not found.");
          fontCandidates = findFontCandidates(props.font_name);
        }
      }

      if (typeof props.font_size === "number") {
        try {
          for (var ri2 = 0; ri2 < item.textRanges.length; ri2++) {
            item.textRanges[ri2].characterAttributes.size = props.font_size;
          }
        } catch(e) { errors.push("font_size: " + e.message); }
      }

      var verifiedState = verifyItem(item, coordSystem, abRect);
      if (errors.length > 0) {
        var result = { success: false, uuid: params.uuid, coordinateSystem: coordSystem, errors: errors, verified: verifiedState };
        if (fontCandidates !== null) { result.font_candidates = fontCandidates; }
        writeResultFile(RESULT_PATH, result);
      } else {
        writeResultFile(RESULT_PATH, { success: true, uuid: params.uuid, coordinateSystem: coordSystem, verified: verifiedState });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to modify object: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'modify_object',
    {
      title: 'Modify Object',
      description: 'Modify properties of an existing object. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuid: z.string().describe('UUID of the target object'),
        properties: z
          .object({
            position: z
              .object({
                x: z.number().describe('X coordinate'),
                y: z.number().describe('Y coordinate'),
              })
              .optional()
              .describe('Position'),
            size: z
              .object({
                width: z.number().optional().describe('Width'),
                height: z.number().optional().describe('Height'),
              })
              .optional()
              .describe('Size'),
            fill: colorSchema.describe('Fill color'),
            stroke: strokeSchema.describe('Stroke settings'),
            opacity: z.number().optional().describe('Opacity (0-100)'),
            rotation: z.number().optional().describe('Rotation in degrees. Default mode is "delta" (additive). Use rotation_mode: "absolute" for target angle.'),
            rotation_mode: z.enum(['delta', 'absolute']).optional().default('delta').describe('delta = add to current rotation, absolute = set to exact angle'),
            name: z.string().optional().describe('Object name'),
            contents: z.string().optional().describe('Text contents (for text frames)'),
            font_name: z.string().optional().describe('Font name for text frames (partial match supported)'),
            font_size: z.number().optional().describe('Font size (for text frames)'),
          })
          .describe('Properties to modify'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true, resolveCoordinate: true });
    },
  );
}
