import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';
import { resolveCoordinateSystem } from '../session.js';
import { CROP_MARKS_JSX } from '../crop-marks-shared.js';

/**
 * create_crop_marks — トリムマーク（トンボ）の作成
 *
 * Illustrator の「トリムマークを作成」コマンド（TrimMark v25）を使い、
 * アクティブなアートボード or 選択オブジェクトにトンボを生成する。
 *
 * ■ アートボードモード（デフォルト）
 *   アートボードぴったりのサイズで作成しているケースを想定。
 *   トンボ生成後、トンボが収まるようにアートボードを拡張する。
 *
 * ■ 選択オブジェクトモード（use_selection: true）
 *   ユーザが選択したオブジェクトに対してトンボを生成。
 *   アートボードは変更しない。
 *
 * locale パラメータからユーザの国を推定し、日本式／西洋式を自動切替する。
 * - 日本 (ja) → 日本式トンボ（二重線、3mm 塗り足し表示）
 * - その他 → 西洋式トンボ（一重線）
 *
 * 生成物の特定・環境設定/選択/アクティブアートボードの復元は crop-marks-shared.ts を参照。
 * 失敗時は生成済みトンボとアートボード拡張を取り消す（transaction）。
 *
 * @see https://note.com/dtp_tranist/n/n40e3e39cf9f2
 * JSX API: app.executeMenuCommand('TrimMark v25'), app.preferences.setBooleanPreference('cropMarkStyle', ...)
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  // transaction: 結果を書き出すまで committed=false。失敗時は生成物とアートボード拡張を戻す。
  // 環境設定・選択・アクティブアートボードは成否にかかわらず finally で復元する。
  var doc = null;
  var cmState = null;
  var createdMarks = [];
  var committed = false;
  var expandedAb = null;
  var expandedAbOrigRect = null;
  try {
    var params = readParamsFile(PARAMS_PATH);
    doc = app.activeDocument;
    var useSelection = params.use_selection === true;
    var coordSystem = params.coordinate_system || "artboard-web";

    // --- Determine crop mark style ---
    var style = params.style || "auto";
    var locale = params.locale || "";
    var resolvedStyle = "western";

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
      if (!locale) {
        try {
          var aiLocale = app.locale;
          if (aiLocale && aiLocale.toLowerCase().indexOf("ja") === 0) {
            resolvedStyle = "japanese";
          }
        } catch (e) {}
      }
    }

    // 書き換える前に環境設定・選択・アクティブアートボードを保存
    cmState = cropMarksSaveState(doc);
    app.preferences.setBooleanPreference("cropMarkStyle", resolvedStyle === "japanese");

    if (useSelection) {
      // --- 選択オブジェクトモード ---
      var sel = doc.selection;
      if (!sel || sel.length === 0) {
        writeResultFile(RESULT_PATH, { error: true, message: "No objects selected. Select one or more objects to create crop marks for." });
      } else {
        createdMarks = cropMarksRun(doc, null);
        if (createdMarks.length === 0) {
          writeResultFile(RESULT_PATH, { error: true, message: "TrimMark command ran but created no marks. The selected object may not be suitable for crop marks." });
        } else {
        var styleName = (resolvedStyle === "japanese") ? "Japanese (日本式トンボ)" : "Western (西洋式トンボ)";
        writeResultFile(RESULT_PATH, {
          success: true,
          mode: "selection",
          crop_mark_style: resolvedStyle,
          style_display_name: styleName,
          mark_groups_created: createdMarks.length,
          artboard_modified: false,
          description: "Crop marks created for the selected object(s). Artboard was not modified."
        });
        committed = true;
        }
      }
    } else {
      // --- アートボードモード ---
      var abIndex = (typeof params.artboard_index === "number") ? params.artboard_index : doc.artboards.getActiveArtboardIndex();
      if (abIndex < 0 || abIndex >= doc.artboards.length) {
        writeResultFile(RESULT_PATH, { error: true, message: "Invalid artboard index: " + abIndex });
      } else {
        var ab = doc.artboards[abIndex];
        var origAbRect = ab.artboardRect.slice(); // 仕上がり線（拡張前のアートボード矩形）
        var abWidth = origAbRect[2] - origAbRect[0];
        var abHeight = origAbRect[1] - origAbRect[3];

        doc.artboards.setActiveArtboardIndex(abIndex);
        createdMarks = cropMarksRun(doc, origAbRect);

        if (createdMarks.length === 0) {
          writeResultFile(RESULT_PATH, { error: true, message: "TrimMark command ran but created no marks." });
        } else {
        // トンボ全体の外接矩形まで拡張（少し余裕を持たせる: 1pt）
        var mb = cropMarksUnionBounds(createdMarks);
        expandedAb = ab;
        expandedAbOrigRect = origAbRect;
        ab.artboardRect = [mb[0] - 1, mb[1] + 1, mb[2] + 1, mb[3] - 1];

        var newAbRect = ab.artboardRect;

        // 仕上がり線を find_objects の bounds と同じ形式・座標系で返す。
        // artboard-web は「オブジェクトが載っているアートボード（＝拡張後）」の左上が原点
        var trimRect;
        if (coordSystem === "document") {
          trimRect = { x: origAbRect[0], y: origAbRect[1], width: abWidth, height: abHeight };
        } else {
          trimRect = {
            x: origAbRect[0] - newAbRect[0],
            y: -(origAbRect[1] - newAbRect[1]),
            width: abWidth,
            height: abHeight
          };
        }

        var styleName = (resolvedStyle === "japanese") ? "Japanese (日本式トンボ)" : "Western (西洋式トンボ)";
        var detectionMethod = "";
        if (style === "japanese" || style === "western") {
          detectionMethod = "explicitly specified";
        } else if (locale) {
          detectionMethod = "detected from locale: " + locale;
        } else {
          detectionMethod = "detected from Illustrator locale";
        }

        var bleedNote = "ACTION REQUIRED — Bleed (塗り足し): You MUST do this now, without asking the user. " +
          "The trim line (仕上がり線) is original_artboard_rect = {x: " + trimRect.x + ", y: " + trimRect.y + ", width: " + abWidth + ", height: " + abHeight + "} pt " +
          "(the artboard BEFORE it was expanded for the crop marks, in the same format and coordinate system as find_objects bounds). " +
          "Do NOT treat the current artboard bounds (get_artboards) as the trim line: the artboard now includes the crop marks and is larger than the finished size. " +
          "Step 1: Call find_objects to list all design objects (exclude the crop mark groups) and compare each object's bounds against original_artboard_rect. " +
          "Step 2: For every object whose edge touches or nearly touches the trim line, use modify_object to extend that edge outward by at least 3 mm (8.5 pt). Do NOT move or scale the design — just stretch the touching edge outward. For background rectangles, extend all four sides. " +
          "Why: The trim marks show where the paper is physically cut. If an object stops at the trim line, cutting produces a white gap. Extending past ensures full bleed coverage.";

        writeResultFile(RESULT_PATH, {
          success: true,
          mode: "artboard",
          crop_mark_style: resolvedStyle,
          style_display_name: styleName,
          detection_method: detectionMethod,
          mark_groups_created: createdMarks.length,
          artboard_index: abIndex,
          artboard_name: ab.name,
          artboard_modified: true,
          original_artboard_size: { width: abWidth, height: abHeight },
          original_artboard_rect: trimRect,
          new_artboard_size: {
            width: newAbRect[2] - newAbRect[0],
            height: newAbRect[1] - newAbRect[3]
          },
          bleed_required: bleedNote,
          description: (resolvedStyle === "japanese")
            ? "Japanese crop marks created. Artboard expanded to include all marks. See bleed_required for next steps."
            : "Western crop marks created. Artboard expanded to include all marks. See bleed_required for next steps."
        });
        committed = true;
        }
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create crop marks: " + e.message, line: e.line });
  } finally {
    if (!committed) {
      cropMarksRemove(createdMarks);
      if (expandedAb) {
        try { expandedAb.artboardRect = expandedAbOrigRect; } catch (restoreErr) {}
      }
    }
    if (doc) cropMarksRestoreState(doc, cmState);
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_crop_marks',
    {
      title: 'Create Crop Marks (トンボ)',
      description:
        'Create crop marks (トンボ / trim marks) on the active artboard or selected objects. ' +
        'By default, creates marks for the artboard and expands the artboard to include all marks; ' +
        'the original (trim) rectangle is returned as original_artboard_rect. ' +
        'With use_selection=true, creates marks for the currently selected object(s) without modifying the artboard. ' +
        'Automatically selects Japanese-style (日本式) or Western-style crop marks based on locale. ' +
        'The Illustrator crop mark style preference, selection and active artboard are restored afterwards. ' +
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
        use_selection: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'If true, create crop marks for the currently selected object(s) instead of the artboard. ' +
            'The artboard will NOT be modified. If false (default), creates marks for the artboard and expands it to fit.',
          ),
        artboard_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Target artboard index (0-based). Defaults to the currently active artboard. Ignored when use_selection is true.'),
      },
      // 既定ではアートボードをトンボの外周まで広げる（既存のアートボード寸法を書き換える）
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      // original_artboard_rect を find_objects と同じ座標系で返すため、先に座標系を解決して JSX に渡す
      const coordSystem = await resolveCoordinateSystem(undefined);
      const result = await executeToolJsx(
        CROP_MARKS_JSX + jsxCode,
        { ...params, coordinate_system: coordSystem },
        { activate: true },
      );
      const coordNote =
        coordSystem === 'document'
          ? 'document (Y-up, origin at bottom-left)'
          : 'artboard-web (Y-down, origin at top-left)';
      for (const item of result.content) {
        if (item.type === 'text') {
          try {
            const parsed = JSON.parse(item.text);
            if (parsed.bleed_required) {
              parsed.activeCoordinateSystem = coordSystem;
              parsed.bleed_required =
                `NOTE: The active coordinate system is ${coordNote}. All tools (get_artboards, find_objects, modify_object) use this system. ` +
                parsed.bleed_required;
              item.text = JSON.stringify(parsed);
            }
          } catch {
            // not JSON, skip
          }
        }
      }
      return result;
    },
  );
}
