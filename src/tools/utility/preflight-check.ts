import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
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
 *
 * 既知の問題: isWhiteColor の GrayColor 判定 (gray===100) は
 * リファレンス記載（0=黒, 100=白）に基づくが、check-contrast.ts 等の変換式と矛盾あり。要検証。
 */
const jsxCode = `
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

    // Helper: check if a color is RGB type
    function isRGBColor(color) {
      try {
        if (color.typename === "RGBColor") return true;
      } catch(e) {}
      return false;
    }

    // Helper: check if color is white
    function isWhiteColor(color) {
      try {
        if (color.typename === "CMYKColor") {
          if (color.cyan === 0 && color.magenta === 0 && color.yellow === 0 && color.black === 0) return true;
        } else if (color.typename === "RGBColor") {
          if (color.red === 255 && color.green === 255 && color.blue === 255) return true;
        } else if (color.typename === "GrayColor") {
          // GrayColor.gray はインク量: 0=白(インクなし), 100=黒(フルインク)
          // E2Eテストで確認済み。リファレンスの "0=black, 100=white" 記載は誤り。
          if (color.gray === 0) return true;
        }
      } catch(e) {}
      return false;
    }

    // 1. RGB color in CMYK document
    if (isCMYKDoc) {
      for (var layerIdx = 0; layerIdx < doc.layers.length; layerIdx++) {
        iterateAllItems(doc.layers[layerIdx], function(item) {
          if (item.typename === "PathItem") {
            try {
              if (item.filled && isRGBColor(item.fillColor)) {
                var uuid = ensureUUID(item);
                results.push({
                  level: "error",
                  category: "rgb_in_cmyk",
                  message: "RGB fill color detected in CMYK document",
                  uuid: uuid,
                  details: { name: item.name || "", layerName: getParentLayerName(item), attribute: "fill" }
                });
              }
            } catch(e) {}
            try {
              if (item.stroked && isRGBColor(item.strokeColor)) {
                var uuid2 = ensureUUID(item);
                results.push({
                  level: "error",
                  category: "rgb_in_cmyk",
                  message: "RGB stroke color detected in CMYK document",
                  uuid: uuid2,
                  details: { name: item.name || "", layerName: getParentLayerName(item), attribute: "stroke" }
                });
              }
            } catch(e) {}
          }
        });
      }
    }

    // 2. Broken links — placedItems
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
    } catch(e) {}

    // 3. Low resolution images (embedded raster)
    try {
      for (var ri = 0; ri < doc.rasterItems.length; ri++) {
        var raster = doc.rasterItems[ri];
        try {
          var bounds = raster.geometricBounds;
          var widthPt = bounds[2] - bounds[0];
          var heightPt = bounds[3] - bounds[1];
          if (widthPt < 0) widthPt = -widthPt;
          if (heightPt < 0) heightPt = -heightPt;

          try {
            var m = raster.matrix;
            if (m && widthPt > 0 && heightPt > 0) {
              // Use vector magnitude to handle rotation correctly
              var sX = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
              var sY = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
              if (sX > 0 && sY > 0) {
                var pxW = Math.round(widthPt / sX);
                var pxH = Math.round(heightPt / sY);
                var ppiH = Math.round(pxW / (widthPt / 72));
                var ppiV = Math.round(pxH / (heightPt / 72));
                var effectivePPI = Math.min(ppiH, ppiV);
                if (effectivePPI < minDPI) {
                  var uuid4 = ensureUUID(raster);
                  results.push({
                    level: "error",
                    category: "low_resolution",
                    message: "Embedded image resolution " + effectivePPI + " DPI is below minimum " + minDPI + " DPI",
                    uuid: uuid4,
                    details: { name: raster.name || "", effectivePPI: effectivePPI, minDPI: minDPI, pixelWidth: pxW, pixelHeight: pxH }
                  });
                }
              }
            }
          } catch(e2) {}
        } catch(e) {}
      }
    } catch(e) {}

    // 3b. Collect linked image data for Node.js-side DPI check
    var placedImageData = [];
    try {
      for (var pli = 0; pli < doc.placedItems.length; pli++) {
        var pItem = doc.placedItems[pli];
        try {
          var pFile = pItem.file;
          if (pFile && pFile.exists) {
            var pUuid = ensureUUID(pItem);
            var pBounds = pItem.geometricBounds;
            var pWPt = pBounds[2] - pBounds[0];
            var pHPt = -(pBounds[3] - pBounds[1]);
            if (pWPt < 0) pWPt = -pWPt;
            if (pHPt < 0) pHPt = -pHPt;
            placedImageData.push({
              uuid: pUuid,
              name: pItem.name || "",
              filePath: pFile.fsName,
              widthPt: pWPt,
              heightPt: pHPt
            });
          }
        } catch(e) {}
      }
    } catch(e) {}

    // 4. Non-outlined fonts (textFrames exist)
    try {
      if (doc.textFrames.length > 0) {
        var fontNames = [];
        for (var tf = 0; tf < doc.textFrames.length; tf++) {
          try {
            var textFrame = doc.textFrames[tf];
            var uuid5 = ensureUUID(textFrame);
            var fontName = "";
            try {
              if (textFrame.textRanges.length > 0) {
                fontName = textFrame.textRanges[0].characterAttributes.textFont.name;
              }
            } catch(e2) {}
            results.push({
              level: "warning",
              category: "non_outlined_text",
              message: "Non-outlined text detected",
              uuid: uuid5,
              details: { name: textFrame.name || "", contents: textFrame.contents.substring(0, 50), font: fontName }
            });
          } catch(e) {}
        }
      }
    } catch(e) {}

    // 5. White overprint
    for (var layerIdx2 = 0; layerIdx2 < doc.layers.length; layerIdx2++) {
      iterateAllItems(doc.layers[layerIdx2], function(item) {
        if (item.typename === "PathItem") {
          try {
            var hasFillOP = false;
            var hasStrokeOP = false;
            try { hasFillOP = item.fillOverprint; } catch(e2) {}
            try { hasStrokeOP = item.strokeOverprint; } catch(e2) {}

            if (hasFillOP && item.filled) {
              try {
                if (isWhiteColor(item.fillColor)) {
                  var uuid6 = ensureUUID(item);
                  results.push({
                    level: "error",
                    category: "white_overprint",
                    message: "White fill has overprint enabled (may disappear when printed)",
                    uuid: uuid6,
                    details: { name: item.name || "", layerName: getParentLayerName(item), attribute: "fill" }
                  });
                }
              } catch(e2) {}
            }

            if (hasStrokeOP && item.stroked) {
              try {
                if (isWhiteColor(item.strokeColor)) {
                  var uuid7 = ensureUUID(item);
                  results.push({
                    level: "error",
                    category: "white_overprint",
                    message: "White stroke has overprint enabled (may disappear when printed)",
                    uuid: uuid7,
                    details: { name: item.name || "", layerName: getParentLayerName(item), attribute: "stroke" }
                  });
                }
              } catch(e2) {}
            }
          } catch(e) {}
        }
      });
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
          } catch(e) {}
        }
      }
    } catch(e) {}

    // 8. Transparency (opacity < 100 or blendingMode !== normal)
    for (var layerIdx3 = 0; layerIdx3 < doc.layers.length; layerIdx3++) {
      iterateAllItems(doc.layers[layerIdx3], function(item) {
        try {
          var hasTransparency = false;
          var reason = "";
          try {
            if (item.opacity < 100) {
              hasTransparency = true;
              reason = "opacity: " + item.opacity + "%";
            }
          } catch(e2) {}
          try {
            if (item.blendingMode !== BlendModes.NORMAL) {
              hasTransparency = true;
              reason = reason ? (reason + ", blendingMode: " + item.blendingMode) : ("blendingMode: " + item.blendingMode);
            }
          } catch(e2) {}

          if (hasTransparency) {
            var uuid8 = ensureUUID(item);
            results.push({
              level: "warning",
              category: "transparency",
              message: "Transparency effect in use",
              uuid: uuid8,
              details: { name: item.name || "", layerName: getParentLayerName(item), reason: reason }
            });

            // 9. Transparency + overprint interaction
            if (item.typename === "PathItem") {
              var hasFillOPTrans = false;
              var hasStrokeOPTrans = false;
              try { hasFillOPTrans = item.fillOverprint; } catch(e4) {}
              try { hasStrokeOPTrans = item.strokeOverprint; } catch(e4) {}
              if (hasFillOPTrans || hasStrokeOPTrans) {
                results.push({
                  level: "error",
                  category: "transparency_overprint_interaction",
                  message: "Transparency + overprint on same object (unpredictable print result)",
                  uuid: uuid8,
                  details: { name: item.name || "", layerName: getParentLayerName(item), reason: reason + " + overprint" }
                });
              }

              // 10. Spot color + opacity interaction
              try {
                if (item.filled && item.fillColor.typename === "SpotColor" && item.opacity < 100) {
                  results.push({
                    level: "warning",
                    category: "spot_transparency",
                    message: "Spot color with transparency (may convert to process color unexpectedly)",
                    uuid: uuid8,
                    details: { spotName: item.fillColor.spot.name, opacity: item.opacity }
                  });
                }
              } catch(e4) {}
            }
          }
        } catch(e) {}
      });
    }

    // Collect summary counts for PDF/X compliance (processed in Node.js)
    var hasRGBItems = false;
    var hasTransparencyItems = false;
    var hasNonOutlinedText = false;
    var hasSpotColors = (doc.spots.length > 1);
    var colorProfileName = "";
    try { colorProfileName = doc.colorProfileName || ""; } catch(e9) {}
    for (var ri2 = 0; ri2 < results.length; ri2++) {
      if (results[ri2].category === "rgb_in_cmyk") hasRGBItems = true;
      if (results[ri2].category === "transparency") hasTransparencyItems = true;
      if (results[ri2].category === "non_outlined_text") hasNonOutlinedText = true;
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      documentColorSpace: isCMYKDoc ? "CMYK" : "RGB",
      checkCount: results.length,
      results: results,
      placedImageData: placedImageData,
      minDPI: minDPI,
      targetPdfProfile: targetPdfProfile,
      pdfxSummary: {
        hasRGBItems: hasRGBItems,
        hasTransparencyItems: hasTransparencyItems,
        hasNonOutlinedText: hasNonOutlinedText,
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

export function register(server: McpServer): void {
  server.registerTool(
    'preflight_check',
    {
      title: 'Preflight Check',
      description: 'Run pre-press quality checks. Note: This check is not exhaustive — it does not replace a human final review. GrayColor uses ink-quantity interpretation (0=white/no ink, 100=black/full ink), which differs from the API reference.',
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
          .describe('Target PDF/X profile for compliance checks. x1a: no transparency/RGB, fonts embedded. x4: allows transparency, recommends ICC profile.'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = (await executeJsx(jsxCode, resolvedParams)) as {
        checkCount: number;
        results: Array<{
          level: string;
          category: string;
          message: string;
          uuid: string | null;
          details: Record<string, unknown>;
        }>;
        placedImageData?: Array<{
          uuid: string;
          name: string;
          filePath: string;
          widthPt: number;
          heightPt: number;
        }>;
        minDPI?: number;
        [key: string]: unknown;
      };

      // Post-process: check PlacedItem DPI using Node.js file reading
      const minDpi = result?.minDPI ?? params.min_dpi ?? 300;
      if (result?.placedImageData) {
        for (const placed of result.placedImageData) {
          if (!placed.filePath || placed.widthPt <= 0 || placed.heightPt <= 0) continue;
          try {
            const dims = readImageDimensions(placed.filePath);
            if (dims) {
              const widthInches = placed.widthPt / 72;
              const heightInches = placed.heightPt / 72;
              const ppiH = Math.round(dims.width / widthInches);
              const ppiV = Math.round(dims.height / heightInches);
              const effectivePPI = Math.min(ppiH, ppiV);
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
            }
          } catch {
            // Skip unreadable files
          }
        }
        delete result.placedImageData;
        delete result.minDPI;
        result.checkCount = result.results.length;
      }

      // PDF/X compliance checks (Node.js side)
      const targetProfile = result?.targetPdfProfile as string | null;
      const pdfxSummary = result?.pdfxSummary as {
        hasRGBItems: boolean;
        hasTransparencyItems: boolean;
        hasNonOutlinedText: boolean;
        hasSpotColors: boolean;
        colorProfileName: string;
        isCMYKDoc: boolean;
      } | undefined;

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
          if (pdfxSummary.hasRGBItems || !pdfxSummary.isCMYKDoc) {
            result.results.push({
              level: 'error',
              category: 'pdfx_compliance',
              message: 'PDF/X-1a requires all colors in CMYK or spot. RGB colors detected.',
              uuid: null,
              details: { profile: 'x1a' },
            });
          }
          if (pdfxSummary.hasNonOutlinedText) {
            result.results.push({
              level: 'warning',
              category: 'pdfx_compliance',
              message: 'PDF/X-1a requires all fonts embedded. Consider converting text to outlines.',
              uuid: null,
              details: { profile: 'x1a' },
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
        result.checkCount = result.results.length;
      }

      // Clean up internal fields
      delete result.targetPdfProfile;
      delete result.pdfxSummary;

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
