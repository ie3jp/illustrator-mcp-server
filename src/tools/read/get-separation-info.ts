import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_separation_info — 色分解情報の取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Ink/ — Ink, InkInfo
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Spot/ — colorType (ColorModel)
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — documentColorSpace, inkList
 *
 * separations は実際に使われている版だけ。使用が見つからないインクは unusedInks に分けて scope を併記する
 * （テキストだけで使う特色を usageCount: 0 から「不要」と誤判断させないため）。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;
    var isCMYKDoc = (doc.documentColorSpace === DocumentColorSpace.CMYK);
    var PROCESS_NAMES = ["Cyan", "Magenta", "Yellow", "Black"];

    // 版の候補: "p:" + 版名 → { name, type, usageCount, hiddenUsageCount, ... }。
    // 特色名は任意なので、"hasOwnProperty" 等が辞書のメソッドや内部キーと衝突しないよう接頭辞を付ける
    var plates = {};
    var plateOrder = [];
    function plateKey(name) { return "p:" + name; }
    function addPlate(info) {
      info.usageCount = 0;
      info.hiddenUsageCount = 0;
      plates[plateKey(info.name)] = info;
      plateOrder.push(info.name);
    }
    function getPlate(name) {
      return plates[plateKey(name)] || null;
    }
    if (isCMYKDoc) {
      for (var pn = 0; pn < PROCESS_NAMES.length; pn++) {
        addPlate({ name: PROCESS_NAMES[pn], type: "process" });
      }
    }

    function spotModel(spot) {
      var ct = null;
      try { ct = spot.colorType; } catch(e) {}
      if (ct === ColorModel.REGISTRATION) return "registration";
      if (ct === ColorModel.PROCESS) return "process";
      // 読めない場合は特色として扱う（取りこぼしより過検出を選ぶ）
      return "spot";
    }

    // 特色スウォッチ（spots[0] 固定ではなく colorType で登録色・グローバルプロセスを除外する）
    var globalProcessColors = [];
    for (var si = 0; si < doc.spots.length; si++) {
      var spot = doc.spots[si];
      var model = spotModel(spot);
      if (model === "registration") continue;
      if (model === "process") {
        globalProcessColors.push(spot.name);
        continue;
      }
      var spotInfo = { name: spot.name, type: "spot", color: null };
      try { spotInfo.color = colorToObject(spot.color); } catch(e) {}
      try {
        var sk = spot.spotKind;
        if (sk === SpotColorKind.SpotCMYK) spotInfo.spotKind = "CMYK";
        else if (sk === SpotColorKind.SpotRGB) spotInfo.spotKind = "RGB";
        else if (sk === SpotColorKind.SpotLAB) spotInfo.spotKind = "LAB";
        else spotInfo.spotKind = sk.toString();
      } catch(e) { spotInfo.spotKind = "unknown"; }
      // 同名のプロセス版と衝突させない
      if (!getPlate(spotInfo.name)) addPlate(spotInfo);
    }

    var registrationUsageCount = 0;
    var patternFillCount = 0;

    // 色が載る版を hit に集める（キーは plateKey()。1 オブジェクト内の重複は 1 回と数える）
    function collectPlates(color, hit) {
      if (!color) return;
      var tn = "";
      try { tn = color.typename; } catch(e) { return; }
      if (tn === "CMYKColor") {
        if (!isCMYKDoc) return;
        if (color.cyan > 0) hit[plateKey("Cyan")] = true;
        if (color.magenta > 0) hit[plateKey("Magenta")] = true;
        if (color.yellow > 0) hit[plateKey("Yellow")] = true;
        if (color.black > 0) hit[plateKey("Black")] = true;
      } else if (tn === "GrayColor") {
        if (isCMYKDoc && color.gray > 0) hit[plateKey("Black")] = true;
      } else if (tn === "SpotColor") {
        var sp = color.spot;
        var m = spotModel(sp);
        if (m === "registration") {
          hit.__registration = true;
        } else if (m === "process") {
          var tint = 100;
          try { tint = color.tint; } catch(e) {}
          if (tint > 0) collectPlates(sp.color, hit);
        } else if (getPlate(sp.name) && getPlate(sp.name).type === "spot") {
          hit[plateKey(sp.name)] = true;
        }
      } else if (tn === "GradientColor") {
        var stops = color.gradient.gradientStops;
        for (var gi = 0; gi < stops.length; gi++) {
          collectPlates(stops[gi].color, hit);
        }
      } else if (tn === "PatternColor") {
        hit.__pattern = true;
      }
    }

    // ラスタは画素値を見ないため、カラースペースから版を推定する（近似）
    function collectRasterPlates(item, hit) {
      var cs = null;
      try { cs = item.imageColorSpace; } catch(e) {}
      var colorants = [];
      try { colorants = item.colorants || []; } catch(e) {}
      for (var ci = 0; ci < colorants.length; ci++) {
        if (getPlate(colorants[ci])) hit[plateKey(colorants[ci])] = true;
      }
      if (!isCMYKDoc) return;
      if (cs === ImageColorSpace.Grayscale) {
        hit[plateKey("Black")] = true;
      } else if (cs === ImageColorSpace.DeviceN || cs === ImageColorSpace.Separation) {
        // colorants で判定済み
      } else {
        // CMYK / RGB / LAB / Indexed は出力時にプロセス 4 版へ載りうる
        for (var pi = 0; pi < PROCESS_NAMES.length; pi++) hit[plateKey(PROCESS_NAMES[pi])] = true;
      }
    }

    function recordUsage(item, hit) {
      var hidden = !isItemEffectivelyVisible(item);
      for (var key in hit) {
        if (key === "__registration") { registrationUsageCount++; continue; }
        if (key === "__pattern") { patternFillCount++; continue; }
        var p = plates[key] || null;
        if (!p) continue;
        p.usageCount++;
        if (hidden) p.hiddenUsageCount++;
      }
    }

    var scanned = { pathItems: 0, textFrames: 0, rasterItems: 0 };
    var skippedItems = {};

    for (var li = 0; li < doc.layers.length; li++) {
      // iterateAllItems はグループ・複合パス内部・サブレイヤーまで辿る（非表示も含む）
      iterateAllItems(doc.layers[li], function(item) {
        var tn = "";
        try { tn = item.typename; } catch(e) { return; }
        var hit = {};
        try {
          if (tn === "PathItem") {
            scanned.pathItems++;
            try { if (item.filled) collectPlates(item.fillColor, hit); } catch(e) {}
            try { if (item.stroked) collectPlates(item.strokeColor, hit); } catch(e) {}
          } else if (tn === "TextFrame") {
            scanned.textFrames++;
            var ranges = item.textRanges;
            for (var ri = 0; ri < ranges.length; ri++) {
              var ca = null;
              try { ca = ranges[ri].characterAttributes; } catch(e) { continue; }
              try { collectPlates(ca.fillColor, hit); } catch(e) {}
              try { collectPlates(ca.strokeColor, hit); } catch(e) {}
            }
          } else if (tn === "RasterItem") {
            scanned.rasterItems++;
            collectRasterPlates(item, hit);
          } else if (tn !== "GroupItem" && tn !== "CompoundPathItem") {
            skippedItems[tn] = (skippedItems[tn] || 0) + 1;
          }
        } catch(e) {}
        recordUsage(item, hit);
      });
    }

    var separations = [];
    var unusedInks = [];
    for (var oi = 0; oi < plateOrder.length; oi++) {
      var plate = getPlate(plateOrder[oi]);
      if (plate.usageCount > 0) separations.push(plate);
      else unusedInks.push({ name: plate.name, type: plate.type });
    }

    // Illustrator 自身のインク一覧（出力設定: 印刷する/しない/プロセスに変換）
    var documentInks = null;
    try {
      var inkList = doc.inkList;
      documentInks = [];
      for (var ii = 0; ii < inkList.length; ii++) {
        var ink = inkList[ii];
        var inkInfo = { name: ink.name };
        try {
          var kd = ink.inkInfo.kind;
          if (kd === InkType.CYANINK) inkInfo.kind = "cyan";
          else if (kd === InkType.MAGENTAINK) inkInfo.kind = "magenta";
          else if (kd === InkType.YELLOWINK) inkInfo.kind = "yellow";
          else if (kd === InkType.BLACKINK) inkInfo.kind = "black";
          else if (kd === InkType.CUSTOMINK) inkInfo.kind = "custom";
          else inkInfo.kind = String(kd);
        } catch(e) {}
        try {
          var ps = ink.inkInfo.printingStatus;
          if (ps === InkPrintStatus.ENABLEINK) inkInfo.printingStatus = "enabled";
          else if (ps === InkPrintStatus.DISABLEINK) inkInfo.printingStatus = "disabled";
          else if (ps === InkPrintStatus.CONVERTINK) inkInfo.printingStatus = "convert_to_process";
          else inkInfo.printingStatus = String(ps);
        } catch(e) {}
        documentInks.push(inkInfo);
      }
    } catch(e) { documentInks = null; }

    writeResultFile(RESULT_PATH, {
      documentColorSpace: isCMYKDoc ? "CMYK" : "RGB",
      separationCount: separations.length,
      separations: separations,
      unusedInks: unusedInks,
      globalProcessColors: globalProcessColors,
      registrationUsageCount: registrationUsageCount,
      documentInks: documentInks,
      scope: {
        scanned: scanned,
        skippedItems: skippedItems,
        patternFillCount: patternFillCount,
        note: "usageCount = number of objects using the plate: path fills/strokes (incl. compound paths, gradient stops, global process colors), text character colors, and raster images (estimated from color space, approximate). Hidden items are included (hiddenUsageCount). NOT inspected: pattern contents, placed/linked files, symbols, meshes, plugin items (skippedItems) and Appearance-panel extra fills/strokes — an ink in unusedInks may still be used there." + (isCMYKDoc ? "" : " RGB document: process plates depend on output conversion and are not listed.")
      }
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_separation_info',
    {
      title: 'Get Separation Info',
      description:
        'Get color separation info: process and spot plates actually used by the artwork (paths, gradients, text, rasters) with usage counts, inks with no detected usage, global process colors, and Illustrator\'s document ink list. The result includes the scan scope; placed files, patterns and symbols are not inspected.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return formatToolResult(result);
    },
  );
}
