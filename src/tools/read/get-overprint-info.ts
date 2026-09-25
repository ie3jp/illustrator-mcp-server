import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_overprint_info — オーバープリント設定の取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItem/ — fillOverprint, strokeOverprint
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/CharacterAttributes/ — overprintFill, overprintStroke
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/RasterItem/ — overprint
 *
 * heuristic は色の値だけから推定したもので、制作意図は判定できない。
 * 「overprintCount: 0 = 安全」と読まれないよう、走査範囲（scope）を結果に必ず載せる。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;
    var results = [];
    var scanned = { pathItems: 0, textFrames: 0, rasterItems: 0 };
    var skippedItems = {};

    // オーバープリント面の色を分類: "k100" | "rich_black" | "spot" | "other"
    function classifyInk(color) {
      var tn = "";
      try { tn = color.typename; } catch(e) { return "other"; }
      if (tn === "CMYKColor") {
        if (color.black === 100 && color.cyan === 0 && color.magenta === 0 && color.yellow === 0) return "k100";
        if (color.black >= 90 && (color.cyan > 0 || color.magenta > 0 || color.yellow > 0)) return "rich_black";
        return "other";
      }
      if (tn === "GrayColor") {
        // GrayColor.gray はインク量（100 = スミ単色）
        return color.gray === 100 ? "k100" : "other";
      }
      if (tn === "SpotColor") {
        var ct = null;
        try { ct = color.spot.colorType; } catch(e) {}
        // グローバルプロセスカラーは特色版を持たないので中身の色で判定する
        if (ct === ColorModel.PROCESS) {
          var tint = 100;
          try { tint = color.tint; } catch(e) {}
          return tint === 100 ? classifyInk(color.spot.color) : "other";
        }
        return "spot";
      }
      return "other";
    }

    // 1 面でも K100/リッチブラック/特色以外がオーバープリントなら事故の可能性が高い
    function heuristicFor(kinds) {
      if (kinds.length === 0) return "no_effect";
      var hasRich = false;
      var hasSpot = false;
      for (var i = 0; i < kinds.length; i++) {
        if (kinds[i] === "other") return "likely_accidental";
        if (kinds[i] === "rich_black") hasRich = true;
        if (kinds[i] === "spot") hasSpot = true;
      }
      if (hasRich) return "rich_black_overprint";
      if (hasSpot) return "spot_overprint";
      return "k100_overprint";
    }

    function baseEntry(item, itemType) {
      var objName = "";
      try { objName = item.name || ""; } catch(e) {}
      return {
        uuid: ensureUUID(item),
        objectName: objName,
        itemType: itemType,
        layerName: getParentLayerName(item),
        hidden: !isItemEffectivelyVisible(item)
      };
    }

    // fillColor / strokeColor は「塗り/線が実際に設定されている場合のみ」渡す（なしは null）
    function pushPaintEntry(item, itemType, fillOP, strokeOP, fillColor, strokeColor, characterCount) {
      var kinds = [];
      var fillKind = null;
      var strokeKind = null;
      if (fillOP && fillColor) { fillKind = classifyInk(fillColor); kinds.push(fillKind); }
      if (strokeOP && strokeColor) { strokeKind = classifyInk(strokeColor); kinds.push(strokeKind); }
      var inkCoverage = null;
      try {
        if (fillColor && fillColor.typename === "CMYKColor") {
          inkCoverage = fillColor.cyan + fillColor.magenta + fillColor.yellow + fillColor.black;
        }
      } catch(e) {}
      var entry = baseEntry(item, itemType);
      entry.fillOverprint = fillOP;
      entry.strokeOverprint = strokeOP;
      entry.fillColor = fillColor ? colorToObject(fillColor) : null;
      entry.strokeColor = strokeColor ? colorToObject(strokeColor) : null;
      entry.fillKind = fillKind;
      entry.strokeKind = strokeKind;
      entry.inkCoverage = inkCoverage;
      if (characterCount !== null) entry.characterCount = characterCount;
      entry.heuristic = heuristicFor(kinds);
      results.push(entry);
    }

    function analyzePath(item) {
      scanned.pathItems++;
      var fillOP = false;
      var strokeOP = false;
      try { fillOP = item.fillOverprint === true; } catch(e) {}
      try { strokeOP = item.strokeOverprint === true; } catch(e) {}
      if (!fillOP && !strokeOP) return;
      var fillColor = null;
      var strokeColor = null;
      try { if (item.filled) fillColor = item.fillColor; } catch(e) {}
      try { if (item.stroked) strokeColor = item.strokeColor; } catch(e) {}
      pushPaintEntry(item, "path", fillOP, strokeOP, fillColor, strokeColor, null);
    }

    function paintOrNull(color) {
      if (!color) return null;
      try { if (color.typename === "NoColor") return null; } catch(e) { return null; }
      return color;
    }

    // テキストのオーバープリントは文字単位の属性。
    // 同じ（塗りOP, 線OP, 塗り色, 線色）の組み合わせは 1 エントリにまとめて文字数を数える
    function analyzeText(tf) {
      scanned.textFrames++;
      var groups = {};
      var order = [];
      var ranges = tf.textRanges;
      for (var ri = 0; ri < ranges.length; ri++) {
        var range = ranges[ri];
        var ca = null;
        try { ca = range.characterAttributes; } catch(e) { continue; }
        var fOP = false;
        var sOP = false;
        try { fOP = ca.overprintFill === true; } catch(e) {}
        try { sOP = ca.overprintStroke === true; } catch(e) {}
        if (!fOP && !sOP) continue;
        var fc = null;
        var sc = null;
        try { fc = paintOrNull(ca.fillColor); } catch(e) {}
        try { sc = paintOrNull(ca.strokeColor); } catch(e) {}
        var len = 1;
        try { if (typeof range.length === "number") len = range.length; } catch(e) {}
        var key = (fOP ? "1" : "0") + (sOP ? "1" : "0") + "|" +
          jsonStringify(colorToObject(fc)) + "|" + jsonStringify(colorToObject(sc));
        if (groups[key]) {
          groups[key].characterCount += len;
        } else {
          groups[key] = { fOP: fOP, sOP: sOP, fc: fc, sc: sc, characterCount: len };
          order.push(key);
        }
      }
      for (var gi = 0; gi < order.length; gi++) {
        var g = groups[order[gi]];
        pushPaintEntry(tf, "text", g.fOP, g.sOP, g.fc, g.sc, g.characterCount);
      }
    }

    function analyzeRaster(item) {
      scanned.rasterItems++;
      var op = false;
      try { op = item.overprint === true; } catch(e) {}
      if (!op) return;
      var entry = baseEntry(item, "raster");
      entry.overprint = true;
      entry.heuristic = "raster_overprint";
      results.push(entry);
    }

    for (var layerIdx = 0; layerIdx < doc.layers.length; layerIdx++) {
      // iterateAllItems はグループ・複合パス内部・サブレイヤーまで辿る
      iterateAllItems(doc.layers[layerIdx], function(item) {
        var tn = "";
        try { tn = item.typename; } catch(e) { return; }
        try {
          if (tn === "PathItem") analyzePath(item);
          else if (tn === "TextFrame") analyzeText(item);
          else if (tn === "RasterItem") analyzeRaster(item);
          else if (tn !== "GroupItem" && tn !== "CompoundPathItem") {
            skippedItems[tn] = (skippedItems[tn] || 0) + 1;
          }
        } catch(e) {}
      });
    }

    writeResultFile(RESULT_PATH, {
      overprintCount: results.length,
      items: results,
      scope: {
        scanned: scanned,
        skippedItems: skippedItems,
        notInspected: "Overprint inside placed/linked files, symbol instances, meshes and plugin items (counted in skippedItems) and extra fills/strokes added via the Appearance panel are NOT inspected. overprintCount 0 does not guarantee the file is free of overprint."
      },
      heuristicNote: "heuristic is inferred from colors only and cannot know intent. k100_overprint / rich_black_overprint / spot_overprint are common intentional settings; likely_accidental = an overprinting fill/stroke is not K100, rich black or spot (e.g. white overprint makes the object disappear); no_effect = overprint is set on a side with no paint; raster_overprint needs manual review. Confirm with Separations Preview."
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_overprint_info',
    {
      title: 'Get Overprint Info',
      description:
        'Get overprint settings of paths (incl. compound paths), text (per character) and raster images, each with a heuristic label (K100 / rich black / spot / likely accidental) inferred from colors only. The result includes the scan scope; placed files, symbols and meshes are not inspected.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return formatToolResult(result);
    },
  );
}
