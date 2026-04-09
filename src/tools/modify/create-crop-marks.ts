import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { WRITE_ANNOTATIONS } from './shared.js';
import { resolveCoordinateSystem } from '../session.js';

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
    var useSelection = params.use_selection === true;

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

    // Set crop mark style preference
    app.preferences.setBooleanPreference("cropMarkStyle", resolvedStyle === "japanese");

    if (useSelection) {
      // --- 選択オブジェクトモード ---
      var sel = doc.selection;
      if (!sel || sel.length === 0) {
        writeResultFile(RESULT_PATH, { error: true, message: "No objects selected. Select one or more objects to create crop marks for." });
      } else {
        var groupCountBefore = doc.groupItems.length;

        executeTrimMark();
        doc.selection = null;

        var newGroups = doc.groupItems.length - groupCountBefore;
        if (newGroups === 0) {
          writeResultFile(RESULT_PATH, { error: true, message: "TrimMark command ran but created no marks. The selected object may not be suitable for crop marks." });
        } else {
        var styleName = (resolvedStyle === "japanese") ? "Japanese (日本式トンボ)" : "Western (西洋式トンボ)";
        writeResultFile(RESULT_PATH, {
          success: true,
          mode: "selection",
          crop_mark_style: resolvedStyle,
          style_display_name: styleName,
          mark_groups_created: newGroups,
          artboard_modified: false,
          description: "Crop marks created for the selected object(s). Artboard was not modified."
        });
        }
      }
    } else {
      // --- アートボードモード ---
      var abIndex = (typeof params.artboard_index === "number") ? params.artboard_index : doc.artboards.getActiveArtboardIndex();
      if (abIndex < 0 || abIndex >= doc.artboards.length) {
        writeResultFile(RESULT_PATH, { error: true, message: "Invalid artboard index: " + abIndex });
      } else {
        var ab = doc.artboards[abIndex];
        var abRect = ab.artboardRect;
        var origAbRect = abRect.slice(); // 元のアートボード矩形を保存
        var abWidth = abRect[2] - abRect[0];
        var abHeight = abRect[1] - abRect[3];

        // アートボードサイズの一時矩形を作成
        var tempRect = doc.pathItems.rectangle(abRect[1], abRect[0], abWidth, abHeight);
        tempRect.filled = false;
        tempRect.stroked = false;

        doc.artboards.setActiveArtboardIndex(abIndex);

        var groupCountBefore = doc.groupItems.length;

        doc.selection = null;
        tempRect.selected = true;

        executeTrimMark();

        try { tempRect.remove(); } catch (removeErr) {}
        doc.selection = null;

        // トンボグループの参照を取得
        var newGroupCount = doc.groupItems.length - groupCountBefore;
        if (newGroupCount === 0) {
          writeResultFile(RESULT_PATH, { error: true, message: "TrimMark command ran but created no marks." });
        } else {
        var trimMarkGroups = [];
        for (var g = 0; g < newGroupCount; g++) {
          trimMarkGroups.push(doc.groupItems[g]);
        }

        // トンボ全体の外接矩形を計算してアートボードを拡張
        if (trimMarkGroups.length > 0) {
          var mb = trimMarkGroups[0].geometricBounds.slice();
          for (var g = 1; g < trimMarkGroups.length; g++) {
            var gb = trimMarkGroups[g].geometricBounds;
            if (gb[0] < mb[0]) mb[0] = gb[0];
            if (gb[1] > mb[1]) mb[1] = gb[1];
            if (gb[2] > mb[2]) mb[2] = gb[2];
            if (gb[3] < mb[3]) mb[3] = gb[3];
          }
          // アートボードをトンボが収まるサイズに拡張（少し余裕を持たせる: 1pt）
          ab.artboardRect = [mb[0] - 1, mb[1] + 1, mb[2] + 1, mb[3] - 1];
        }

        var newAbRect = ab.artboardRect;
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
          "Step 1: Call get_artboards to get the current artboard bounds — this tells you where the trim line is. " +
          "Step 2: Call find_objects to list all design objects (exclude the crop mark groups). Compare each object's bounds against the trim line (the original artboard rectangle BEFORE it was expanded for crop marks — size was " + abWidth + " × " + abHeight + " pt). " +
          "Step 3: For every object whose edge touches or nearly touches the trim line, use modify_object to extend that edge outward by at least 3 mm (8.5 pt). Do NOT move or scale the design — just stretch the touching edge outward. For background rectangles, extend all four sides. " +
          "Why: The trim marks show where the paper is physically cut. If an object stops at the trim line, cutting produces a white gap. Extending past ensures full bleed coverage.";

        writeResultFile(RESULT_PATH, {
          success: true,
          mode: "artboard",
          crop_mark_style: resolvedStyle,
          style_display_name: styleName,
          detection_method: detectionMethod,
          mark_groups_created: newGroupCount,
          artboard_index: abIndex,
          artboard_name: ab.name,
          artboard_modified: true,
          original_artboard_size: { width: abWidth, height: abHeight },
          new_artboard_size: {
            width: newAbRect[2] - newAbRect[0],
            height: newAbRect[1] - newAbRect[3]
          },
          bleed_required: bleedNote,
          description: (resolvedStyle === "japanese")
            ? "Japanese crop marks created. Artboard expanded to include all marks. See bleed_required for next steps."
            : "Western crop marks created. Artboard expanded to include all marks. See bleed_required for next steps."
        });
        }
      }
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
        'Create crop marks (トンボ / trim marks) on the active artboard or selected objects. ' +
        'By default, creates marks for the artboard and expands the artboard to include all marks. ' +
        'With use_selection=true, creates marks for the currently selected object(s) without modifying the artboard. ' +
        'Automatically selects Japanese-style (日本式) or Western-style crop marks based on locale. ' +
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
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeToolJsx(jsxCode, params, { activate: true });
      // Inject active coordinate system into the response for the bleed note
      const coordSystem = await resolveCoordinateSystem(undefined);
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
