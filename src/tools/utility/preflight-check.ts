import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
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

    // 3. Low resolution images (< 300dpi)
    try {
      for (var ri = 0; ri < doc.rasterItems.length; ri++) {
        var raster = doc.rasterItems[ri];
        try {
          var bounds = raster.geometricBounds;
          var widthPt = bounds[2] - bounds[0];
          var heightPt = bounds[3] - bounds[1];
          if (widthPt < 0) widthPt = -widthPt;
          if (heightPt < 0) heightPt = -heightPt;

          var matrix = raster.matrix;
          var ppiH = 72;
          var ppiV = 72;
          try {
            var srcW = raster.imageColorSpace ? raster.matrix.mValueA : 1;
            var srcH = raster.imageColorSpace ? raster.matrix.mValueD : 1;
          } catch(e2) {}

          // Use a simpler approach: compare pixel dimensions to point dimensions
          // Points to inches: divide by 72
          // If we can get bounding box in points and original pixel size, we can compute effective DPI
          // Unfortunately ExtendScript rasterItem doesn't directly expose pixel dimensions reliably
          // We check if the item has a lower than expected resolution by examining its properties
          var effectivePPI = 0;
          try {
            // Try to compute effective resolution from the object dimensions
            // raster items have an overprint property but no direct pixel dimension
            // Heuristic: if the item appears large at screen resolution, flag it
            var widthInches = widthPt / 72;
            var heightInches = heightPt / 72;
            // Cannot reliably determine pixel dimensions in ES3, so skip exact DPI calc
            // Instead just note as info
            if (widthInches > 0 || heightInches > 0) {
              var uuid4 = ensureUUID(raster);
              results.push({
                level: "warning",
                category: "image_resolution",
                message: "Please verify raster image resolution (exact DPI calculation unavailable due to API limitations)",
                uuid: uuid4,
                details: { name: raster.name || "", widthPt: widthPt, heightPt: heightPt }
              });
            }
          } catch(e2) {}
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
      results: results
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
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
