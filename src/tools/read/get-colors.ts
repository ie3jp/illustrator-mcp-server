import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_colors — ドキュメントの色情報取得（スウォッチ・グラデーション・パターン・スポットカラー）
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Swatches/ — Swatches collection
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Gradient/ — Gradient, GradientStop
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Spot/ — Spot color
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Pattern/ — Pattern
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var includeSwatches = (params && typeof params.include_swatches === "boolean") ? params.include_swatches : true;
    var includeUsedColors = (params && typeof params.include_used_colors === "boolean") ? params.include_used_colors : true;
    var includeDiagnostics = (params && typeof params.include_diagnostics === "boolean") ? params.include_diagnostics : false;
    var isCMYKDoc = (doc.documentColorSpace === DocumentColorSpace.CMYK);

    var result = {};

    // スウォッチ一覧
    if (includeSwatches) {
      var swatches = [];
      for (var si = 0; si < doc.swatches.length; si++) {
        var sw = doc.swatches[si];
        var swInfo = {
          name: sw.name,
          color: colorToObject(sw.color)
        };
        swatches.push(swInfo);
      }
      result.swatches = swatches;
    }

    // グラデーション一覧
    var gradients = [];
    for (var gi = 0; gi < doc.gradients.length; gi++) {
      var grad = doc.gradients[gi];
      var gradType = "unknown";
      try {
        if (grad.type === GradientType.LINEAR) gradType = "linear";
        else if (grad.type === GradientType.RADIAL) gradType = "radial";
        else gradType = grad.type.toString();
      } catch (e) {}

      var stops = [];
      for (var gsi = 0; gsi < grad.gradientStops.length; gsi++) {
        var gs = grad.gradientStops[gsi];
        var stopInfo = {
          rampPoint: gs.rampPoint,
          midPoint: gs.midPoint,
          color: colorToObject(gs.color)
        };
        try { stopInfo.opacity = gs.opacity; } catch (e) { stopInfo.opacity = 100; }
        stops.push(stopInfo);
      }

      gradients.push({
        name: grad.name,
        type: gradType,
        stops: stops
      });
    }
    result.gradients = gradients;

    // グラデーション色空間診断
    if (includeDiagnostics && isCMYKDoc) {
      var gradientWarnings = [];
      for (var gwi = 0; gwi < gradients.length; gwi++) {
        var gw = gradients[gwi];
        for (var gwsi = 0; gwsi < gw.stops.length; gwsi++) {
          if (gw.stops[gwsi].color && gw.stops[gwsi].color.type === "rgb") {
            gradientWarnings.push({
              gradientName: gw.name,
              stopIndex: gwsi,
              message: "RGB color stop in CMYK document gradient"
            });
          }
        }
      }
      result.gradientWarnings = gradientWarnings;
    }

    // パターン一覧
    var patterns = [];
    for (var pi = 0; pi < doc.patterns.length; pi++) {
      patterns.push({
        name: doc.patterns[pi].name
      });
    }
    result.patterns = patterns;

    // 特色（スポットカラー）一覧
    var spots = [];
    for (var spi = 0; spi < doc.spots.length; spi++) {
      var spot = doc.spots[spi];
      var spotInfo = {
        name: spot.name
      };
      try { spotInfo.color = colorToObject(spot.color); } catch (e) { spotInfo.color = { type: "unknown" }; }
      try {
        var st = spot.spotKind;
        if (st === SpotColorKind.SpotCMYK) spotInfo.spotKind = "CMYK";
        else if (st === SpotColorKind.SpotRGB) spotInfo.spotKind = "RGB";
        else if (st === SpotColorKind.SpotLAB) spotInfo.spotKind = "LAB";
        else spotInfo.spotKind = st.toString();
      } catch (e) { spotInfo.spotKind = "unknown"; }
      spots.push(spotInfo);
    }
    result.spots = spots;

    // 使用色の収集とメッシュ検出（1パスで diagnostics も同時集計）
    if (includeUsedColors) {
      var usedFills = [];
      var usedStrokes = [];
      var meshItems = [];
      var spotUsageCount = {};
      var rgbInCmyk = 0;
      var cmykInRgb = 0;

      for (var ii = 0; ii < doc.pathItems.length; ii++) {
        var item = doc.pathItems[ii];

        try {
          if (item.filled) {
            var fc = colorToObject(item.fillColor);
            if (includeDiagnostics && fc.type === "cmyk") {
              fc.inkCoverage = fc.c + fc.m + fc.y + fc.k;
            }
            if (includeDiagnostics) {
              if (isCMYKDoc && fc.type === "rgb") rgbInCmyk++;
              if (!isCMYKDoc && fc.type === "cmyk") cmykInRgb++;
            }
            usedFills.push(fc);
            if (fc.type === "spot") {
              var spName = fc.name;
              if (spotUsageCount[spName] === undefined) spotUsageCount[spName] = 0;
              spotUsageCount[spName] = spotUsageCount[spName] + 1;
            }
          }
        } catch (e) {}
        try {
          if (item.stroked) {
            var sc = colorToObject(item.strokeColor);
            if (includeDiagnostics && sc.type === "cmyk") {
              sc.inkCoverage = sc.c + sc.m + sc.y + sc.k;
            }
            if (includeDiagnostics) {
              if (isCMYKDoc && sc.type === "rgb") rgbInCmyk++;
              if (!isCMYKDoc && sc.type === "cmyk") cmykInRgb++;
            }
            usedStrokes.push(sc);
            if (sc.type === "spot") {
              var spName2 = sc.name;
              if (spotUsageCount[spName2] === undefined) spotUsageCount[spName2] = 0;
              spotUsageCount[spName2] = spotUsageCount[spName2] + 1;
            }
          }
        } catch (e) {}
      }

      // テキストフレームの文字色を収集
      for (var ti = 0; ti < doc.textFrames.length; ti++) {
        try {
          var tfItem = doc.textFrames[ti];
          for (var ci = 0; ci < tfItem.textRanges.length; ci++) {
            var ca = tfItem.textRanges[ci].characterAttributes;
            try {
              var tfc = colorToObject(ca.fillColor);
              if (includeDiagnostics && tfc.type === "cmyk") {
                tfc.inkCoverage = tfc.c + tfc.m + tfc.y + tfc.k;
              }
              if (includeDiagnostics) {
                if (isCMYKDoc && tfc.type === "rgb") rgbInCmyk++;
                if (!isCMYKDoc && tfc.type === "cmyk") cmykInRgb++;
              }
              usedFills.push(tfc);
              if (tfc.type === "spot") {
                var tSpName = tfc.name;
                if (spotUsageCount[tSpName] === undefined) spotUsageCount[tSpName] = 0;
                spotUsageCount[tSpName] = spotUsageCount[tSpName] + 1;
              }
            } catch (e3) {}
            try {
              if (ca.strokeWeight > 0) {
                var tsc = colorToObject(ca.strokeColor);
                usedStrokes.push(tsc);
              }
            } catch (e4) {}
          }
        } catch (e5) {}
      }

      // メッシュアイテム検出 (document-wide)
      for (var mi = 0; mi < doc.meshItems.length; mi++) {
        meshItems.push(ensureUUID(doc.meshItems[mi]));
      }

      // 特色使用箇所数を spots に追加
      for (var sci = 0; sci < spots.length; sci++) {
        var count = spotUsageCount[spots[sci].name];
        spots[sci].usageCount = (count !== undefined) ? count : 0;
      }

      if (includeDiagnostics) {
        result.colorModelWarnings = {
          documentColorSpace: isCMYKDoc ? "CMYK" : "RGB",
          rgbColorsInCmykDoc: rgbInCmyk,
          cmykColorsInRgbDoc: cmykInRgb
        };
      }

      result.usedFillColors = usedFills;
      result.usedStrokeColors = usedStrokes;
      result.meshGradient = {
        hasMesh: meshItems.length > 0,
        meshItemUUIDs: meshItems
      };
    }

    writeResultFile(RESULT_PATH, result);
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to get color information: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_colors',
    {
      title: 'Get Colors',
      description: 'Get all color information used in the document',
      inputSchema: {
        include_swatches: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include swatch list'),
        include_used_colors: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include used color collection'),
        include_diagnostics: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include print diagnostics: gradient color space validation, ink coverage per color, color model mismatch warnings'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
