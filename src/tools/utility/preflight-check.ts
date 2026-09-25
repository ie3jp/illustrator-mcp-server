import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { readImageDimensions } from '../../utils/image-header.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * preflight_check — 入稿前プリフライトチェック
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — documentColorSpace
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItem/ — overprintFill, overprintStroke
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PlacedItem/ — file, matrix
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/RasterItem/ — imageColorSpace, transparent
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/GradientStop/ — color, opacity
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/CharacterAttributes/ — fillColor, strokeColor
 *
 * 偽陰性対策: 各検査は coverage に checked / partial / skipped / not_applicable を記録する。
 * 「問題なし」は全検査が checked（または not_applicable）のときだけ言い切る。
 */
export const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var minDPI = (params && params.min_dpi) ? params.min_dpi : 300;
    var targetPdfProfile = (params && params.target_pdf_profile) ? params.target_pdf_profile : null;
    var doc = app.activeDocument;
    var results = [];
    var docColorSpace = doc.documentColorSpace;
    var isCMYKDoc = (docColorSpace === DocumentColorSpace.CMYK);

    // 1フレームあたりの文字走査上限。超えたフレームは間引き、coverage に partial と記録する
    var TEXT_SAMPLE_LIMIT = 500;

    // --- 検査範囲の記録（何を検査し、何を飛ばしたか） ---
    var coverage = {};
    function setCoverage(key, status, note) {
      coverage[key] = note ? { status: status, note: note } : { status: status };
    }
    // checked を partial に落とし、理由を追記する（skipped / not_applicable はそのまま）
    function markPartial(key, note) {
      var c = coverage[key];
      if (!c) { setCoverage(key, "partial", note); return; }
      if (c.status === "checked") c.status = "partial";
      c.note = c.note ? (c.note + " " + note) : note;
    }
    // オブジェクト単位の検査で例外が出た件数（空 catch で黙って飛ばさない）
    var inspectErrors = {};
    function countInspectError(key) {
      inspectErrors[key] = (inspectErrors[key] || 0) + 1;
    }

    function isRGBColor(color) {
      try {
        if (color.typename === "RGBColor") return true;
      } catch(e) {}
      return false;
    }

    // RGB 色、または RGB の stop を含むグラデーションか
    function colorHasRGB(color) {
      if (isRGBColor(color)) return true;
      try {
        if (color.typename === "GradientColor") {
          var stops = color.gradient.gradientStops;
          for (var gs = 0; gs < stops.length; gs++) {
            if (isRGBColor(stops[gs].color)) return true;
          }
        }
      } catch(e) {}
      return false;
    }

    function minGradientStopOpacity(color) {
      var minOp = 100;
      try {
        if (color.typename === "GradientColor") {
          var stops = color.gradient.gradientStops;
          for (var gs = 0; gs < stops.length; gs++) {
            if (stops[gs].opacity < minOp) minOp = stops[gs].opacity;
          }
        }
      } catch(e) {}
      return minOp;
    }

    function isWhiteColor(color) {
      try {
        if (color.typename === "CMYKColor") {
          if (color.cyan === 0 && color.magenta === 0 && color.yellow === 0 && color.black === 0) return true;
        } else if (color.typename === "RGBColor") {
          if (color.red === 255 && color.green === 255 && color.blue === 255) return true;
        } else if (color.typename === "GrayColor") {
          // GrayColor.gray は 0=白, 100=黒（公式リファレンスの記載は逆。Illustrator 2026 で実機確認）
          if (color.gray === 0) return true;
        }
      } catch(e) {}
      return false;
    }

    // iterateAllItems は複合パス本体と内部パスの両方を訪問するため、
    // 内部パスは親の CompoundPathItem に寄せてサブパス数ぶんの重複報告を防ぐ
    function reportOwner(item) {
      try {
        if (item.typename === "PathItem" && item.parent && item.parent.typename === "CompoundPathItem") {
          return item.parent;
        }
      } catch(e) {}
      return item;
    }

    // 同一オブジェクト・同一カテゴリ・同一属性の重複報告を抑止して結果を追加する
    var reportedKeys = {};
    function pushItemResult(item, level, category, message, attribute, extra) {
      var owner = reportOwner(item);
      var uuid = ensureUUID(owner);
      var key = category + "|" + uuid + "|" + (attribute || "");
      if (reportedKeys[key]) return;
      reportedKeys[key] = true;
      var details = { name: "", layerName: "" };
      try { details.name = owner.name || ""; } catch(e) {}
      try { details.layerName = getParentLayerName(owner); } catch(e) {}
      if (attribute) details.attribute = attribute;
      if (extra) {
        for (var k in extra) details[k] = extra[k];
      }
      results.push({ level: level, category: category, message: message, uuid: uuid, details: details });
    }

    // 1. RGB color in CMYK document
    //    PathItem の塗り/線（グラデーション stop を含む）、埋め込み画像の色空間。
    //    テキストの文字色は 4. のテキスト走査でまとめて検査する
    var uninspected = { symbol: 0, pattern: 0, mesh: 0, plugin: 0, graph: 0, linked: 0 };
    function checkPaintRGB(item, color, attribute) {
      try {
        if (color.typename === "PatternColor") { uninspected.pattern++; return; }
      } catch(e) {}
      if (isRGBColor(color)) {
        pushItemResult(item, "error", "rgb_in_cmyk", "RGB " + attribute + " color detected in CMYK document", attribute);
      } else if (colorHasRGB(color)) {
        pushItemResult(item, "error", "rgb_in_cmyk", "Gradient " + attribute + " with RGB color stop detected in CMYK document", attribute, { colorType: "gradient" });
      }
    }
    if (isCMYKDoc) {
      setCoverage("rgb_in_cmyk", "checked");
      try {
        for (var layerIdx = 0; layerIdx < doc.layers.length; layerIdx++) {
          iterateAllItems(doc.layers[layerIdx], function(item) {
            try {
              var t = item.typename;
              if (t === "PathItem") {
                if (item.filled) checkPaintRGB(item, item.fillColor, "fill");
                if (item.stroked) checkPaintRGB(item, item.strokeColor, "stroke");
              } else if (t === "RasterItem") {
                if (item.imageColorSpace === ImageColorSpace.RGB) {
                  pushItemResult(item, "error", "rgb_in_cmyk", "RGB embedded image detected in CMYK document", "image");
                }
              } else if (t === "SymbolItem") {
                uninspected.symbol++;
              } else if (t === "MeshItem") {
                uninspected.mesh++;
              } else if (t === "PluginItem") {
                uninspected.plugin++;
              } else if (t === "GraphItem") {
                uninspected.graph++;
              } else if (t === "PlacedItem") {
                uninspected.linked++;
              }
            } catch(e) { countInspectError("rgb_in_cmyk"); }
          });
        }
      } catch(e) {
        setCoverage("rgb_in_cmyk", "skipped", "Check failed: " + e.message);
      }
    } else {
      setCoverage("rgb_in_cmyk", "not_applicable", "Document color mode is RGB.");
    }

    // 2. Broken links — placedItems
    setCoverage("broken_link", "checked");
    try {
      for (var pi = 0; pi < doc.placedItems.length; pi++) {
        var placed = doc.placedItems[pi];
        try {
          var f = placed.file;
          if (!f.exists) {
            var uuid3 = ensureUUID(placed);
            results.push({
              level: "error",
              category: "broken_link",
              message: "Broken link detected",
              uuid: uuid3,
              details: { name: placed.name || "", filePath: f.fsName }
            });
          }
        } catch(e) {
          var uuid3b = ensureUUID(placed);
          results.push({
            level: "error",
            category: "broken_link",
            message: "Cannot access linked file",
            uuid: uuid3b,
            details: { name: placed.name || "" }
          });
        }
      }
    } catch(e) {
      setCoverage("broken_link", "skipped", "Check failed: " + e.message);
    }

    // 3. Low resolution images (embedded raster)
    setCoverage("low_resolution", "checked");
    var unmeasuredRasters = 0;
    try {
      for (var ri = 0; ri < doc.rasterItems.length; ri++) {
        var raster = doc.rasterItems[ri];
        var measured = false;
        try {
          var bounds = raster.geometricBounds;
          var widthPt = bounds[2] - bounds[0];
          var heightPt = bounds[3] - bounds[1];
          if (widthPt < 0) widthPt = -widthPt;
          if (heightPt < 0) heightPt = -heightPt;

          var m = raster.matrix;
          if (m && widthPt > 0 && heightPt > 0) {
            var sX = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
            var sY = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
            if (sX > 0 && sY > 0) {
              measured = true;
              // 実効解像度 = 72 / (1px あたりの pt)。回転していても基底ベクトルの長さで求まる
              var ppiH = Math.round(72 / sX);
              var ppiV = Math.round(72 / sY);
              var effectivePPI = Math.min(ppiH, ppiV);
              if (effectivePPI < minDPI) {
                var uuid4 = ensureUUID(raster);
                // 外接矩形を割るだけだと回転時にピクセル数を誤るため行列から解く（解けなければ null）
                var px = pixelSizeFromMatrix(m, widthPt, heightPt);
                results.push({
                  level: "error",
                  category: "low_resolution",
                  message: "Embedded image resolution " + effectivePPI + " DPI is below minimum " + minDPI + " DPI",
                  uuid: uuid4,
                  details: { name: raster.name || "", effectivePPI: effectivePPI, minDPI: minDPI, pixelWidth: px ? px.width : null, pixelHeight: px ? px.height : null }
                });
              }
            }
          }
        } catch(e) {}
        if (!measured) unmeasuredRasters++;
      }
    } catch(e) {
      setCoverage("low_resolution", "skipped", "Check failed: " + e.message);
    }
    if (unmeasuredRasters > 0) {
      markPartial("low_resolution", unmeasuredRasters + " embedded image(s) could not be measured.");
    }

    // 3b. Collect linked image data for Node.js-side DPI check
    var placedImageData = [];
    try {
      for (var pli = 0; pli < doc.placedItems.length; pli++) {
        var pItem = doc.placedItems[pli];
        try {
          var pFile = pItem.file;
          if (pFile && pFile.exists) {
            var pUuid = ensureUUID(pItem);
            var pData = {
              uuid: pUuid,
              name: pItem.name || "",
              filePath: pFile.fsName,
              widthPt: 0,
              heightPt: 0,
              matrixScaleX: 0,
              matrixScaleY: 0
            };
            try {
              var plm = pItem.matrix;
              if (plm) {
                pData.matrixScaleX = Math.sqrt(plm.mValueA * plm.mValueA + plm.mValueB * plm.mValueB);
                pData.matrixScaleY = Math.sqrt(plm.mValueC * plm.mValueC + plm.mValueD * plm.mValueD);
              }
            } catch(e2) {}
            // Fallback: geometricBounds
            var pBounds = pItem.geometricBounds;
            var pWPt = pBounds[2] - pBounds[0];
            var pHPt = -(pBounds[3] - pBounds[1]);
            if (pWPt < 0) pWPt = -pWPt;
            if (pHPt < 0) pHPt = -pHPt;
            pData.widthPt = pWPt;
            pData.heightPt = pHPt;
            placedImageData.push(pData);
          }
        } catch(e) {}
      }
    } catch(e) {
      markPartial("low_resolution", "Linked images could not be enumerated: " + e.message);
    }

    // 4. テキスト走査（1パス）: 非アウトライン文字 / 使用フォント / 文字の塗り・線の RGB
    //    4b. Missing fonts — 使用フォントをインストール済みフォント (app.textFonts) と照合
    //    getByName() は未インストールのフォント名で例外を投げることを利用する
    setCoverage("non_outlined_text", "checked");
    setCoverage("missing_font", "checked");
    var usedFonts = {}; // フォント名 → 最初に使用しているテキストフレームのUUID
    var sampledTextFrames = 0;
    try {
      for (var tf = 0; tf < doc.textFrames.length; tf++) {
        var textFrame = doc.textFrames[tf];
        var frameUuid = "";
        try {
          frameUuid = ensureUUID(textFrame);
          var fontName = "";
          var tRanges = textFrame.textRanges;
          var tLen = tRanges.length;
          var tStep = tLen > TEXT_SAMPLE_LIMIT ? Math.ceil(tLen / TEXT_SAMPLE_LIMIT) : 1;
          if (tStep > 1) sampledTextFrames++;
          var rgbFill = false;
          var rgbStroke = false;
          for (var tc = 0; tc < tLen; tc += tStep) {
            try {
              var ca = tRanges[tc].characterAttributes;
              try {
                var tFont = ca.textFont;
                if (tFont && tFont.name) {
                  if (!fontName) fontName = tFont.name;
                  if (!usedFonts[tFont.name]) usedFonts[tFont.name] = frameUuid;
                }
              } catch(eFont) { countInspectError("missing_font"); }
              if (isCMYKDoc) {
                if (!rgbFill && colorHasRGB(ca.fillColor)) rgbFill = true;
                if (!rgbStroke && colorHasRGB(ca.strokeColor)) rgbStroke = true;
              }
            } catch(eChar) { countInspectError("missing_font"); }
          }
          if (rgbFill) {
            pushItemResult(textFrame, "error", "rgb_in_cmyk", "RGB text fill color detected in CMYK document", "text_fill");
          }
          if (rgbStroke) {
            pushItemResult(textFrame, "error", "rgb_in_cmyk", "RGB text stroke color detected in CMYK document", "text_stroke");
          }
          var contents = "";
          try { contents = textFrame.contents.substring(0, 50); } catch(eC) {}
          results.push({
            level: "warning",
            category: "non_outlined_text",
            message: "Non-outlined text detected",
            uuid: frameUuid,
            details: { name: textFrame.name || "", contents: contents, font: fontName }
          });
        } catch(e) {
          countInspectError("missing_font");
          if (isCMYKDoc) countInspectError("rgb_in_cmyk");
        }
      }
      for (var fontKey in usedFonts) {
        var isInstalled = true;
        try { app.textFonts.getByName(fontKey); } catch (eGet) { isInstalled = false; }
        if (!isInstalled) {
          results.push({
            level: "error",
            category: "missing_font",
            message: "Font is not installed on this system: " + fontKey,
            uuid: usedFonts[fontKey],
            details: { font: fontKey }
          });
        }
      }
    } catch(e) {
      setCoverage("non_outlined_text", "skipped", "Check failed: " + e.message);
      setCoverage("missing_font", "skipped", "Check failed: " + e.message);
      if (isCMYKDoc) markPartial("rgb_in_cmyk", "Text colors were not checked: " + e.message);
    }
    if (sampledTextFrames > 0) {
      var sampleNote = sampledTextFrames + " text frame(s) longer than " + TEXT_SAMPLE_LIMIT +
        " characters were sampled (not every character was inspected).";
      markPartial("missing_font", sampleNote);
      if (isCMYKDoc) markPartial("rgb_in_cmyk", sampleNote);
    }

    // RGB 検査で中身を見られなかったオブジェクトを記録する
    if (isCMYKDoc) {
      var uninspectedParts = [];
      if (uninspected.linked > 0) uninspectedParts.push(uninspected.linked + " linked file(s) (color space not readable via scripting)");
      if (uninspected.symbol > 0) uninspectedParts.push(uninspected.symbol + " symbol instance(s)");
      if (uninspected.pattern > 0) uninspectedParts.push(uninspected.pattern + " pattern fill/stroke(s)");
      if (uninspected.mesh > 0) uninspectedParts.push(uninspected.mesh + " gradient mesh(es)");
      if (uninspected.plugin > 0) uninspectedParts.push(uninspected.plugin + " plugin item(s) (blends, envelopes, etc.)");
      if (uninspected.graph > 0) uninspectedParts.push(uninspected.graph + " graph(s)");
      if (uninspectedParts.length > 0) {
        markPartial("rgb_in_cmyk", "Contents not inspected: " + uninspectedParts.join(", ") + ".");
      }
    }

    // 5. White overprint
    setCoverage("white_overprint", "checked");
    try {
      for (var layerIdx2 = 0; layerIdx2 < doc.layers.length; layerIdx2++) {
        iterateAllItems(doc.layers[layerIdx2], function(item) {
          if (item.typename !== "PathItem") return;
          try {
            var hasFillOP = false;
            var hasStrokeOP = false;
            try { hasFillOP = item.fillOverprint; } catch(e2) {}
            try { hasStrokeOP = item.strokeOverprint; } catch(e2) {}

            if (hasFillOP && item.filled && isWhiteColor(item.fillColor)) {
              pushItemResult(item, "error", "white_overprint", "White fill has overprint enabled (may disappear when printed)", "fill");
            }
            if (hasStrokeOP && item.stroked && isWhiteColor(item.strokeColor)) {
              pushItemResult(item, "error", "white_overprint", "White stroke has overprint enabled (may disappear when printed)", "stroke");
            }
          } catch(e) { countInspectError("white_overprint"); }
        });
      }
    } catch(e) {
      setCoverage("white_overprint", "skipped", "Check failed: " + e.message);
    }

    // 6. Bleed — cannot check via API
    results.push({
      level: "info",
      category: "bleed",
      message: "Bleed settings cannot be verified via API. Please check manually.",
      uuid: null,
      details: {}
    });

    // 7. Spot colors
    setCoverage("spot_color", "checked");
    try {
      if (doc.spots.length > 1) {
        // spots[0] is always the default registration color
        for (var si = 1; si < doc.spots.length; si++) {
          var spot = doc.spots[si];
          try {
            results.push({
              level: "warning",
              category: "spot_color",
              message: "Spot color in use: " + spot.name,
              uuid: null,
              details: { spotName: spot.name, colorType: spot.spotKind.toString() }
            });
          } catch(e) { countInspectError("spot_color"); }
        }
      }
    } catch(e) {
      setCoverage("spot_color", "skipped", "Check failed: " + e.message);
    }

    // 8. Transparency
    //    オブジェクトの opacity / blendingMode、グラデーション stop の不透明度、透明部分を持つ埋め込み画像。
    //    ドロップシャドウ・光彩などのライブエフェクトはスクリプトから参照できない（Node 側で coverage に記録）
    setCoverage("transparency", "checked");
    try {
      for (var layerIdx3 = 0; layerIdx3 < doc.layers.length; layerIdx3++) {
        iterateAllItems(doc.layers[layerIdx3], function(item) {
          try {
            var reasons = [];
            var isInnerPath = (reportOwner(item) !== item);
            // 複合パス内部のパスの不透明度・描画モードは本体（CompoundPathItem）側で判定する
            if (!isInnerPath) {
              try {
                if (item.opacity < 100) reasons.push("opacity: " + item.opacity + "%");
              } catch(e2) {}
              try {
                if (item.blendingMode !== BlendModes.NORMAL) reasons.push("blendingMode: " + item.blendingMode);
              } catch(e2) {}
            }
            if (item.typename === "PathItem") {
              var fillStopOp = item.filled ? minGradientStopOpacity(item.fillColor) : 100;
              var strokeStopOp = item.stroked ? minGradientStopOpacity(item.strokeColor) : 100;
              if (fillStopOp < 100) reasons.push("gradient stop opacity (fill): " + fillStopOp + "%");
              if (strokeStopOp < 100) reasons.push("gradient stop opacity (stroke): " + strokeStopOp + "%");
            } else if (item.typename === "RasterItem") {
              try {
                if (item.transparent) reasons.push("image has transparent areas");
              } catch(e2) {}
            }
            if (reasons.length === 0) return;

            var reason = reasons.join(", ");
            pushItemResult(item, "warning", "transparency", "Transparency effect in use", "", { reason: reason });

            // 9. Transparency + overprint interaction / 10. Spot color + opacity interaction
            // 塗り・オーバープリント属性は PathItem が持つ（複合パスは内部パスが持つ）
            var paintPath = null;
            if (item.typename === "PathItem") {
              paintPath = item;
            } else if (item.typename === "CompoundPathItem" && item.pathItems.length > 0) {
              paintPath = item.pathItems[0];
            }
            if (paintPath) {
              var hasFillOPTrans = false;
              var hasStrokeOPTrans = false;
              try { hasFillOPTrans = paintPath.fillOverprint; } catch(e4) {}
              try { hasStrokeOPTrans = paintPath.strokeOverprint; } catch(e4) {}
              if (hasFillOPTrans || hasStrokeOPTrans) {
                pushItemResult(item, "error", "transparency_overprint_interaction",
                  "Transparency + overprint on same object (unpredictable print result)", "",
                  { reason: reason + " + overprint" });
              }
              try {
                var ownerOpacity = reportOwner(item).opacity;
                if (paintPath.filled && paintPath.fillColor.typename === "SpotColor" && ownerOpacity < 100) {
                  pushItemResult(item, "warning", "spot_transparency",
                    "Spot color with transparency (may convert to process color unexpectedly)", "",
                    { spotName: paintPath.fillColor.spot.name, opacity: ownerOpacity });
                }
              } catch(e4) {}
            }
          } catch(e) { countInspectError("transparency"); }
        });
      }
    } catch(e) {
      setCoverage("transparency", "skipped", "Check failed: " + e.message);
    }

    // オブジェクト単位の例外件数を coverage に反映する
    for (var errKey in inspectErrors) {
      markPartial(errKey, inspectErrors[errKey] + " object(s) could not be inspected (scripting error).");
    }

    // Collect summary counts for PDF/X compliance (processed in Node.js)
    var hasRGBItems = false;
    var hasTransparencyItems = false;
    var hasSpotColors = false;
    try { hasSpotColors = (doc.spots.length > 1); } catch(e9) {}
    var colorProfileName = "";
    try { colorProfileName = doc.colorProfileName || ""; } catch(e9) {}
    for (var ri2 = 0; ri2 < results.length; ri2++) {
      if (results[ri2].category === "rgb_in_cmyk") hasRGBItems = true;
      if (results[ri2].category === "transparency") hasTransparencyItems = true;
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      documentColorSpace: isCMYKDoc ? "CMYK" : "RGB",
      checkCount: results.length,
      results: results,
      coverage: coverage,
      placedImageData: placedImageData,
      minDPI: minDPI,
      targetPdfProfile: targetPdfProfile,
      pdfxSummary: {
        hasRGBItems: hasRGBItems,
        hasTransparencyItems: hasTransparencyItems,
        hasSpotColors: hasSpotColors,
        colorProfileName: colorProfileName,
        isCMYKDoc: isCMYKDoc
      }
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

/** 1カテゴリあたりに個別で返す結果の上限。超過分は件数と UUID をまとめた1件に集約する */
export const MAX_RESULTS_PER_CATEGORY = 20;
/** 集約エントリに載せる UUID の上限 */
const MAX_OMITTED_UUIDS = 100;

type CoverageStatus = 'checked' | 'partial' | 'skipped' | 'not_applicable';

export interface PreflightEntry {
  level: string;
  category: string;
  message: string;
  uuid: string | null;
  details: Record<string, unknown>;
}

export interface PreflightRawResult {
  checkCount: number;
  results: PreflightEntry[];
  coverage?: Record<string, { status: CoverageStatus; note?: string }>;
  placedImageData?: Array<{
    uuid: string;
    name: string;
    filePath: string;
    widthPt: number;
    heightPt: number;
    matrixScaleX: number;
    matrixScaleY: number;
  }>;
  minDPI?: number;
  targetPdfProfile?: string | null;
  pdfxSummary?: {
    hasRGBItems: boolean;
    hasTransparencyItems: boolean;
    hasSpotColors: boolean;
    colorProfileName: string;
    isCMYKDoc: boolean;
  };
  [key: string]: unknown;
}

const LEVEL_RANK: Record<string, number> = { error: 3, warning: 2, info: 1 };

function markPartial(
  coverage: NonNullable<PreflightRawResult['coverage']>,
  key: string,
  note: string,
): void {
  const c = coverage[key];
  if (!c) {
    coverage[key] = { status: 'partial', note };
    return;
  }
  if (c.status === 'checked') c.status = 'partial';
  c.note = c.note ? `${c.note} ${note}` : note;
}

/**
 * 同一カテゴリの結果が多いときに先頭 N 件だけ残し、残りを件数付きの1件に集約する。
 * SVG 取り込みなどで数千オブジェクトが同じ問題を持つと出力が肥大化するため
 */
function capResultsPerCategory(results: PreflightEntry[]): {
  results: PreflightEntry[];
  categoryCounts: Record<string, number>;
  truncated: boolean;
} {
  const categoryCounts: Record<string, number> = {};
  const kept: PreflightEntry[] = [];
  const omitted: Record<string, PreflightEntry[]> = {};
  for (const r of results) {
    const n = (categoryCounts[r.category] ?? 0) + 1;
    categoryCounts[r.category] = n;
    if (n <= MAX_RESULTS_PER_CATEGORY) {
      kept.push(r);
    } else {
      (omitted[r.category] ??= []).push(r);
    }
  }
  let truncated = false;
  for (const [category, entries] of Object.entries(omitted)) {
    truncated = true;
    const level = entries.reduce(
      (lv, e) => ((LEVEL_RANK[e.level] ?? 0) > (LEVEL_RANK[lv] ?? 0) ? e.level : lv),
      'info',
    );
    const uuids = [...new Set(entries.map((e) => e.uuid).filter((u): u is string => !!u))];
    kept.push({
      level,
      category,
      message: `${entries.length} more "${category}" result(s) omitted (${categoryCounts[category]} total)`,
      uuid: null,
      details: {
        omittedCount: entries.length,
        totalCount: categoryCounts[category],
        omittedUuids: uuids.slice(0, MAX_OMITTED_UUIDS),
        ...(uuids.length > MAX_OMITTED_UUIDS ? { omittedUuidsTruncated: true } : {}),
      },
    });
  }
  return { results: kept, categoryCounts, truncated };
}

/**
 * JSX の生結果を最終レスポンスに整える（リンク画像の解像度・PDF/X 判定・件数集約・結論メモ）。
 * 単体テストのため handler から分離している
 */
export function postProcessPreflightResult(
  result: PreflightRawResult,
  fallbackMinDpi: number,
): Record<string, unknown> {
  const coverage = (result.coverage ??= {});

  // Post-process: check PlacedItem DPI using Node.js file reading
  const minDpi = result.minDPI ?? fallbackMinDpi;
  const unmeasured: string[] = [];
  for (const placed of result.placedImageData ?? []) {
    if (!placed.filePath) {
      unmeasured.push(placed.name || placed.uuid);
      continue;
    }
    try {
      const dims = readImageDimensions(placed.filePath);
      if (!dims) {
        unmeasured.push(placed.filePath);
        continue;
      }
      let effectivePPI: number;
      // 行列スケール = 1px あたりの pt（回転しても基底ベクトル長で正しく求まる）
      if (placed.matrixScaleX > 0 && placed.matrixScaleY > 0) {
        const ppiH = Math.round(72 / placed.matrixScaleX);
        const ppiV = Math.round(72 / placed.matrixScaleY);
        effectivePPI = Math.min(ppiH, ppiV);
      } else if (placed.widthPt > 0 && placed.heightPt > 0) {
        // Fallback to geometricBounds (inaccurate for rotated images)
        const widthInches = placed.widthPt / 72;
        const heightInches = placed.heightPt / 72;
        const ppiH = Math.round(dims.width / widthInches);
        const ppiV = Math.round(dims.height / heightInches);
        effectivePPI = Math.min(ppiH, ppiV);
      } else {
        unmeasured.push(placed.filePath);
        continue;
      }
      if (effectivePPI < minDpi) {
        result.results.push({
          level: 'error',
          category: 'low_resolution',
          message: `Linked image resolution ${effectivePPI} DPI is below minimum ${minDpi} DPI`,
          uuid: placed.uuid,
          details: {
            name: placed.name,
            effectivePPI,
            minDPI: minDpi,
            pixelWidth: dims.width,
            pixelHeight: dims.height,
            filePath: placed.filePath,
          },
        });
      }
    } catch {
      unmeasured.push(placed.filePath);
    }
  }
  if (unmeasured.length > 0) {
    const shown = unmeasured.slice(0, 10).join(', ');
    const more = unmeasured.length > 10 ? ` and ${unmeasured.length - 10} more` : '';
    markPartial(
      coverage,
      'low_resolution',
      `${unmeasured.length} linked file(s) could not be measured (unsupported format such as PDF/AI/EPS, or unreadable): ${shown}${more}.`,
    );
  }
  delete result.placedImageData;
  delete result.minDPI;

  // PDF/X compliance checks (Node.js side)
  const targetProfile = result.targetPdfProfile;
  const pdfxSummary = result.pdfxSummary;
  const liveEffectNote =
    'Live effects (drop shadow, glow, feather, etc.) and extra appearance fills/strokes are not visible to scripting.';

  if (targetProfile && pdfxSummary) {
    if (targetProfile === 'x1a') {
      if (pdfxSummary.hasTransparencyItems) {
        result.results.push({
          level: 'error',
          category: 'pdfx_compliance',
          message: 'PDF/X-1a does not allow transparency. Flatten all transparency before export.',
          uuid: null,
          details: { profile: 'x1a' },
        });
      }
      // PDF/X-1a ではライブエフェクト由来の透明も違反になるため、検出できない以上「検査済み」とは言えない
      markPartial(coverage, 'transparency', `${liveEffectNote} Check Window > Flattener Preview before exporting PDF/X-1a.`);
      if (pdfxSummary.hasRGBItems || !pdfxSummary.isCMYKDoc) {
        result.results.push({
          level: 'error',
          category: 'pdfx_compliance',
          message: 'PDF/X-1a requires all colors in CMYK or spot. RGB colors detected.',
          uuid: null,
          details: { profile: 'x1a' },
        });
      }
      // ライブテキスト自体は違反ではない（書き出し時にフォントは埋め込まれる）。
      // 埋め込めないのは未インストールのフォントなので、それだけを違反として扱う
      const missingFonts = result.results.filter((r) => r.category === 'missing_font');
      if (missingFonts.length > 0) {
        result.results.push({
          level: 'error',
          category: 'pdfx_compliance',
          message: `PDF/X-1a requires all fonts embedded. ${missingFonts.length} font(s) are not installed and cannot be embedded.`,
          uuid: null,
          details: { profile: 'x1a', fonts: missingFonts.map((r) => r.details.font) },
        });
      }
    } else if (targetProfile === 'x4') {
      if (pdfxSummary.hasRGBItems && pdfxSummary.isCMYKDoc) {
        result.results.push({
          level: 'warning',
          category: 'pdfx_compliance',
          message: 'PDF/X-4 allows RGB but mixed color spaces may cause conversion issues.',
          uuid: null,
          details: { profile: 'x4' },
        });
      }
      if (!pdfxSummary.colorProfileName) {
        result.results.push({
          level: 'warning',
          category: 'pdfx_compliance',
          message: 'PDF/X-4 recommends an ICC color profile. No profile detected.',
          uuid: null,
          details: { profile: 'x4' },
        });
      }
    }
  }
  if (coverage.transparency && coverage.transparency.status === 'checked' && !coverage.transparency.note) {
    coverage.transparency.note = liveEffectNote;
  }

  delete result.targetPdfProfile;
  delete result.pdfxSummary;

  const hasIssues = result.results.some((r) => r.level === 'error' || r.level === 'warning');
  const incomplete = Object.entries(coverage)
    .filter(([, c]) => c.status === 'partial' || c.status === 'skipped')
    .map(([k]) => k);

  const capped = capResultsPerCategory(result.results);
  const out: Record<string, unknown> = {
    ...result,
    // checkCount は集約前の検出件数（results は集約後）
    checkCount: result.results.length,
    results: capped.results,
    categoryCounts: capped.categoryCounts,
    coverage,
  };
  if (capped.truncated) out.truncated = true;

  // 「問題なし」は全検査を実際に完了したときだけ言い切る
  if (!hasIssues) {
    out._note = incomplete.length === 0
      ? 'No issues detected by these automated checks. This does not mean the document is free of problems — items outside the scope of automated checks (live effects, design intent, contextual spelling, regulatory requirements, print-shop-specific rules) still require human review.'
      : `No errors or warnings were found, but these checks were incomplete: ${incomplete.join(', ')} (see coverage). This is NOT a clean result — review the uninspected parts manually.`;
  }
  return out;
}

export function register(server: McpServer): void {
  server.registerTool(
    'preflight_check',
    {
      title: 'Preflight Check',
      description:
        'Run pre-press quality checks (RGB in CMYK incl. gradient stops, text colors and embedded images; broken links; low resolution; fonts; white overprint; transparency; spot colors). ' +
        '`coverage` reports per check whether it was fully checked, partial (sampled or uninspectable contents such as symbols, linked files, live effects under x1a) or skipped — a check marked partial/skipped is not a clean pass. ' +
        `Results are capped at ${MAX_RESULTS_PER_CATEGORY} per category; the rest are summarized in one entry with counts and UUIDs (\`categoryCounts\` has totals). ` +
        'Not exhaustive — does not replace a human final review. GrayColor uses ink-quantity interpretation (0=white/no ink, 100=black/full ink), which differs from the API reference.',
      inputSchema: {
        coordinate_system: coordinateSystemSchema,
        min_dpi: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(300)
          .describe('Minimum acceptable DPI for images (default: 300)'),
        target_pdf_profile: z
          .enum(['x1a', 'x4'])
          .optional()
          .describe('Target PDF/X profile for compliance checks. x1a: no transparency/RGB, fonts must be embeddable (installed). x4: allows transparency, recommends ICC profile.'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      // 全文字の色・フォント走査を含むため重い処理用のタイムアウトで実行する
      const result = (await executeJsxHeavy(jsxCode, resolvedParams)) as PreflightRawResult;
      if (!result || result.error || !Array.isArray(result.results)) {
        return formatToolResult(result);
      }
      return formatToolResult(postProcessPreflightResult(result, params.min_dpi ?? 300));
    },
  );
}
