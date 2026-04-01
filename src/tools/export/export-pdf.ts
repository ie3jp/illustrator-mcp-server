import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS, coerceBoolean } from '../modify/shared.js';
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
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var outputPath = params.output_path;
    var preset = params.preset || "";

    // Default path generation when output_path is omitted
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

    // --- 日本式トンボ: TrimMark コマンドでドキュメント上に生成 ---
    // PDFSaveOptions.pageMarksType = PageMarksTypes.Japanese は
    // Illustrator バージョンによって正しく反映されない場合がある。
    // そのため日本式トンボはドキュメント上にパスとして生成し、
    // PDF にはアートワークの一部として書き出す（書き出し後に undo で除去）。
    var usedDocumentMarks = false;
    if (options.marks_style === "japanese" && options.trim_marks === true) {
      try {
        // 日本式トンボの preference を設定
        app.preferences.setBooleanPreference("cropMarkStyle", 1);

        // アクティブアートボードのサイズで一時矩形を作成
        var abIdx = doc.artboards.getActiveArtboardIndex();
        var abRect = doc.artboards[abIdx].artboardRect;
        var tempRect = doc.pathItems.rectangle(abRect[1], abRect[0], abRect[2] - abRect[0], abRect[1] - abRect[3]);
        tempRect.filled = false;
        tempRect.stroked = false;

        // 選択して TrimMark コマンドを実行
        doc.selection = null;
        tempRect.selected = true;
        try {
          app.executeMenuCommand("TrimMark v25");
        } catch (cmdErr) {
          app.executeMenuCommand("TrimMark");
        }

        // 一時矩形を削除
        try { tempRect.remove(); } catch (re) { /* consumed by command */ }
        doc.selection = null;

        usedDocumentMarks = true;
      } catch (tmErr) {
        // TrimMark コマンド失敗時は PDFSaveOptions にフォールバック
        usedDocumentMarks = false;
      }
    }

    var pdfOpts = new PDFSaveOptions();

    // Apply preset if specified
    if (preset !== "") {
      pdfOpts.pDFPreset = preset;
    } else {
      // プリセット未指定時のみデフォルト値を設定（プリセットの設定を上書きしない）
      pdfOpts.compatibility = PDFCompatibility.ACROBAT7;
      pdfOpts.preserveEditability = false;
    }

    // トンボ種類
    if (usedDocumentMarks) {
      // ドキュメント上にトンボを生成済み → PDF のマークは OFF
      pdfOpts.trimMarks = false;
    } else if (options.marks_style === "roman") {
      pdfOpts.pageMarksType = PageMarksTypes.Roman;
      if (options.trim_marks === true) {
        pdfOpts.trimMarks = true;
      } else {
        pdfOpts.trimMarks = false;
      }
    } else {
      // marks_style 未指定 or フォールバック
      if (options.marks_style === "japanese") {
        // TrimMark コマンド失敗時のフォールバック
        pdfOpts.pageMarksType = PageMarksTypes.Japanese;
      }
      if (options.trim_marks === true) {
        pdfOpts.trimMarks = true;
      } else {
        pdfOpts.trimMarks = false;
      }
    }

    // 日本式トンボ（PDFSaveOptions フォールバック時）の必須設定を自動適用
    if (options.marks_style === "japanese" && options.trim_marks === true && !usedDocumentMarks) {
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
      } else if (options.trim_marks === true) {
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

    // Bleed — ドキュメントマーク使用時も 3mm bleed を設定（トンボがアートボード外にあるため）
    if (options.bleed === true || usedDocumentMarks) {
      var bleedPt = 8.504;
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

    var outFile = new File(outputPath);
    var parentFolder = outFile.parent;
    if (!parentFolder.exists) {
      writeResultFile(RESULT_PATH, { error: true, message: "Output directory does not exist: " + parentFolder.fsName });
    } else {
      doc.saveAs(outFile, pdfOpts);

      // ドキュメント上に生成したトンボを undo で除去（ドキュメントを元の状態に戻す）
      if (usedDocumentMarks) {
        // TrimMark 作成 + tempRect 削除 の 2 操作分を undo
        app.executeMenuCommand("undo");
        app.executeMenuCommand("undo");
        app.executeMenuCommand("undo");
      }

      // エクスポート後にファイル存在を検証
      var verifyFile = new File(outputPath);
      if (!verifyFile.exists) {
        writeResultFile(RESULT_PATH, { error: true, message: "PDF export completed but output file was not created. The path may not be writable: " + outputPath });
      } else {
        var result = { success: true, output_path: outputPath };
        if (usedDocumentMarks) {
          result.japanese_marks_method = "document_trimmark";
          result.japanese_marks_note = "Japanese crop marks were generated as document paths via TrimMark command for reliable rendering, then removed after export.";
        }
        writeResultFile(RESULT_PATH, result);
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "PDF export failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'export_pdf',
    {
      title: 'Export PDF',
      description: 'Export print-ready PDF. Note: Illustrator will be activated (brought to foreground) during execution. The exported PDF should be verified by a human before final submission.',
      inputSchema: {
        output_path: z.string().optional().describe('Output file path. If omitted, auto-generates in the same directory as the document (or ~/Desktop for unsaved documents)'),
        preset: z
          .string()
          .optional()
          .describe('PDF preset name (e.g. "[PDF/X-4:2008]")'),
        options: z
          .object({
            trim_marks: coerceBoolean.optional().describe('Add trim marks'),
            marks_style: z.enum(['japanese', 'roman']).optional().describe('Trim mark style (japanese or roman)'),
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
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsxHeavy(jsxCode, params);
      const output = {
        ...result,
        _note: 'PDF exported. This file should be verified by a human before final print submission — automated checks cannot catch all print-critical issues.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    },
  );
}
