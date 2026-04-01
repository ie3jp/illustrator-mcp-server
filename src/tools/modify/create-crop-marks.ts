import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * create_crop_marks — トリムマーク（トンボ）の作成
 *
 * Illustrator の「トリムマークを作成」コマンド（TrimMark v25）を使い、
 * アクティブなアートボードにトンボを生成する。
 *
 * locale パラメータからユーザの国を推定し、日本式／西洋式を自動切替する。
 * - 日本 (ja) → 日本式トンボ（二重線、3mm 塗り足し表示）
 * - その他 → 西洋式トンボ（一重線）
 *
 * @see https://note.com/dtp_tranist/n/n40e3e39cf9f2
 * JSX API: app.executeMenuCommand('TrimMark v25'), app.preferences.setBooleanPreference('cropMarkStyle', ...)
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    // --- Determine crop mark style ---
    var style = params.style || "auto";
    var locale = params.locale || "";
    var resolvedStyle = "western";

    // Locales that use Japanese-style crop marks
    var japaneseLocales = ["ja", "ja-jp", "ja_jp"];

    if (style === "japanese") {
      resolvedStyle = "japanese";
    } else if (style === "western") {
      resolvedStyle = "western";
    } else {
      // auto: detect from locale
      var localeLower = locale.toLowerCase().replace(/_/g, "-");
      for (var i = 0; i < japaneseLocales.length; i++) {
        if (localeLower === japaneseLocales[i] || localeLower.indexOf("ja") === 0) {
          resolvedStyle = "japanese";
          break;
        }
      }
      // If no locale provided, try Illustrator's own locale
      if (!locale) {
        try {
          var aiLocale = app.locale;
          if (aiLocale && aiLocale.toLowerCase().indexOf("ja") === 0) {
            resolvedStyle = "japanese";
          }
        } catch (e) { /* locale not available in older versions */ }
      }
    }

    // Set crop mark style preference
    if (resolvedStyle === "japanese") {
      app.preferences.setBooleanPreference("cropMarkStyle", 1);
    } else {
      app.preferences.setBooleanPreference("cropMarkStyle", 0);
    }

    // --- Determine target artboard ---
    var abIndex = (typeof params.artboard_index === "number") ? params.artboard_index : doc.artboards.getActiveArtboardIndex();
    if (abIndex < 0 || abIndex >= doc.artboards.length) {
      writeResultFile(RESULT_PATH, { error: true, message: "Invalid artboard index: " + abIndex });
    } else {
      var ab = doc.artboards[abIndex];
      var abRect = ab.artboardRect; // [left, top, right, bottom]
      var abLeft = abRect[0];
      var abTop = abRect[1];
      var abRight = abRect[2];
      var abBottom = abRect[3];
      var abWidth = abRight - abLeft;
      var abHeight = abTop - abBottom; // top > bottom in AI coords

      // --- Create a temporary rectangle matching the artboard ---
      var tempRect = doc.pathItems.rectangle(abTop, abLeft, abWidth, abHeight);
      tempRect.filled = false;
      tempRect.stroked = false;

      // Activate the target artboard
      doc.artboards.setActiveArtboardIndex(abIndex);

      // Select the temporary rectangle
      doc.selection = null;
      tempRect.selected = true;

      // Execute the Trim Mark command (try v25 first, fallback to legacy)
      try {
        app.executeMenuCommand("TrimMark v25");
      } catch (cmdErr) {
        app.executeMenuCommand("TrimMark");
      }

      // The TrimMark command creates a new group with the crop marks.
      // Remove the temporary rectangle (it's still referenced).
      try { tempRect.remove(); } catch (removeErr) { /* already consumed by command */ }

      // Deselect all
      doc.selection = null;

      // Build report
      var styleName = (resolvedStyle === "japanese") ? "Japanese (日本式トンボ)" : "Western (西洋式トンボ)";
      var detectionMethod = "";
      if (style === "japanese" || style === "western") {
        detectionMethod = "explicitly specified";
      } else if (locale) {
        detectionMethod = "detected from locale: " + locale;
      } else {
        detectionMethod = "detected from Illustrator locale";
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        crop_mark_style: resolvedStyle,
        style_display_name: styleName,
        detection_method: detectionMethod,
        artboard_index: abIndex,
        artboard_name: ab.name,
        artboard_size: {
          width: abWidth,
          height: abHeight
        },
        description: (resolvedStyle === "japanese")
          ? "Japanese crop marks created with double lines (inner + outer marks at 3mm bleed). Includes corner marks and center marks."
          : "Western crop marks created with single lines. Corner marks indicate trim position only."
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create crop marks: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_crop_marks',
    {
      title: 'Create Crop Marks (トンボ)',
      description:
        'Create crop marks (トンボ / trim marks) on the active artboard using Illustrator\'s built-in TrimMark command. ' +
        'Automatically selects Japanese-style (日本式) or Western-style crop marks based on locale. ' +
        'Japanese marks use double lines showing 3mm bleed; Western marks use single lines. ' +
        'Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        style: z
          .enum(['auto', 'japanese', 'western'])
          .optional()
          .default('auto')
          .describe(
            'Crop mark style. "japanese" = double-line marks with 3mm bleed indication (日本式トンボ). ' +
            '"western" = single-line marks (西洋式トンボ). ' +
            '"auto" = detect from locale parameter or Illustrator locale.',
          ),
        locale: z
          .string()
          .optional()
          .describe(
            'User locale (e.g. "ja", "ja-JP", "en-US", "de-DE"). Used to auto-detect crop mark style when style is "auto". ' +
            'Japanese locales (ja*) → Japanese marks, others → Western marks. ' +
            'If omitted, falls back to Illustrator\'s own locale setting.',
          ),
        artboard_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Target artboard index (0-based). Defaults to the currently active artboard.'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true });
    },
  );
}
