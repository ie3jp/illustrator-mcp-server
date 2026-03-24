import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    var target = params.target;
    var format = params.format;
    var outputPath = params.output_path;
    var scale = params.scale || 1;
    var svgOpts = params.svg_options || {};
    var rasterOpts = params.raster_options || {};


    // --- Target resolution ---
    var targetType = "unknown";
    var artboardIndex = -1;

    if (target === "selection") {
      targetType = "selection";
      if (!doc.selection || doc.selection.length === 0) {
        writeResultFile(RESULT_PATH, { error: true, message: "No objects are selected" });
        targetType = "error";
      }
    } else if (target.indexOf("artboard:") === 0) {
      targetType = "artboard";
      artboardIndex = parseInt(target.replace("artboard:", ""), 10);
      if (isNaN(artboardIndex) || artboardIndex < 0 || artboardIndex >= doc.artboards.length) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "Artboard index " + artboardIndex + " is out of range (0-" + (doc.artboards.length - 1) + ")"
        });
        targetType = "error";
      }
    } else {
      // UUID target — find and select (UUID は item.note に格納)
      targetType = "uuid";
      function findByUUID(items, uuid) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          try {
            if (item.note === uuid) return item;
          } catch(ex) {}
          if (item.typename === "GroupItem") {
            try {
              var child = findByUUID(item.pageItems, uuid);
              if (child) return child;
            } catch(ex2) {}
          }
        }
        return null;
      }
      // 全レイヤーを走査
      var targetItem = null;
      for (var li = 0; li < doc.layers.length; li++) {
        targetItem = findByUUID(doc.layers[li].pageItems, target);
        if (targetItem) break;
      }
      if (!targetItem) {
        writeResultFile(RESULT_PATH, { error: true, message: "No object found matching UUID: " + target });
        targetType = "error";
      } else {
        doc.selection = null;
        targetItem.selected = true;
        targetType = "selection";
      }
    }

    if (targetType !== "error") {
      var outFile = new File(outputPath);

      if (format === "svg") {
        var opts = new ExportOptionsSVG();
        opts.fontSubsetting = SVGFontSubsetting.None;

        if (svgOpts.text_outline === true) {
          opts.fontType = SVGFontType.OUTLINEFONT;
        }
        if (svgOpts.css_properties === true) {
          opts.cssProperties = SVGCSSPropertyLocation.STYLEELEMENTS;
        } else {
          opts.cssProperties = SVGCSSPropertyLocation.PRESENTATIONATTRIBUTES;
        }
        if (typeof svgOpts.embed_images !== "undefined") {
          opts.embedRasterImages = svgOpts.embed_images;
        }
        if (svgOpts.id_naming === "layer") {
          opts.idType = SVGIdType.SVGIDMINIMAL;
        } else if (svgOpts.id_naming === "object") {
          opts.idType = SVGIdType.SVGIDUNIQUE;
        } else {
          opts.idType = SVGIdType.SVGIDREGULAR;
        }
        if (typeof svgOpts.decimal_places === "number") {
          opts.coordinatePrecision = svgOpts.decimal_places;
        }
        if (typeof svgOpts.clean_metadata !== "undefined" && svgOpts.clean_metadata === false) {
          // default includes metadata; only skip if explicitly false
        }

        if (targetType === "artboard") {
          doc.artboards.setActiveArtboardIndex(artboardIndex);
          opts.artBoardClipping = true;
          opts.saveMultipleArtboards = true;
          opts.artboardRange = String(artboardIndex + 1);
        } else if (targetType === "selection") {
          opts.artBoardClipping = false;
        }

        doc.exportFile(outFile, ExportType.SVG, opts);

      } else if (format === "png") {
        var pngOpts = new ExportOptionsPNG24();
        var dpi = (rasterOpts.dpi || 72) * scale;
        pngOpts.horizontalScale = (dpi / 72) * 100;
        pngOpts.verticalScale = (dpi / 72) * 100;
        pngOpts.antiAliasing = (typeof rasterOpts.antialiasing !== "undefined") ? rasterOpts.antialiasing : true;

        if (rasterOpts.background === "transparent") {
          pngOpts.transparency = true;
        } else {
          pngOpts.transparency = false;
        }

        if (targetType === "artboard") {
          doc.artboards.setActiveArtboardIndex(artboardIndex);
          pngOpts.artBoardClipping = true;
          pngOpts.saveMultipleArtboards = true;
          pngOpts.artboardRange = String(artboardIndex + 1);
        } else if (targetType === "selection") {
          pngOpts.artBoardClipping = false;
        }

        doc.exportFile(outFile, ExportType.PNG24, pngOpts);

      } else if (format === "jpg") {
        var jpgOpts = new ExportOptionsJPEG();
        var jpgDpi = (rasterOpts.dpi || 72) * scale;
        jpgOpts.horizontalScale = (jpgDpi / 72) * 100;
        jpgOpts.verticalScale = (jpgDpi / 72) * 100;
        jpgOpts.antiAliasing = (typeof rasterOpts.antialiasing !== "undefined") ? rasterOpts.antialiasing : true;
        jpgOpts.qualitySetting = 80;

        if (targetType === "artboard") {
          doc.artboards.setActiveArtboardIndex(artboardIndex);
          jpgOpts.artBoardClipping = true;
          jpgOpts.saveMultipleArtboards = true;
          jpgOpts.artboardRange = String(artboardIndex + 1);
        } else if (targetType === "selection") {
          jpgOpts.artBoardClipping = false;
        }

        doc.exportFile(outFile, ExportType.JPEG, jpgOpts);

      // WebP は ExtendScript API 非対応のため無効化
      // } else if (format === "webp") { ... }
      }

      if (targetType !== "error") {
        writeResultFile(RESULT_PATH, { success: true, output_path: outputPath });
      }

    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Export failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'export',
    {
      title: 'Export',
      description: 'Export objects, groups, artboards, or selection',
      inputSchema: {
        target: z
          .string()
          .describe('UUID, "artboard:<index>", or "selection"'),
        // WebP is not supported by ExtendScript API
        // format: z.enum(['svg', 'png', 'webp', 'jpg']).describe('Export format'),
        format: z.enum(['svg', 'png', 'jpg']).describe('Export format'),
        output_path: z.string().describe('Output file path'),
        scale: z.number().optional().default(1).describe('Scale factor'),
        svg_options: z
          .object({
            text_outline: z.boolean().optional().describe('Convert text to outlines'),
            css_properties: z.boolean().optional().describe('Export as CSS properties'),
            embed_images: z.boolean().optional().describe('Embed raster images'),
            id_naming: z
              .enum(['layer', 'object', 'auto'])
              .optional()
              .describe('ID naming scheme'),
            decimal_places: z.number().optional().describe('Decimal places'),
            responsive: z.boolean().optional().describe('Responsive SVG (unofficial)'),
            clean_metadata: z.boolean().optional().describe('Remove metadata'),
          })
          .optional()
          .describe('SVG export options'),
        raster_options: z
          .object({
            dpi: z.number().optional().describe('Resolution (DPI)'),
            background: z
              .string()
              .optional()
              .describe('"transparent", "white", or color code'),
            antialiasing: z.boolean().optional().describe('Anti-aliasing'),
          })
          .optional()
          .describe('Raster export options'),
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe('Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsxHeavy(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
