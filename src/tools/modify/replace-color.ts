import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { colorSchema, COLOR_HELPERS_JSX, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * replace_color — 塗り/線の色を一括置換
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItem/ — fillColor, strokeColor
 *
 * マッチングは from_color と同じ色空間で保持されている色のみ（cmyk は CMYKColor、rgb は RGBColor）。
 * gray / none の from_color、特色・グレー・グラデーション・パターンの色にはマッチしない。
 * to_color の色空間は from_color と揃える必要はない（RGB の色を CMYK に置換できる。実機確認済み）。
 * 対象は PathItem の塗り/線と、テキストの文字色（塗り/線。文字範囲ごとに比較・置換）。
 * 置換は読み返して確かめ、例外・未反映は failed に対象を載せて success を false にする。
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
    var fromColor = params.from_color;
    var toColor = params.to_color;
    var tolerance = (typeof params.tolerance === "number") ? params.tolerance : 0;
    var target = params.target || "both";
    var scope = params.scope || null;

    function colorsMatch(c1, c2, tol) {
      try {
        if (c1.typename === "CMYKColor" && c2.type === "cmyk") {
          return Math.abs(c1.cyan - c2.c) <= tol &&
                 Math.abs(c1.magenta - c2.m) <= tol &&
                 Math.abs(c1.yellow - c2.y) <= tol &&
                 Math.abs(c1.black - c2.k) <= tol;
        } else if (c1.typename === "RGBColor" && c2.type === "rgb") {
          return Math.abs(c1.red - c2.r) <= tol &&
                 Math.abs(c1.green - c2.g) <= tol &&
                 Math.abs(c1.blue - c2.b) <= tol;
        }
      } catch(e) {}
      return false;
    }

    var newColorObj = createColor(toColor);

    // 読み返した色が to_color か。色空間が違う（文書のモードへ変換された）ときは
    // 値で比べられないので、from_color に一致しなくなっていれば反映とみなす
    function tookNewColor(actual) {
      var a = colorToObject(actual);
      if (toColor.type === "none") return a.type === "none";
      if (a.type !== toColor.type) return a.type !== "none" && !colorsMatch(actual, fromColor, tolerance);
      var tol = 0.5;
      if (a.type === "cmyk") {
        return Math.abs(a.c - toColor.c) <= tol && Math.abs(a.m - toColor.m) <= tol &&
               Math.abs(a.y - toColor.y) <= tol && Math.abs(a.k - toColor.k) <= tol;
      }
      if (a.type === "rgb") {
        return Math.abs(a.r - toColor.r) <= tol && Math.abs(a.g - toColor.g) <= tol && Math.abs(a.b - toColor.b) <= tol;
      }
      if (a.type === "gray") return Math.abs(a.value - toColor.value) <= tol;
      return false;
    }

    // 置換できなかった対象（例外、または読み返しても変わっていない）
    var MAX_FAILED_LISTED = 50;
    var failed = [];
    var failedCount = 0;
    function noteFailure(item, attribute, reason) {
      failedCount++;
      if (failed.length >= MAX_FAILED_LISTED) return;
      var info = { uuid: null, type: "", name: "", layer: "", attribute: attribute, reason: reason };
      try { info.uuid = extractUUIDFromNote(item.note) || null; } catch(e1) {}
      try { info.type = getItemType(item); } catch(e2) {}
      try { info.name = item.name || ""; } catch(e3) {}
      try { info.layer = getParentLayerName(item); } catch(e4) {}
      failed.push(info);
    }

    // 一致したら置換して読み返す。置換したら true、一致しなければ false、失敗は noteFailure して false
    function replaceOne(holder, prop, owner, attribute) {
      var current = holder[prop];
      if (!colorsMatch(current, fromColor, tolerance)) return false;
      try {
        holder[prop] = newColorObj;
      } catch(eSet) {
        noteFailure(owner, attribute, eSet.message);
        return false;
      }
      if (!tookNewColor(holder[prop])) {
        noteFailure(owner, attribute, "color unchanged when read back");
        return false;
      }
      return true;
    }

    var replacedCount = 0;
    // テキストの文字色。文字ごとに色が違いうるため textRanges 単位で比較・置換する。
    // 線は太さ 0 だと見えないので対象にしない。1 範囲でも置換したフレームを数える
    var textFramesChanged = 0;
    function replaceInText(tf) {
      // 色を変えた範囲は同色の隣と結合し、元の範囲オブジェクトは無効になる（触ると MRAP、実機確認）。
      // 範囲ごとには設定だけ行い（後ろから回せば未処理側のインデックスはずれない）、最後に取り直して検証する
      var attempted = { fill: false, stroke: false };
      var doFill = (target === "fill" || target === "both");
      var doStroke = (target === "stroke" || target === "both");
      for (var ri = tf.textRanges.length - 1; ri >= 0; ri--) {
        if (ri >= tf.textRanges.length) continue;
        var ca = tf.textRanges[ri].characterAttributes;
        if (doFill && colorsMatch(ca.fillColor, fromColor, tolerance)) {
          try { ca.fillColor = newColorObj; attempted.fill = true; }
          catch(eF) { noteFailure(tf, "text_fill", eF.message); }
        }
        if (doStroke && ca.strokeWeight > 0 && colorsMatch(ca.strokeColor, fromColor, tolerance)) {
          try { ca.strokeColor = newColorObj; attempted.stroke = true; }
          catch(eS) { noteFailure(tf, "text_stroke", eS.message); }
        }
      }
      if (!attempted.fill && !attempted.stroke) return;
      var left = { fill: 0, stroke: 0 };
      for (var vi = 0; vi < tf.textRanges.length; vi++) {
        var vca = tf.textRanges[vi].characterAttributes;
        if (attempted.fill && colorsMatch(vca.fillColor, fromColor, tolerance)) left.fill++;
        if (attempted.stroke && vca.strokeWeight > 0 && colorsMatch(vca.strokeColor, fromColor, tolerance)) left.stroke++;
      }
      if (left.fill > 0) noteFailure(tf, "text_fill", left.fill + " range(s) still have the original color");
      if (left.stroke > 0) noteFailure(tf, "text_stroke", left.stroke + " range(s) still have the original color");
      if (left.fill === 0 && left.stroke === 0) textFramesChanged++;
    }

    function replaceInPath(item) {
      if ((target === "fill" || target === "both") && item.filled) {
        if (replaceOne(item, "fillColor", item, "fill")) replacedCount++;
      }
      if ((target === "stroke" || target === "both") && item.stroked) {
        if (replaceOne(item, "strokeColor", item, "stroke")) replacedCount++;
      }
    }

    // 対象の PathItem（複合パス内部を含む）と TextFrame を集める
    var paths = null;
    var texts = null;
    if (scope) {
      function findLayerByName(layers, name) {
        for (var li = 0; li < layers.length; li++) {
          if (layers[li].name === name) return layers[li];
          try {
            var sub = findLayerByName(layers[li].layers, name);
            if (sub) return sub;
          } catch(e2) {}
        }
        return null;
      }
      var foundLayer = findLayerByName(doc.layers, scope);
      if (foundLayer) {
        // Layer.pathItems / textFrames はグループ内・サブレイヤー内を含まないため全アイテムから集める
        paths = [];
        texts = [];
        var layerItems = collectAllItems(foundLayer);
        for (var ai = 0; ai < layerItems.length; ai++) {
          if (layerItems[ai].typename === "PathItem") paths.push(layerItems[ai]);
          else if (layerItems[ai].typename === "TextFrame") texts.push(layerItems[ai]);
        }
      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + scope });
      }
    } else {
      paths = doc.pathItems;
      texts = doc.textFrames;
    }

    if (paths) {
      for (var i = 0; i < paths.length; i++) {
        try { replaceInPath(paths[i]); } catch(eP) { noteFailure(paths[i], "path", eP.message); }
      }
      for (var ti = 0; ti < texts.length; ti++) {
        try { replaceInText(texts[ti]); } catch(eT) { noteFailure(texts[ti], "text", eT.message); }
      }

      var result = {
        success: failedCount === 0,
        replacedCount: replacedCount,
        textFramesChanged: textFramesChanged,
        failedCount: failedCount,
        fromColor: fromColor,
        toColor: toColor,
        // 各置換は読み返して to_color になったものだけ数えている
        verified: { replacedCount: replacedCount, textFramesChanged: textFramesChanged }
      };
      if (failedCount > 0) {
        result.failed = failed;
        if (failedCount > failed.length) result.failedListTruncated = true;
      }
      writeResultFile(RESULT_PATH, appendColorSpaceWarnings(result));
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Replace color failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'replace_color',
    {
      title: 'Replace Color',
      description:
        'Find and replace fill/stroke colors of paths and text characters across the document or within a specific layer. replacedCount counts replaced path fills/strokes; textFramesChanged counts text frames in which at least one character color was replaced (text strokes with weight 0 are ignored). Every replacement is read back; matches that could not be replaced (e.g. locked) are listed in failed and make success false. A layer scope includes groups and sublayers inside it. from_color must be cmyk or rgb and matches only objects whose current color is stored in that same color type (check with get_colors) — an RGB from_color does not match CMYK-colored objects. to_color can be any type, e.g. replace an RGB color with a CMYK one. Spot, gray, gradient and pattern colors are never matched.',
      inputSchema: {
        from_color: colorSchema.unwrap().describe('Color to find (required). cmyk or rgb, in the same color type the objects currently use'),
        to_color: colorSchema.unwrap().describe('Replacement color (required). Any type; need not match from_color\'s type'),
        tolerance: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .default(0)
          .describe('Color matching tolerance per channel (0 = exact match, 100 = match any)'),
        target: z
          .enum(['fill', 'stroke', 'both'])
          .optional()
          .default('both')
          .describe('Which color attributes to replace'),
        scope: z
          .string()
          .optional()
          .describe('Layer name to limit replacement scope (default: entire document)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return formatToolResult(result);
    },
  );
}
