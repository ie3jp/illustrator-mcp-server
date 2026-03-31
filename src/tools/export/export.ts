import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS, coerceBoolean } from '../modify/shared.js';
/**
 * export — SVG/PNG/JPG/WebP 書き出し
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — exportFile()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/ExportOptionsPNG24/
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/ExportOptionsSVG/
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/ExportOptionsJPEG/
 *
 * 注意: SVGIdType / idType はリファレンスに記載がないが try/catch で安全に処理。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var target = params.target;
    var format = params.format;
    var outputPath = params.output_path;
    var scale = params.scale || 1;

    // Default path generation when output_path is omitted
    if (!outputPath) {
      var dir;
      try {
        // doc.path is empty string for unsaved documents
        var docPath = doc.path ? doc.path.fsName : '';
        if (docPath && docPath !== '/') {
          dir = docPath;
        } else {
          dir = Folder.desktop.fsName;
        }
      } catch (e) {
        dir = Folder.desktop.fsName;
      }
      var baseName = doc.name.replace(/\\.[^.]+$/, '').replace(/ /g, '-');
      // ASCII以外の文字を含む場合、SVGでは警告ダイアログが出るためフォールバック
      if (format === 'svg' && /[^\\x00-\\x7F]/.test(baseName)) {
        baseName = 'export';
      }
      var ext = format; // png, jpg, svg
      outputPath = dir + '/' + baseName + '.' + ext;
      var counter = 2;
      while (new File(outputPath).exists) {
        outputPath = dir + '/' + baseName + '_' + counter + '.' + ext;
        counter++;
      }
    }
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
      var targetItem = findItemByUUID(target);
      if (!targetItem) {
        writeResultFile(RESULT_PATH, { error: true, message: "No object found matching UUID: " + target });
        targetType = "error";
      } else {
        doc.selection = null;
        targetItem.selected = true;
        targetType = "selection";
      }
    }

    var outFile = null;
    if (targetType !== "error") {
      outFile = new File(outputPath);
      var parentFolder = outFile.parent;
      if (!parentFolder.exists) {
        writeResultFile(RESULT_PATH, { error: true, message: "Output directory does not exist: " + parentFolder.fsName });
        targetType = "error";
      }
    }

    if (targetType !== "error") {
      // UUID指定かつラスタ形式の場合、一時ドキュメントにコピーして書き出す
      var isUUIDTarget = (targetType === "selection" && target !== "selection");
      var useIsolatedExport = (isUUIDTarget && (format === "png" || format === "jpg"));

      if (useIsolatedExport) {
        // 選択オブジェクトをコピー
        app.executeMenuCommand("copy");

        // 対象オブジェクトの bounds を取得（[left, top, right, bottom] in document coords）
        var vb = targetItem.visibleBounds;
        var objW = vb[2] - vb[0];
        var objH = vb[1] - vb[3]; // top - bottom (document coords: Y-up)

        // 一時ドキュメントを作成
        var tempDoc = app.documents.add(doc.documentColorSpace, objW, objH);
        try {
        tempDoc.artboards[0].artboardRect = [0, objH, objW, 0];

        // ペースト
        app.executeMenuCommand("paste");

        // ペーストされたオブジェクトをアートボード中央に配置
        if (tempDoc.selection && tempDoc.selection.length > 0) {
          var pasted = tempDoc.selection[0];
          var pb = pasted.visibleBounds;
          var pw = pb[2] - pb[0];
          var ph = pb[1] - pb[3];
          pasted.left = (objW - pw) / 2;
          pasted.top = objH - (objH - ph) / 2;
        }

        // アートボードをアートワークにフィット
        var fitBounds = tempDoc.visibleBounds;
        if (fitBounds) {
          tempDoc.artboards[0].artboardRect = [fitBounds[0], fitBounds[1], fitBounds[2], fitBounds[3]];
        }

        // 一時ドキュメントからエクスポート
        if (format === "png") {
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
          pngOpts.artBoardClipping = true;
          tempDoc.exportFile(outFile, ExportType.PNG24, pngOpts);
        } else {
          var jpgOpts = new ExportOptionsJPEG();
          var jpgDpi = (rasterOpts.dpi || 72) * scale;
          jpgOpts.horizontalScale = (jpgDpi / 72) * 100;
          jpgOpts.verticalScale = (jpgDpi / 72) * 100;
          jpgOpts.antiAliasing = (typeof rasterOpts.antialiasing !== "undefined") ? rasterOpts.antialiasing : true;
          jpgOpts.qualitySetting = 80;
          jpgOpts.artBoardClipping = true;
          tempDoc.exportFile(outFile, ExportType.JPEG, jpgOpts);
        }

        } finally {
        // 一時ドキュメントを閉じる（エクスポート失敗時もリーク防止）
        tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        }

      } else {
        // 従来の書き出しロジック（artboard / selection / SVG）
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
          try {
            if (svgOpts.id_naming === "layer") {
              opts.idType = SVGIdType.SVGIDMINIMAL;
            } else if (svgOpts.id_naming === "object") {
              opts.idType = SVGIdType.SVGIDUNIQUE;
            } else {
              opts.idType = SVGIdType.SVGIDREGULAR;
            }
          } catch (_) { /* SVGIdType may not exist in some ExtendScript versions */ }
          if (typeof svgOpts.decimal_places === "number") {
            opts.coordinatePrecision = svgOpts.decimal_places;
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
          } else if (targetType === "selection") {
            jpgOpts.artBoardClipping = false;
          }

          doc.exportFile(outFile, ExportType.JPEG, jpgOpts);
        }
      }

      if (targetType !== "error") {
        // エクスポート後にファイル存在を検証
        // SVG artboard exportではIllustratorが {basename}_{artboardName}.svg にリネームする
        var actualPath = outputPath;
        var verifyFile = new File(outputPath);
        if (!verifyFile.exists && format === "svg" && artboardIndex >= 0) {
          var svgDir = new File(outputPath).parent.fsName;
          var svgBase = new File(outputPath).name.replace(/\\.svg$/i, '');
          var abName = doc.artboards[artboardIndex].name.replace(/ /g, '-');
          var svgActual = svgDir + '/' + svgBase + '_' + abName + '.svg';
          var svgFile = new File(svgActual);
          if (svgFile.exists) {
            actualPath = svgActual;
          }
        }
        var finalFile = new File(actualPath);
        if (!finalFile.exists) {
          writeResultFile(RESULT_PATH, { error: true, message: "Export completed but output file was not created. The path may not be writable: " + outputPath });
        } else {
          var resultInfo = { success: true, output_path: actualPath, format: format };
          if (format === "png" || format === "jpg") {
            var effectiveDpi = (rasterOpts.dpi || 72) * scale;
            resultInfo.dpi = effectiveDpi;
            resultInfo.scale = scale;
          }
          writeResultFile(RESULT_PATH, resultInfo);
        }
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
      description: 'Export objects, groups, artboards, or selection. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        target: z
          .string()
          .describe('UUID, "artboard:<index>", or "selection". When exporting a UUID target as PNG/JPG, a temporary document is created internally (selection state may change).'),
        // WebP is not supported by ExtendScript API
        // format: z.enum(['svg', 'png', 'webp', 'jpg']).describe('Export format'),
        format: z.enum(['svg', 'png', 'jpg']).describe('Export format'),
        output_path: z.string().optional().describe('Output file path. If omitted, auto-generates in the same directory as the document (or ~/Desktop for unsaved documents)'),
        scale: z.number().optional().default(1).describe('Scale factor'),
        svg_options: z
          .object({
            text_outline: coerceBoolean.optional().describe('Convert text to outlines'),
            css_properties: coerceBoolean.optional().describe('Export as CSS properties'),
            embed_images: coerceBoolean.optional().describe('Embed raster images'),
             id_naming: z
               .enum(['layer', 'object', 'auto'])
               .optional()
               .describe('ID naming scheme'),
             decimal_places: z.number().optional().describe('Decimal places'),
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
             antialiasing: coerceBoolean.optional().describe('Anti-aliasing'),
           })
           .optional()
           .describe('Raster export options'),
       },
       annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsxHeavy(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
