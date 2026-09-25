import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { colorSchema, strokeSchema, COLOR_HELPERS_JSX, FONT_HELPERS_JSX, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * modify_object — オブジェクトのプロパティ変更
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — position, width, height, opacity, locked, hidden, name
 *
 * rotation の累積角度は note メタデータ (::ai-mcp:rot=N) に記録するため、UI で直接回転するとずれる。
 *
 * グループ・複合パスの fill/stroke は UI と同様に配下の末端へ適用し、末端を読み返して検証する
 * （common.jsx の collectPaintLeaves / verifyPaintContainer）。
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

    function applyFillToTarget(t, colorObj) {
      if (t.typename === "TextFrame") {
        t.textRange.characterAttributes.fillColor = createColor(colorObj);
      } else {
        applyOptionalFill(t, colorObj);
      }
    }

    function applyStrokeToTarget(t, strokeObj) {
      if (t.typename === "TextFrame") {
        var sca = t.textRange.characterAttributes;
        if (typeof strokeObj.width === "number") sca.strokeWeight = strokeObj.width;
        if (strokeObj.color) sca.strokeColor = createColor(strokeObj.color);
      } else {
        applyStroke(t, strokeObj, t.stroked);
      }
    }

    // 読み返した色が指定色と一致するか。true / false、色空間が違う場合は null
    // （ドキュメントのカラーモードへ Illustrator が変換した可能性があり、値では比較できない）
    function paintMatches(actual, req) {
      var tol = 0.5;
      if (!req || req.type === "none") return actual.type === "none";
      if (actual.type !== req.type) return actual.type === "none" ? false : null;
      if (req.type === "cmyk") {
        return Math.abs(actual.c - req.c) <= tol && Math.abs(actual.m - req.m) <= tol &&
               Math.abs(actual.y - req.y) <= tol && Math.abs(actual.k - req.k) <= tol;
      }
      if (req.type === "rgb") {
        return Math.abs(actual.r - req.r) <= tol && Math.abs(actual.g - req.g) <= tol &&
               Math.abs(actual.b - req.b) <= tol;
      }
      if (req.type === "gray") return Math.abs(actual.value - req.value) <= tol;
      return null;
    }

    // fill / stroke を末端へ適用して読み返す。report には件数、errors / warnings に失敗・スキップを積む
    function applyPaint(kind, targets, skipped, value, errors, warnings) {
      var report = { targets: targets.length, changed: 0 };
      var failed = [];
      var mismatched = 0;
      var converted = 0;
      for (var ti = 0; ti < targets.length; ti++) {
        var t = targets[ti];
        try {
          var ok, before, after;
          if (kind === "fill") {
            before = readTargetFill(t);
            applyFillToTarget(t, value);
            after = readTargetFill(t);
            ok = paintMatches(after, value);
          } else {
            before = readTargetStroke(t).color;
            applyStrokeToTarget(t, value);
            var st = readTargetStroke(t);
            after = st.color;
            ok = true;
            if (value.color) {
              ok = paintMatches(st.color, value.color);
            }
            if (ok !== false && typeof value.width === "number" && !(value.color && value.color.type === "none") &&
                Math.abs(st.width - value.width) > 0.01) {
              ok = false;
            }
          }
          // 色空間が違って値比較できない場合、書き込み前と同じ色のままなら反映されていないとみなす
          // （変換済みの同色が既に入っていた場合もここに入るが、偽成功よりは失敗として報告する）
          if (ok === null && jsonStringify(before) === jsonStringify(after)) ok = false;
          if (ok === false) {
            mismatched++;
          } else {
            if (ok === null) converted++;
            report.changed++;
          }
        } catch(eT) {
          failed.push(eT.message);
        }
      }
      if (targets.length === 0) {
        errors.push(kind + ": no path or text object to paint in this " + getItemType(item));
      }
      if (failed.length > 0) {
        errors.push(kind + ": failed on " + failed.length + " of " + targets.length + " objects (e.g. " + failed[0] + ")");
      }
      if (mismatched > 0) {
        errors.push(kind + ": " + mismatched + " of " + targets.length + " objects did not take the requested value when read back (unchanged or different)");
      }
      if (converted > 0) {
        warnings.push(kind + ": " + converted + " objects read back in a different color space (converted to the document color mode)");
      }
      var skippedText = describeSkippedPaint(skipped);
      if (skippedText) {
        warnings.push(kind + ": skipped " + skippedText + " (cannot take or should not receive a " + kind + ")");
      }
      return report;
    }

    var item = findItemByUUID(params.uuid);
    // フォントが見つからなければ半端な状態を残さないよう、他のプロパティも含めて何も変更しない
    var resolvedFont = null;
    if (params.properties.font_name) {
      try { resolvedFont = app.textFonts.getByName(params.properties.font_name); } catch(eFont) { resolvedFont = null; }
    }
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "No object found matching UUID: " + params.uuid });
    } else if (params.properties.font_name && !resolvedFont) {
      writeResultFile(RESULT_PATH, fontNotFoundResult(params.properties.font_name, true));
    } else {
      var props = params.properties;
      var errors = [];
      var warnings = [];
      var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;

      // locked=false は他のプロパティ変更が弾かれないよう最初に適用する
      if (props.locked === false) {
        try { item.locked = false; }
        catch(e) { errors.push("locked: " + e.message); }
      }

      if (typeof props.hidden === "boolean") {
        try { item.hidden = props.hidden; }
        catch(e) { errors.push("hidden: " + e.message); }
      }

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

      var isContainer = isPaintContainer(item);
      var paintTargets = null;
      var paintSkipped = {};
      var paintReport = {};
      if (typeof props.fill !== "undefined" || props.stroke) {
        paintTargets = collectPaintLeaves(item, paintSkipped);
      }

      if (typeof props.fill !== "undefined") {
        try {
          paintReport.fill = applyPaint("fill", paintTargets, paintSkipped, props.fill, errors, warnings);
        } catch(e) { errors.push("fill: " + e.message); }
      }

      if (props.stroke) {
        try {
          paintReport.stroke = applyPaint("stroke", paintTargets, paintSkipped, props.stroke, errors, warnings);
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

      if (resolvedFont) {
        try {
          // textRanges を回しながら書くと範囲が結合してインデックスがずれ MRAP になる（実機確認）ため全体に一度で設定する
          item.textRange.characterAttributes.textFont = resolvedFont;
        } catch(e) { errors.push("font_name: " + e.message); }
      }

      if (typeof props.font_size === "number") {
        try {
          item.textRange.characterAttributes.size = props.font_size;
        } catch(e) { errors.push("font_size: " + e.message); }
      }

      if (typeof props.tracking === "number") {
        try {
          item.textRange.characterAttributes.tracking = props.tracking;
        } catch(e) { errors.push("tracking: " + e.message); }
      }

      if (typeof props.leading !== "undefined") {
        try {
          var lca = item.textRange.characterAttributes;
          if (props.leading === "auto") {
            lca.autoLeading = true;
          } else {
            lca.autoLeading = false;
            lca.leading = props.leading;
          }
        } catch(e) { errors.push("leading: " + e.message); }
      }

      if (props.justification) {
        try {
          var justMap = { left: Justification.LEFT, center: Justification.CENTER, right: Justification.RIGHT };
          item.textRange.paragraphAttributes.justification = justMap[props.justification];
        } catch(e) { errors.push("justification: " + e.message); }
      }

      // locked=true は他の変更を全て終えてから最後に適用する
      if (props.locked === true) {
        try { item.locked = true; }
        catch(e) { errors.push("locked: " + e.message); }
      }

      var verifiedState = verifyItem(item, coordSystem, abRect);
      if (isContainer) verifyPaintContainer(verifiedState, item);
      if (item.typename === "TextFrame" && (typeof props.leading !== "undefined" || props.justification)) {
        try {
          var vca = item.textRange.characterAttributes;
          verifiedState.autoLeading = vca.autoLeading;
          verifiedState.leading = vca.leading;
        } catch(eVL) {}
        try {
          var vj = item.textRange.paragraphAttributes.justification;
          // ExtendScript は括弧なしの三項演算子の連鎖を誤評価するため必ず括弧で囲む
          verifiedState.justification = (vj === Justification.LEFT) ? "left" : ((vj === Justification.CENTER) ? "center" :
            ((vj === Justification.RIGHT) ? "right" : String(vj)));
        } catch(eVJ) {}
      }

      var result = { success: errors.length === 0, uuid: params.uuid, coordinateSystem: coordSystem };
      if (errors.length > 0) result.errors = errors;
      if (warnings.length > 0) result.warnings = warnings;
      if (paintReport.fill || paintReport.stroke) result.painted = paintReport;
      result.verified = verifiedState;
      writeResultFile(RESULT_PATH, appendColorSpaceWarnings(result));
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
      description:
        'Modify properties of an existing object. fill/stroke on a group or compound path are applied to every path and text frame inside it (like Illustrator\'s UI; clipping paths and guides are skipped) and the result reports how many were changed (painted) and the colors they actually have (verified.descendantFills). success is false if any of them could not be painted. Note: Illustrator will be activated (brought to foreground) during execution.',
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
            fill: colorSchema.describe('Fill color. For text frames this is the character color; for groups/compound paths it is applied to all paths and text inside'),
            stroke: strokeSchema.describe('Stroke settings. For groups/compound paths it is applied to all paths and text inside'),
            opacity: z.number().optional().describe('Opacity (0-100)'),
            rotation: z.number().optional().describe('Rotation in degrees. Default mode is "delta" (additive). Use rotation_mode: "absolute" for target angle.'),
            rotation_mode: z.enum(['delta', 'absolute']).optional().default('delta').describe('delta = add to current rotation, absolute = set to exact angle'),
            name: z.string().optional().describe('Object name'),
            hidden: z.boolean().optional().describe('Hide (true) or show (false) the object without deleting it'),
            locked: z.boolean().optional().describe('Lock (true) or unlock (false) the object. Unlock is applied before other changes, lock after them'),
            contents: z.string().optional().describe('Text contents (for text frames)'),
            font_name: z.string().optional().describe('Exact font name for text frames, as listed by list_fonts (the \'name\' field, e.g. PostScript name \'HelveticaNeue-Bold\'). If not found, nothing is modified and an error with font_candidates is returned'),
            font_size: z.number().optional().describe('Font size (for text frames)'),
            tracking: z
              .number()
              .min(-1000)
              .max(10000)
              .optional()
              .describe(
                'Letter spacing (tracking) in 1/1000 em, for text frames. 0 = none, positive = looser, negative = tighter. Same units and range as Illustrator\'s Character panel.',
              ),
            justification: z
              .enum(['left', 'center', 'right'])
              .optional()
              .describe('Paragraph alignment for text frames, applied to all paragraphs'),
            leading: z
              .union([z.number().positive(), z.literal('auto')])
              .optional()
              .describe('Line spacing (leading) in pt for text frames, or "auto" for auto leading. Omit to leave unchanged'),
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
