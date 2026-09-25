import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS, coerceBoolean } from '../modify/shared.js';
import { CROP_MARKS_JSX } from '../crop-marks-shared.js';
import { checkAbsoluteOutputPath, resolveOutputPath } from '../../utils/output-path.js';

function requiresMenuCommandActivation(params: {
  options?: { marks_style?: string; trim_marks?: boolean };
}): boolean {
  // JSX の wantsJapaneseDocMarks と同じ条件。変更時は双方を更新する
  return params.options?.marks_style === 'japanese' && params.options.trim_marks === true;
}

/**
 * export_pdf — PDF 書き出し
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — Document.saveAs()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PDFSaveOptions/ — PDFSaveOptions
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  // 日本式トンボ用にドキュメントへ加えた変更（トンボ・アートボード拡張・環境設定・選択）は
  // 書き出しの成否や途中の例外にかかわらず finally で必ず元に戻す
  var doc = null;
  var cmState = null;
  var trimMarkGroups = [];
  var expandedAbIdx = -1;
  var origAbRect = null;
  try {
    var params = readParamsFile(PARAMS_PATH);
    doc = app.activeDocument;
    var outputPath = params.output_path;
    var preset = params.preset || "";

    if (!outputPath) {
      var dir;
      try {
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
      var sep = Folder.fs === 'Windows' ? '\\\\' : '/';
      outputPath = dir + sep + baseName + '.pdf';
      var counter = 2;
      while (new File(outputPath).exists) {
        outputPath = dir + sep + baseName + '_' + counter + '.pdf';
        counter++;
      }
    }
    var options = params.options || {};
    // TS の requiresMenuCommandActivation() と同期すること
    var wantsJapaneseDocMarks = (options.marks_style === "japanese" && options.trim_marks === true);

    // --- 事前検証（ドキュメントに手を入れる前に行う） ---
    var validationError = null;
    var outFile = new File(outputPath);
    var parentFolder = outFile.parent;
    if (!parentFolder.exists) {
      validationError = "Output directory does not exist: " + parentFolder.fsName;
    }
    if (!validationError && preset !== "") {
      // 存在しない preset 名は saveAs 時に黙って無視/失敗しうるため、app.PDFPresetsList で検証する
      var presetList = null;
      try { presetList = app.PDFPresetsList; } catch (plErr) { presetList = null; }
      if (presetList && presetList.length > 0) {
        var presetFound = false;
        var presetNames = "";
        for (var pi = 0; pi < presetList.length; pi++) {
          if (presetList[pi] === preset) { presetFound = true; break; }
          presetNames += (pi > 0 ? ", " : "") + presetList[pi];
        }
        if (!presetFound) {
          validationError = "PDF preset not found: \\"" + preset + "\\". Available presets: " + presetNames;
        }
      }
    }
    if (!validationError && wantsJapaneseDocMarks && doc.artboards.length > 1) {
      // 日本式トンボは 1 アートボード分だけ生成・拡張する方式のため、複数アートボードでは
      // 「トンボも紙サイズ変更も 1 ページだけ」の不整合な PDF になる。黙って出さずエラーにする
      validationError = "Japanese trim marks (marks_style: \\"japanese\\" + trim_marks: true) are not supported for documents with multiple artboards (" +
        doc.artboards.length + " artboards): marks would be added to only one page. " +
        "Use marks_style: \\"roman\\" (PDF-generated marks on every page), a print preset that includes trim marks, " +
        "or export a single-artboard document.";
    }

    if (validationError) {
      writeResultFile(RESULT_PATH, { error: true, message: validationError });
    } else {
      // --- 日本式トンボ: TrimMark コマンドでドキュメント上に生成 ---
      // pageMarksType = Japanese はバージョンによって正しく反映されないため、
      // パスとして生成しアートボードを一時拡張して PDF に含める（書き出し後に復元）
      var usedDocumentMarks = false;
      var documentMarksError = null;
      if (wantsJapaneseDocMarks) {
        cmState = cropMarksSaveState(doc);
        try {
          app.preferences.setBooleanPreference("cropMarkStyle", true);

          var abIdx = doc.artboards.getActiveArtboardIndex();
          var abRect = doc.artboards[abIdx].artboardRect.slice();
          trimMarkGroups = cropMarksRun(doc, abRect);
          if (trimMarkGroups.length === 0) {
            throw new Error("TrimMark command produced no marks");
          }

          // トンボが収まるようにアートボードを一時拡張
          var mb = cropMarksUnionBounds(trimMarkGroups);
          expandedAbIdx = abIdx;
          origAbRect = abRect;
          doc.artboards[abIdx].artboardRect = [mb[0] - 1, mb[1] + 1, mb[2] + 1, mb[3] - 1];

          usedDocumentMarks = true;
        } catch (tmErr) {
          // TrimMark 失敗時は生成物とアートボードを戻し、PDFSaveOptions にフォールバック
          documentMarksError = tmErr.message;
          cropMarksRemove(trimMarkGroups);
          trimMarkGroups = [];
          if (origAbRect) {
            try { doc.artboards[expandedAbIdx].artboardRect = origAbRect; } catch (restoreErr) {}
          }
          expandedAbIdx = -1;
          origAbRect = null;
          usedDocumentMarks = false;
        }
      }

      var pdfOpts = new PDFSaveOptions();

      if (preset !== "") {
        pdfOpts.pDFPreset = preset;
      } else {
        // プリセット未指定時のみデフォルト値を設定（プリセットの設定を上書きしない）
        pdfOpts.compatibility = PDFCompatibility.ACROBAT7;
        pdfOpts.preserveEditability = false;
      }

      // preset 指定時、明示されなかったトンボ設定は preset のまま残す（印刷所支給プリセットを黙って消さない）
      if (usedDocumentMarks) {
        // ドキュメント上にトンボを生成済み → PDF のマークは OFF（二重トンボ防止）
        pdfOpts.trimMarks = false;
      } else {
        if (options.marks_style === "roman") {
          pdfOpts.pageMarksType = PageMarksTypes.Roman;
        } else if (options.marks_style === "japanese") {
          // TrimMark コマンド失敗時のフォールバック
          pdfOpts.pageMarksType = PageMarksTypes.Japanese;
        }
        if (typeof options.trim_marks === "boolean") {
          pdfOpts.trimMarks = options.trim_marks;
        } else if (preset === "") {
          pdfOpts.trimMarks = false;
        }
      }

      // 日本式トンボ（PDFSaveOptions フォールバック時）の必須設定を自動適用
      if (wantsJapaneseDocMarks && !usedDocumentMarks) {
        if (typeof options.registration_marks === "undefined") {
          pdfOpts.registrationMarks = true;
        }
        if (options.bleed !== true) {
          var bleedPt = 8.504; // 3mm
          pdfOpts.bleedOffsetRect = [bleedPt, bleedPt, bleedPt, bleedPt];
        }
      }

      // トンボの太さ（文字列・数値両対応） — ドキュメントマーク時は不要
      if (!usedDocumentMarks) {
        var tw = String(options.trim_mark_weight);
        if (tw === "0.125") {
          pdfOpts.trimMarkWeight = PDFTrimMarkWeight.TRIMMARKWEIGHT0125;
        } else if (tw === "0.25") {
          pdfOpts.trimMarkWeight = PDFTrimMarkWeight.TRIMMARKWEIGHT025;
        } else if (tw === "0.5") {
          pdfOpts.trimMarkWeight = PDFTrimMarkWeight.TRIMMARKWEIGHT05;
        } else if (options.trim_marks === true && preset === "") {
          pdfOpts.trimMarkWeight = PDFTrimMarkWeight.TRIMMARKWEIGHT0125;
        }
      }

      // レジストレーションマーク
      if (typeof options.registration_marks !== "undefined") {
        pdfOpts.registrationMarks = options.registration_marks;
      }

      // カラーバー
      if (typeof options.color_bars !== "undefined") {
        pdfOpts.colorBars = options.color_bars;
      }

      // ページ情報
      if (typeof options.page_information !== "undefined") {
        pdfOpts.pageInformation = options.page_information;
      }

      // Bleed — ドキュメントマーク時はアートボード拡張済みなので bleed 不要
      if (options.bleed === true && !usedDocumentMarks) {
        var bleedPt = 8.504; // 3mm
        pdfOpts.bleedOffsetRect = [bleedPt, bleedPt, bleedPt, bleedPt];
      }

      // Downsample images
      if (typeof options.color_downsample_dpi === "number" || typeof options.grayscale_downsample_dpi === "number" || typeof options.monochrome_downsample_dpi === "number") {
        // Selective downsampling per image type
        var colorDpi = (typeof options.color_downsample_dpi === "number") ? options.color_downsample_dpi : 300;
        pdfOpts.colorDownsamplingMethod = DownsampleMethod.BICUBICDOWNSAMPLE;
        pdfOpts.colorDownsampling = colorDpi;
        pdfOpts.colorDownsamplingImageThreshold = Math.round(colorDpi * 1.5);

        var grayDpi = (typeof options.grayscale_downsample_dpi === "number") ? options.grayscale_downsample_dpi : 300;
        pdfOpts.grayscaleDownsamplingMethod = DownsampleMethod.BICUBICDOWNSAMPLE;
        pdfOpts.grayscaleDownsampling = grayDpi;
        pdfOpts.grayscaleDownsamplingImageThreshold = Math.round(grayDpi * 1.5);

        var monoDpi = (typeof options.monochrome_downsample_dpi === "number") ? options.monochrome_downsample_dpi : 1200;
        pdfOpts.monochromeDownsamplingMethod = DownsampleMethod.BICUBICDOWNSAMPLE;
        pdfOpts.monochromeDownsampling = monoDpi;
        pdfOpts.monochromeDownsamplingImageThreshold = Math.round(monoDpi * 1.5);
      } else if (options.downsample === true) {
        pdfOpts.colorDownsamplingMethod = DownsampleMethod.BICUBICDOWNSAMPLE;
        pdfOpts.colorDownsampling = 300;
        pdfOpts.colorDownsamplingImageThreshold = 450;
        pdfOpts.grayscaleDownsamplingMethod = DownsampleMethod.BICUBICDOWNSAMPLE;
        pdfOpts.grayscaleDownsampling = 300;
        pdfOpts.grayscaleDownsamplingImageThreshold = 450;
        pdfOpts.monochromeDownsamplingMethod = DownsampleMethod.BICUBICDOWNSAMPLE;
        pdfOpts.monochromeDownsampling = 1200;
        pdfOpts.monochromeDownsamplingImageThreshold = 1800;
      } else if (options.downsample === false) {
        pdfOpts.colorDownsamplingMethod = DownsampleMethod.NODOWNSAMPLE;
        pdfOpts.grayscaleDownsamplingMethod = DownsampleMethod.NODOWNSAMPLE;
        pdfOpts.monochromeDownsamplingMethod = DownsampleMethod.NODOWNSAMPLE;
      }

      // Output intent ICC profile (version-dependent, may not be available)
      if (typeof options.output_intent_profile === "string" && options.output_intent_profile !== "") {
        try {
          pdfOpts.outputIntentProfile = options.output_intent_profile;
        } catch(e) {
          // outputIntentProfile not supported in this Illustrator version
        }
      }

      var saveError = null;
      try {
        doc.saveAs(outFile, pdfOpts);
      } catch (saveErr) {
        saveError = saveErr;
      }

      if (saveError) {
        writeResultFile(RESULT_PATH, { error: true, message: "PDF export failed: " + saveError.message, line: saveError.line });
      } else {
        // エクスポート後にファイル存在を検証
        var verifyFile = new File(outputPath);
        if (!verifyFile.exists) {
          writeResultFile(RESULT_PATH, { error: true, message: "PDF export completed but output file was not created. The path may not be writable: " + outputPath });
        } else {
          var result = { success: true, output_path: outputPath };
          if (usedDocumentMarks) {
            result.japanese_marks_method = "document_trimmark";
            result.japanese_marks_note = "Japanese crop marks were generated as document paths via TrimMark command for reliable rendering, then removed after export.";
          } else if (wantsJapaneseDocMarks) {
            result.japanese_marks_method = "pdf_page_marks";
            result.japanese_marks_note = "TrimMark command failed (" + documentMarksError + "), so Japanese marks were requested via PDF export options instead. Verify the marks in the PDF.";
          }
          writeResultFile(RESULT_PATH, result);
        }
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "PDF export failed: " + e.message, line: e.line });
  } finally {
    // ドキュメントを元の状態に復元（生成したトンボだけを削除し、アートボード・環境設定・選択を戻す）
    cropMarksRemove(trimMarkGroups);
    if (origAbRect && expandedAbIdx >= 0) {
      try { doc.artboards[expandedAbIdx].artboardRect = origAbRect; } catch (restoreErr) {}
    }
    if (doc && cmState) cropMarksRestoreState(doc, cmState);
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'export_pdf',
    {
      title: 'Export PDF',
      description:
        'Export print-ready PDF. ' +
        'Japanese trim marks (marks_style "japanese" + trim_marks) are drawn temporarily on the document and removed after export; ' +
        'they are only supported for single-artboard documents (multi-artboard documents return an error). ' +
        'When a preset is given, trim mark settings you do not specify are kept from the preset. ' +
        'Note: Illustrator will be activated (brought to foreground) only when generating Japanese trim marks. The exported PDF should be verified by a human before final submission.',
      inputSchema: {
        output_path: z.string().optional().describe('Absolute output file path. If omitted, auto-generates a non-conflicting name in the same directory as the document (or ~/Desktop for unsaved documents)'),
        preset: z
          .string()
          .optional()
          .describe('PDF preset name (e.g. "[PDF/X-4:2008]"). Must exist in Illustrator\'s PDF presets, otherwise an error listing available presets is returned.'),
        options: z
          .object({
            trim_marks: coerceBoolean.optional().describe('Add trim marks. If omitted with a preset, the preset\'s setting is kept.'),
            marks_style: z.enum(['japanese', 'roman']).optional().describe('Trim mark style (japanese or roman). Japanese + trim_marks requires a single-artboard document.'),
            trim_mark_weight: z.enum(['0.125', '0.25', '0.5']).optional().describe('Trim mark weight (pt)'),
            registration_marks: coerceBoolean.optional().describe('Registration marks'),
            color_bars: coerceBoolean.optional().describe('Color bars'),
            page_information: coerceBoolean.optional().describe('Page information'),
            bleed: coerceBoolean.optional().describe('Include bleed (3mm)'),
            downsample: coerceBoolean.optional().describe('Downsample all images (shorthand: color 300dpi, grayscale 300dpi, monochrome 1200dpi)'),
            color_downsample_dpi: z.number().int().min(72).optional().describe('Color image downsample target DPI (overrides downsample)'),
            grayscale_downsample_dpi: z.number().int().min(72).optional().describe('Grayscale image downsample target DPI (overrides downsample)'),
            monochrome_downsample_dpi: z.number().int().min(72).optional().describe('Monochrome image downsample target DPI (overrides downsample)'),
            output_intent_profile: z.string().optional().describe('Output intent ICC profile name (e.g. "Japan Color 2001 Coated"). Version-dependent feature.'),
          })
          .optional()
          .describe('PDF export options'),
      },
      // 明示した output_path の既存ファイルは確認なしで置き換わる。省略時は毎回別名で新規作成するため冪等でもない
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params };
      if (resolvedParams.output_path !== undefined) {
        const pathError = checkAbsoluteOutputPath(resolvedParams.output_path, 'output_path');
        if (pathError) return formatToolResult({ error: true, message: pathError });
        // シンボリックリンク経由のディレクトリ（macOS の /tmp 等）は実パスに解決してから渡す
        resolvedParams.output_path = resolveOutputPath(resolvedParams.output_path);
      }
      const result = await executeJsxHeavy(CROP_MARKS_JSX + jsxCode, resolvedParams, {
        activate: requiresMenuCommandActivation(params),
      });
      const output = {
        ...result,
        _note: 'PDF exported. This file should be verified by a human before final print submission — automated checks cannot catch all print-critical issues.',
      };
      return formatToolResult(output);
    },
  );
}
