import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { realpathSync, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, basename, join, isAbsolute } from 'node:path';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS, coerceBoolean } from '../modify/shared.js';

/** dpi × scale の上限。エージェントの数値ミスで巨大画像を生成しないためのガード */
export const MAX_EFFECTIVE_DPI = 2400;
/** base64 で応答に載せる画像の上限（base64 化後に約 5MB） */
export const MAX_INLINE_IMAGE_BYTES = Math.floor(3.75 * 1024 * 1024);

/**
 * Illustrator を呼ぶ前に弾ける入力エラーを検出する。問題なければ null。
 */
export function validateExportParams(params: {
  format: string;
  output_path?: string;
  scale?: number;
  raster_options?: { dpi?: number };
}): string | null {
  if (params.output_path !== undefined) {
    // 相対パスは Illustrator 側のカレントフォルダ基準で解釈され、書き出し先が予測できない
    if (!isAbsolute(params.output_path)) {
      return `output_path must be an absolute path: ${params.output_path}`;
    }
    // SVG は非 ASCII ファイル名で警告ダイアログが出て失敗する（自動生成パス・batch ラベルと同じ理由）
    if (params.format === 'svg' && /[^\x00-\x7F]/.test(basename(params.output_path))) {
      return `SVG export cannot use a non-ASCII file name (Illustrator shows a warning dialog and the export fails). Use an ASCII file name: ${params.output_path}`;
    }
  }
  if (params.format === 'png' || params.format === 'jpg') {
    const effectiveDpi = (params.raster_options?.dpi ?? 72) * (params.scale ?? 1);
    if (effectiveDpi > MAX_EFFECTIVE_DPI) {
      return `Effective resolution ${effectiveDpi} dpi (dpi × scale) exceeds the limit of ${MAX_EFFECTIVE_DPI} dpi`;
    }
  }
  return null;
}

/**
 * パス生成・既存ファイル検出・batch 結果判定の JSX ヘルパー。
 * jsxCode の前に連結して実行する（ユニットテストで単体評価するため分離）。
 */
export const exportPathHelpersJsx = `
// アートボード名をファイル名用に無害化する。
// パス区切り・Windows 禁止文字・制御文字・空白をハイフンに置換
function sanitizeArtboardLabel(name, format) {
  var label = String(name).replace(/[\\/\\\\:"<>|?*\\x00-\\x1F ]/g, '-');
  // SVGは非ASCIIファイル名で警告ダイアログが出て書き出しに失敗するため
  // ASCIIにフォールバック（一意性は _<n>- の連番が保証。実機検証: 日本語名で失敗確認済み）
  if (format === "svg" && /[^\\x00-\\x7F]/.test(label)) {
    label = "artboard";
  }
  return label;
}

// artboard:all の各アートボードの出力パス: <dir>/<name>_<n>-<label>.<ext>
function batchOutputPath(basePath, ai, abName, format) {
  var cut = Math.max(basePath.lastIndexOf('/'), basePath.lastIndexOf('\\\\'));
  var dirPart = basePath.substring(0, cut + 1);
  var nameNoExt = basePath.substring(cut + 1).replace(/\\.[^.]+$/, '');
  return dirPart + nameNoExt + '_' + (ai + 1) + '-' + sanitizeArtboardLabel(abName, format) + '.' + format;
}

// SVG のアートボード書き出しは Illustrator が {basename}_{artboardName}.svg にリネームする。
// 名前の変換規則が不定のため、"{basename}_" で始まる既存 .svg をすべて衝突候補とみなす
function collectSvgRenameCandidates(path, siblings, out) {
  var prefix = path.replace(/\\.svg$/i, '') + '_';
  for (var i = 0; i < siblings.length; i++) {
    var cand = siblings[i];
    if (cand instanceof File && cand.fsName.indexOf(prefix) === 0 && /\\.svg$/i.test(cand.fsName)) {
      out.push(cand.fsName);
    }
  }
}

// この書き出しが上書きしうる既存ファイルの一覧を返す（無ければ空配列）
function findExistingOutputs(outputPath, format, target, artboards) {
  var found = [];
  var isBatch = (target === "artboard:all");
  var isSvgArtboard = (format === "svg" && target.indexOf("artboard:") === 0);
  var paths = [];
  if (isBatch) {
    for (var ai = 0; ai < artboards.length; ai++) {
      paths.push(batchOutputPath(outputPath, ai, artboards[ai].name, format));
    }
  } else {
    paths.push(outputPath);
  }
  var siblings = null;
  for (var pi = 0; pi < paths.length; pi++) {
    var f = new File(paths[pi]);
    if (f.exists) found.push(paths[pi]);
    if (isSvgArtboard) {
      if (siblings === null) {
        var parent = f.parent;
        siblings = (parent && parent.exists) ? parent.getFiles() : [];
      }
      collectSvgRenameCandidates(paths[pi], siblings, found);
    }
  }
  return found;
}

// artboard:all の結果。1 枚でも失敗したら success は false（partial で区別）
function buildBatchResult(files, failedList, total, format) {
  if (files.length === 0) {
    return {
      error: true,
      message: "Batch export failed for all " + total + " artboards. First error: " + (failedList.length > 0 ? failedList[0].message : "unknown"),
      failed_artboards: failedList
    };
  }
  var r = { success: failedList.length === 0, files: files, count: files.length, format: format };
  if (failedList.length > 0) {
    r.partial = true;
    r.message = failedList.length + " of " + total + " artboards failed to export";
    r.failed_artboards = failedList;
  }
  return r;
}
`;

/**
 * export — SVG/PNG/JPG/WebP 書き出し
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — exportFile()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/ExportOptionsPNG24/
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/ExportOptionsSVG/
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/ExportOptionsJPEG/
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — PageItem.duplicate()
 *
 * 注意: SVGIdType / idType はリファレンスに記載がないが try/catch で安全に処理。
 *
 * UUID / selection は一時ドキュメントに duplicate() して書き出す。
 * exportFile() は選択書き出しに対応しておらず（ExportOptionsSVG にも該当プロパティなし）、
 * 元ドキュメントからでは全アートワークの bbox になるため。
 * クリップボード（copy/paste）もメニューコマンドも使わないので、ユーザーのクリップボードと
 * 選択状態を壊さず、Illustrator の前面化も不要。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  var doc = null;
  var tempDoc = null;
  var prevActiveAb = -1;
  try {
    var params = readParamsFile(PARAMS_PATH);
    doc = app.activeDocument;
    var target = params.target;
    var format = params.format;
    var outputPath = params.output_path;
    var explicitPath = !!outputPath;
    var scale = params.scale || 1;
    var svgOpts = params.svg_options || {};
    var rasterOpts = params.raster_options || {};
    var sep = Folder.fs === 'Windows' ? '\\\\' : '/';

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
      outputPath = dir + sep + baseName + '.' + ext;
      // batch の派生ファイル名や SVG のリネーム後の名前も含めて衝突を避ける
      var counter = 2;
      while (findExistingOutputs(outputPath, format, target, doc.artboards).length > 0 && counter < 1000) {
        outputPath = dir + sep + baseName + '_' + counter + '.' + ext;
        counter++;
      }
    }

    // --- Target resolution ---
    var errorResult = null;
    var targetType = "unknown";
    var artboardIndex = -1;
    var exportItems = null;

    if (target === "selection") {
      targetType = "items";
      var sel = doc.selection;
      if (sel && sel.typename === "TextRange") {
        errorResult = { error: true, message: "Text is being edited. Exit text editing and select the text frame as an object, then export again." };
      } else if (!sel || sel.length === 0) {
        errorResult = { error: true, message: "No objects are selected" };
      } else {
        exportItems = [];
        for (var si = 0; si < sel.length; si++) exportItems.push(sel[si]);
      }
    } else if (target === "artboard:all") {
      targetType = "artboard-all";
    } else if (target.indexOf("artboard:") === 0) {
      targetType = "artboard";
      artboardIndex = parseInt(target.replace("artboard:", ""), 10);
      if (isNaN(artboardIndex) || artboardIndex < 0 || artboardIndex >= doc.artboards.length) {
        errorResult = {
          error: true,
          message: "Artboard index " + artboardIndex + " is out of range (0-" + (doc.artboards.length - 1) + ")"
        };
      }
    } else {
      // UUID target（UUID は item.note に格納）
      targetType = "items";
      var targetItem = findItemByUUID(target);
      if (!targetItem) {
        errorResult = { error: true, message: "No object found matching UUID: " + target };
      } else {
        exportItems = [targetItem];
      }
    }

    var outFile = null;
    if (!errorResult) {
      outFile = new File(outputPath);
      var parentFolder = outFile.parent;
      if (!parentFolder.exists) {
        errorResult = { error: true, message: "Output directory does not exist: " + parentFolder.fsName };
      }
    }

    // 明示パスの既存ファイルは overwrite: true のときだけ上書きする
    if (!errorResult && explicitPath && params.overwrite !== true) {
      var existing = findExistingOutputs(outputPath, format, target, doc.artboards);
      if (existing.length > 0) {
        errorResult = {
          error: true,
          message: "Output file already exists: " + existing.join(", ") + ". Pass overwrite: true to replace it, or choose another output_path.",
          existing_files: existing
        };
      }
    }

    if (errorResult) {
      writeResultFile(RESULT_PATH, errorResult);
    } else {
      // abIdx >= 0 でアートボード書き出し、-1 でドキュメント内の全アートワークの bbox で書き出し
      var exportOne = function (srcDoc, abIdx, file) {
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
            srcDoc.artboards.setActiveArtboardIndex(abIdx);
            opts.artBoardClipping = true;
            opts.saveMultipleArtboards = true;
            opts.artboardRange = String(abIdx + 1);
          } else {
            opts.artBoardClipping = false;
          }

          srcDoc.exportFile(file, ExportType.SVG, opts);

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
            srcDoc.artboards.setActiveArtboardIndex(abIdx);
            pngOpts.artBoardClipping = true;
          } else {
            pngOpts.artBoardClipping = false;
          }

          srcDoc.exportFile(file, ExportType.PNG24, pngOpts);

        } else if (format === "jpg") {
          var jpgOpts = new ExportOptionsJPEG();
          var jpgDpi = (rasterOpts.dpi || 72) * scale;
          jpgOpts.horizontalScale = (jpgDpi / 72) * 100;
          jpgOpts.verticalScale = (jpgDpi / 72) * 100;
          jpgOpts.antiAliasing = (typeof rasterOpts.antialiasing !== "undefined") ? rasterOpts.antialiasing : true;
          jpgOpts.qualitySetting = 80;

          if (abIdx >= 0) {
            srcDoc.artboards.setActiveArtboardIndex(abIdx);
            jpgOpts.artBoardClipping = true;
          } else {
            jpgOpts.artBoardClipping = false;
          }

          srcDoc.exportFile(file, ExportType.JPEG, jpgOpts);
        }
      };

      // エクスポート後のファイル存在検証。実際の出力パスを返す（存在しなければ null）
      // 書き出し開始前から残っていた古いファイルを成功と誤認しないよう更新時刻も見る。
      // SVG artboard exportではIllustratorが {basename}_{artboardName}.svg にリネームする。
      // 名前のマングリング規則が不定（特殊文字の扱いが不明）のため、名前を推測せず
      // 「同フォルダで指定ベース名から始まり、書き出し開始以降に更新された .svg」を探す
      var isFresh = function (f, sinceMs) {
        try {
          return !f.modified || f.modified.getTime() >= sinceMs;
        } catch (eM) {
          return true;
        }
      };
      var verifyOne = function (path, abIdx, sinceMs) {
        var direct = new File(path);
        if (direct.exists && isFresh(direct, sinceMs)) return path;
        if (format === "svg" && abIdx >= 0) {
          var prefix = path.replace(/\\.svg$/i, '');
          var siblings = direct.parent.getFiles();
          for (var ci = 0; ci < siblings.length; ci++) {
            try {
              var cand = siblings[ci];
              if (cand instanceof File &&
                  cand.fsName.indexOf(prefix) === 0 &&
                  /\\.svg$/i.test(cand.fsName) &&
                  isFresh(cand, sinceMs)) {
                return cand.fsName;
              }
            } catch (eV) {}
          }
        }
        return null;
      };

      prevActiveAb = doc.artboards.getActiveArtboardIndex();
      // ファイルシステムのタイムスタンプ解像度を考慮して2秒のマージンを取る
      var startMs = (new Date()).getTime() - 2000;

      if (targetType === "artboard-all") {
        var files = [];
        var failedList = [];
        for (var ai = 0; ai < doc.artboards.length; ai++) {
          var abPath = batchOutputPath(outputPath, ai, doc.artboards[ai].name, format);
          var exportError = null;
          try {
            exportOne(doc, ai, new File(abPath));
          } catch (eAb) {
            // 1枚の失敗で残りのアートボードを道連れにしない
            exportError = eAb.message || String(eAb);
          }
          var actual = exportError ? null : verifyOne(abPath, ai, startMs);
          if (actual) {
            files.push(actual);
          } else {
            failedList.push({ index: ai, name: doc.artboards[ai].name, message: exportError || "output file was not created" });
          }
        }
        var allResult = buildBatchResult(files, failedList, doc.artboards.length, format);
        if (!allResult.error && (format === "png" || format === "jpg")) {
          allResult.dpi = (rasterOpts.dpi || 72) * scale;
          allResult.scale = scale;
        }
        writeResultFile(RESULT_PATH, allResult);
      } else {
        if (targetType === "items") {
          // 対象だけを一時ドキュメントに複製して書き出す
          var ub = null;
          for (var bi = 0; bi < exportItems.length; bi++) {
            var ib = exportItems[bi].visibleBounds;
            if (!ub) {
              ub = [ib[0], ib[1], ib[2], ib[3]];
            } else {
              if (ib[0] < ub[0]) ub[0] = ib[0];
              if (ib[1] > ub[1]) ub[1] = ib[1];
              if (ib[2] > ub[2]) ub[2] = ib[2];
              if (ib[3] < ub[3]) ub[3] = ib[3];
            }
          }
          var objW = Math.max(1, ub[2] - ub[0]);
          var objH = Math.max(1, ub[1] - ub[3]); // top - bottom (document coords: Y-up)

          tempDoc = app.documents.add(doc.documentColorSpace, objW, objH);
          tempDoc.artboards[0].artboardRect = [0, objH, objW, 0];
          // 複製は元ドキュメントをアクティブにして行う（import_svg_as_editable と同じ向き）
          app.activeDocument = doc;
          var tempLayer = tempDoc.layers[0];
          var dups = [];
          for (var di = 0; di < exportItems.length; di++) {
            var dup = exportItems[di].duplicate(tempLayer, ElementPlacement.PLACEATEND);
            try { dup.locked = false; } catch (eL) {}
            dups.push(dup);
          }
          app.activeDocument = tempDoc;

          // 相対位置を保ったまま、全体の左上をアートボード左上に合わせる
          var db = null;
          for (var dj = 0; dj < dups.length; dj++) {
            var dvb = dups[dj].visibleBounds;
            if (!db) {
              db = [dvb[0], dvb[1]];
            } else {
              if (dvb[0] < db[0]) db[0] = dvb[0];
              if (dvb[1] > db[1]) db[1] = dvb[1];
            }
          }
          for (var dk = 0; dk < dups.length; dk++) {
            dups[dk].translate(0 - db[0], objH - db[1]);
          }

          // アートボードをアートワークにフィット
          var fitBounds = tempDoc.visibleBounds;
          if (fitBounds) {
            tempDoc.artboards[0].artboardRect = [fitBounds[0], fitBounds[1], fitBounds[2], fitBounds[3]];
          }

          // PNG/JPG はフィットさせたアートボードでクリップする。
          // SVG はアートボード書き出しにするとファイル名にアートボード名が付くため、
          // クリップなし（= 一時ドキュメント内の全アートワーク = 対象のみ）で書き出す
          exportOne(tempDoc, format === "svg" ? -1 : 0, outFile);
        } else {
          exportOne(doc, artboardIndex, outFile);
        }

        // SVG + artboard の場合のみ verifyOne でリネーム後のファイルを探す
        var actualPath = verifyOne(outputPath, (format === "svg" && targetType === "artboard") ? artboardIndex : -1, startMs);
        if (!actualPath) {
          writeResultFile(RESULT_PATH, { error: true, message: "Export completed but output file was not created. The path may not be writable: " + outputPath });
        } else {
          var resultInfo = { success: true, output_path: actualPath, format: format };
          if (targetType === "items") {
            resultInfo.item_count = exportItems.length;
          }
          if (format === "png" || format === "jpg") {
            resultInfo.dpi = (rasterOpts.dpi || 72) * scale;
            resultInfo.scale = scale;
          }
          writeResultFile(RESULT_PATH, resultInfo);
        }
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Export failed: " + e.message, line: e.line });
  } finally {
    // 一時ドキュメントを閉じ、元ドキュメントとアクティブアートボードを戻す（失敗時もリーク防止）
    if (tempDoc) {
      try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (eC) {}
    }
    if (doc) {
      try { app.activeDocument = doc; } catch (eA) {}
      if (prevActiveAb >= 0) {
        try { doc.artboards.setActiveArtboardIndex(prevActiveAb); } catch (eAb2) {}
      }
    }
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'export',
    {
      title: 'Export',
      description: 'Export objects, groups, artboards, or selection. Use target "artboard:all" to batch-export every artboard in one call. For single PNG/JPG exports, the exported image is returned as base64 in the response — you can view it directly without reading the file from disk ("artboard:all" returns file paths only; images larger than ~3.75MB are not inlined). An explicit output_path that already exists is not overwritten unless overwrite is true.',
      inputSchema: {
        target: z
          .string()
          .describe('UUID, "artboard:<index>", "artboard:all" (batch-export every artboard; filenames get "_<n>-<artboardName>" suffixes), or "selection". UUID and "selection" export only those objects, cropped to their visible bounds (they are duplicated into a temporary document; the clipboard and current selection are left untouched).'),
        // WebP is not supported by ExtendScript API
        // format: z.enum(['svg', 'png', 'webp', 'jpg']).describe('Export format'),
        format: z.enum(['svg', 'png', 'jpg']).describe('Export format'),
        output_path: z.string().optional().describe('Absolute output file path (SVG file names must be ASCII). If omitted, auto-generates a non-conflicting name in the same directory as the document (or ~/Desktop for unsaved documents)'),
        overwrite: coerceBoolean.optional().default(false).describe('Replace existing files at output_path (including "artboard:all" per-artboard files). Default false: returns an error listing the existing files'),
        scale: z.number().positive().optional().default(1).describe(`Scale factor for PNG/JPG (dpi × scale must be <= ${MAX_EFFECTIVE_DPI})`),
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
            dpi: z.number().positive().optional().describe('Resolution (DPI, default 72)'),
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
      const validationError = validateExportParams(params);
      if (validationError) {
        return formatToolResult({ error: true, message: validationError });
      }

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
      const result = await executeJsxHeavy(exportPathHelpersJsx + jsxCode, resolvedParams);

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
          const { size } = await stat(outputPath);
          if (size > MAX_INLINE_IMAGE_BYTES) {
            return formatToolResult({
              ...(result as Record<string, unknown>),
              image_omitted: `Image is ${(size / 1024 / 1024).toFixed(1)}MB, over the ${(MAX_INLINE_IMAGE_BYTES / 1024 / 1024).toFixed(2)}MB inline limit. It was saved to output_path but not included in this response. Export at a lower dpi/scale to preview it.`,
            });
          }
          const imageData = (await readFile(outputPath)).toString('base64');
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
              ...formatToolResult(result).content,
              visualCheckNote,
              { type: 'image' as const, data: imageData, mimeType },
            ],
          };
        } catch {
          // 画像読み込みに失敗してもテキスト結果は返す
        }
      }

      return formatToolResult(result);
    },
  );
}
