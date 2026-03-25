import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { readImageDimensions } from '../../utils/image-header.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var minDPI = (params && params.min_dpi) ? params.min_dpi : 300;
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
          if (color.gray === 0) return true;
        }
      } catch(e) {}
      return false;
    }

    // Helper: get parent layer name
    function getParentLayerName(item) {
      var current = item.parent;
      while (current) {
        if (current.typename === "Layer") return current.name;
        current = current.parent;
      }
      return "";
    }

    // Helper: recursive iteration over all page items
    function iterateAllItems(container, callback) {
      for (var i = 0; i < container.pageItems.length; i++) {
        var item = container.pageItems[i];
        try {
          callback(item);
          if (item.typename === "GroupItem") {
            iterateAllItems(item, callback);
          }
        } catch(e) {}
      }
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
          }
        } catch(e) {}
      });
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      documentColorSpace: isCMYKDoc ? "CMYK" : "RGB",
      checkCount: results.length,
      results: results,
      placedImageData: placedImageData,
      minDPI: minDPI
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'preflight_check',
    {
      title: 'Preflight Check',
      description: 'Run pre-press quality checks',
      inputSchema: {
        coordinate_system: coordinateSystemSchema,
        min_dpi: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(300)
          .describe('Minimum acceptable DPI for images (default: 300)'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: resolveCoordinateSystem(params.coordinate_system) };
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

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
