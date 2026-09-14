import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { realpathSync, existsSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS, coerceBoolean } from '../modify/shared.js';

function requiresMenuCommandActivation(params: { target: string; format: string }): boolean {
  // JSX の useIsolatedExport と同じ条件。どちらかを変更するときは必ず双方を更新する。
  // UUID と断定できない値も安全側で UUID 候補として前面化する。
  const isPotentialUUIDTarget = params.target !== 'selection' && !params.target.startsWith('artboard:');
  return isPotentialUUIDTarget && (params.format === 'png' || params.format === 'jpg');
}

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
      var sep = Folder.fs === 'Windows' ? '\\\\' : '/';
      outputPath = dir + sep + baseName + '.' + ext;
      var counter = 2;
      while (new File(outputPath).exists) {
        outputPath = dir + sep + baseName + '_' + counter + '.' + ext;
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
    } else if (target === "artboard:all") {
      targetType = "artboard-all";
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
      // TS の requiresMenuCommandActivation() と同期すること。
      var isUUIDTarget = (targetType === "selection" && target !== "selection");
      var useIsolatedExport = (isUUIDTarget && (format === "png" || format === "jpg"));

      if (useIsolatedExport) {
        // 選択オブジェクトをコピー
        executeMenuCommandSafe("copy");

        // 対象オブジェクトの bounds を取得（[left, top, right, bottom] in document coords）
        var vb = targetItem.visibleBounds;
        var objW = vb[2] - vb[0];
        var objH = vb[1] - vb[3]; // top - bottom (document coords: Y-up)

        // 一時ドキュメントを作成
        var tempDoc = app.documents.add(doc.documentColorSpace, objW, objH);
        try {
        tempDoc.artboards[0].artboardRect = [0, objH, objW, 0];

        // ペースト
        executeMenuCommandSafe("paste");

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
        // 従来の書き出しロジック（artboard / artboard:all / selection / SVG）
        // abIdx >= 0 でアートボード書き出し、-1 で selection 書き出し
        var exportOne = function (abIdx, file) {
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
            if (abIdx >= 0) {
              doc.artboards.setActiveArtboardIndex(abIdx);
              opts.artBoardClipping = true;
              opts.saveMultipleArtboards = true;
              opts.artboardRange = String(abIdx + 1);
            } else {
              opts.artBoardClipping = false;
            }

            doc.exportFile(file, ExportType.SVG, opts);

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

            if (abIdx >= 0) {
              doc.artboards.setActiveArtboardIndex(abIdx);
              pngOpts.artBoardClipping = true;
            } else {
              pngOpts.artBoardClipping = false;
            }

            doc.exportFile(file, ExportType.PNG24, pngOpts);

          } else if (format === "jpg") {
            var jpgOpts = new ExportOptionsJPEG();
            var jpgDpi = (rasterOpts.dpi || 72) * scale;
            jpgOpts.horizontalScale = (jpgDpi / 72) * 100;
            jpgOpts.verticalScale = (jpgDpi / 72) * 100;
            jpgOpts.antiAliasing = (typeof rasterOpts.antialiasing !== "undefined") ? rasterOpts.antialiasing : true;
            jpgOpts.qualitySetting = 80;

            if (abIdx >= 0) {
              doc.artboards.setActiveArtboardIndex(abIdx);
              jpgOpts.artBoardClipping = true;
            } else {
              jpgOpts.artBoardClipping = false;
            }

            doc.exportFile(file, ExportType.JPEG, jpgOpts);
          }
        };

        // エクスポート後のファイル存在検証。実際の出力パスを返す（存在しなければ null）
        // SVG artboard exportではIllustratorが {basename}_{artboardName}.svg にリネームする。
        // 名前のマングリング規則が不定（特殊文字の扱いが不明）のため、名前を推測せず
        // 「同フォルダで指定ベース名から始まり、書き出し開始以降に更新された .svg」を探す
        var verifyOne = function (path, abIdx, sinceMs) {
          if (new File(path).exists) return path;
          if (format === "svg" && abIdx >= 0) {
            var prefix = path.replace(/\\.svg$/i, '');
            var siblings = new File(path).parent.getFiles();
            for (var ci = 0; ci < siblings.length; ci++) {
              try {
                var cand = siblings[ci];
                if (cand instanceof File &&
                    cand.fsName.indexOf(prefix) === 0 &&
                    /\\.svg$/i.test(cand.fsName) &&
                    cand.modified && cand.modified.getTime() >= sinceMs) {
                  return cand.fsName;
                }
              } catch (eV) {}
            }
          }
          return null;
        };

        if (targetType === "artboard-all") {
          var files = [];
          var failedList = [];
          var dirName = outFile.parent.fsName;
          var nameNoExt = outFile.name.replace(/\\.[^.]+$/, '');
          var pathSep = Folder.fs === 'Windows' ? '\\\\' : '/';
          // ファイルシステムのタイムスタンプ解像度を考慮して2秒のマージンを取る
          var batchStartMs = (new Date()).getTime() - 2000;
          for (var ai = 0; ai < doc.artboards.length; ai++) {
            // パス区切り等の危険文字とスペースをハイフンに置換。_<n>- の連番で同名アートボードの衝突も防ぐ
            var abLabel = doc.artboards[ai].name.replace(/[\\/\\\\: ]/g, '-');
            // SVGは非ASCIIファイル名で警告ダイアログが出て書き出しに失敗するため
            // ASCIIにフォールバック（一意性は _<n>- の連番が保証。実機検証: 日本語名で失敗確認済み）
            if (format === "svg" && /[^\\x00-\\x7F]/.test(abLabel)) {
              abLabel = "artboard";
            }
            var abPath = dirName + pathSep + nameNoExt + '_' + (ai + 1) + '-' + abLabel + '.' + format;
            var exportError = null;
            try {
              exportOne(ai, new File(abPath));
            } catch (eAb) {
              // 1枚の失敗で残りのアートボードを道連れにしない
              exportError = eAb.message || String(eAb);
            }
            var actual = exportError ? null : verifyOne(abPath, ai, batchStartMs);
            if (actual) {
              files.push(actual);
            } else {
              failedList.push({ index: ai, name: doc.artboards[ai].name, message: exportError || "output file was not created" });
            }
          }
          if (files.length === 0) {
            writeResultFile(RESULT_PATH, {
              error: true,
              message: "Batch export failed for all " + doc.artboards.length + " artboards. First error: " + failedList[0].message,
              failed_artboards: failedList
            });
          } else {
            var allResult = { success: true, files: files, count: files.length, format: format };
            if (failedList.length > 0) {
              allResult.failed_artboards = failedList;
            }
            if (format === "png" || format === "jpg") {
              allResult.dpi = (rasterOpts.dpi || 72) * scale;
              allResult.scale = scale;
            }
            writeResultFile(RESULT_PATH, allResult);
          }
        } else {
          var singleStartMs = (new Date()).getTime() - 2000;
          exportOne(targetType === "artboard" ? artboardIndex : -1, outFile);
        }
      }

      if (targetType !== "error" && targetType !== "artboard-all") {
        // エクスポート後にファイル存在を検証
        // SVG + artboard の場合のみ verifyOne でリネーム後のファイルを探す
        // （一時ドキュメント経由のPNG/JPGパスでは verifyOne 未定義だがこの分岐に入らない）
        var actualPath = outputPath;
        var verifyFile = new File(outputPath);
        if (!verifyFile.exists && format === "svg" && artboardIndex >= 0) {
          var renamed = verifyOne(outputPath, artboardIndex, singleStartMs);
          if (renamed) {
            actualPath = renamed;
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
      description: 'Export objects, groups, artboards, or selection. Use target "artboard:all" to batch-export every artboard in one call. For single PNG/JPG exports, the exported image is returned as base64 in the response — you can view it directly without reading the file from disk ("artboard:all" returns file paths only). Note: Illustrator will be activated (brought to foreground) when exporting a UUID target as PNG/JPG.',
      inputSchema: {
        target: z
          .string()
          .describe('UUID, "artboard:<index>", "artboard:all" (batch-export every artboard; filenames get "_<n>-<artboardName>" suffixes), or "selection". When exporting a UUID target as PNG/JPG, a temporary document is created internally (selection state may change).'),
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
      // macOS の /tmp は /private/tmp へのシンボリックリンク。
      // Illustrator の exportFile() はシンボリックリンク経由のパスに書き込めない場合があるため、
      // Node.js 側で実パスに解決してから渡す。
      const resolvedParams = { ...params };
      if (resolvedParams.output_path) {
        const dir = dirname(resolvedParams.output_path);
        if (existsSync(dir)) {
          try {
            const realDir = realpathSync(dir);
            resolvedParams.output_path = join(realDir, basename(resolvedParams.output_path));
          } catch (_) { /* 解決できなければ元のパスをそのまま使う */ }
        }
      }
      const result = await executeJsxHeavy(jsxCode, resolvedParams, {
        activate: requiresMenuCommandActivation(resolvedParams),
      });
      const textResult = formatToolResult(result);

      // PNG/JPG: ファイルを読み込んでbase64画像としても返す
      if (
        result &&
        typeof result === 'object' &&
        (result as Record<string, unknown>).success &&
        (result as Record<string, unknown>).output_path &&
        (params.format === 'png' || params.format === 'jpg')
      ) {
        const outputPath = (result as Record<string, unknown>).output_path as string;
        try {
          if (existsSync(outputPath)) {
            const imageData = readFileSync(outputPath).toString('base64');
            const mimeType = params.format === 'png' ? 'image/png' : 'image/jpeg';
            const visualCheckNote = {
              type: 'text' as const,
              text: JSON.stringify({
                visual_check_hint:
                  'Now review the exported image visually — not just numerically. ' +
                  'Text alignment can look off even when coordinates are mathematically correct, ' +
                  'because bounding boxes include invisible padding. ' +
                  'If text appears misaligned, adjust by visual impression rather than exact numbers.',
              }),
            };
            return {
              content: [
                ...textResult.content,
                visualCheckNote,
                { type: 'image' as const, data: imageData, mimeType },
              ],
            };
          }
        } catch {
          // 画像読み込みに失敗してもテキスト結果は返す
        }
      }

      return textResult;
    },
  );
}
