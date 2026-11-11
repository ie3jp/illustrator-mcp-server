import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * convert_to_outlines — テキストのアウトライン化
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItem/ — TextFrameItem.createOutline()
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
    var count = 0;
    var failed = [];
    var hasError = false;
    var warnings = [];

    // アウトライン化は不可逆。失敗（ロック・非表示など）を握りつぶさず、対象と理由を返す。
    // 変換後のグループは名前も note も引き継がない（実機確認: 変換後に find_objects で
    // 元の名前を引けない）ため、旧 UUID と新 UUID の対応を返す。これが無いと、
    // 印刷直前にアウトライン化してから modify_object を呼ぶ流れで UUID が無言で解決不能になる
    var convertedItems = [];
    function convertFrame(tf) {
      try {
        // createOutline() はロック中でも例外なしで変換してしまう（実機確認）ため、ロックを尊重して除外する
        if (isItemEffectivelyLocked(tf)) throw new Error("locked (unlock the object or its layer first)");
        var oldUuid = null;
        var oldName = "";
        try { oldUuid = extractUUIDFromNote(tf.note) || null; } catch (eU) {}
        try { oldName = tf.name || ""; } catch (eN) {}
        var outlined = tf.createOutline();
        count++;
        var newUuid = null;
        try {
          if (oldName) { try { outlined.name = oldName; } catch (eSet) {} }
          newUuid = ensureUUID(outlined);
        } catch (eNew) {}
        convertedItems.push({ oldUuid: oldUuid, newUuid: newUuid, name: oldName });
      } catch (convErr) {
        var info = { uuid: null, name: "", layer: "", message: convErr.message };
        try { info.uuid = extractUUIDFromNote(tf.note) || null; } catch (e1) {}
        try { info.name = tf.name || ""; } catch (e2) {}
        try { info.layer = getParentLayerName(tf); } catch (e3) {}
        failed.push(info);
      }
    }

    if (target === "selection") {
      var sel = doc.selection;
      if (sel && sel.length > 0) {
        for (var i = sel.length - 1; i >= 0; i--) {
          if (sel[i].typename === "TextFrame") {
            convertFrame(sel[i]);
          }
        }
      }
    } else if (target === "all") {
      // 変換でコレクションが変わるため先に配列へ固定する
      var frames = [];
      for (var fi = 0; fi < doc.textFrames.length; fi++) frames.push(doc.textFrames[fi]);
      for (var i = frames.length - 1; i >= 0; i--) {
        convertFrame(frames[i]);
      }
    } else {
      // target is a layer name（同名のトップレベルレイヤーが複数あるときは最上位を対象にし、警告を返す）
      var resolvedLayer = resolveTopLevelLayer(doc, target, warnings);
      var layer = resolvedLayer ? resolvedLayer.layer : null;
      if (!layer) {
        hasError = true;
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + target });
      }
      if (layer) {
        // Layer.textFrames はグループ内・サブレイヤー内を含まないため全アイテムから集める（変換前に固定）
        var layerItems = collectAllItems(layer);
        for (var i = layerItems.length - 1; i >= 0; i--) {
          if (layerItems[i].typename === "TextFrame") convertFrame(layerItems[i]);
        }
      }
    }

    if (!hasError) {
      var convResult = {
        success: failed.length === 0,
        convertedCount: count,
        failedCount: failed.length,
        failed: failed,
        converted: convertedItems,
        verified: { convertedCount: count, withNewUuid: (function () {
          var n = 0;
          for (var ci = 0; ci < convertedItems.length; ci++) if (convertedItems[ci].newUuid) n++;
          return n;
        })() }
      };
      if (warnings.length > 0) convResult.warnings = warnings;
      writeResultFile(RESULT_PATH, convResult);
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to convert to outlines: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'convert_to_outlines',
    {
      title: 'Convert to Outlines',
      description:
        'Convert text to outlines (irreversible except via undo). Text frames that cannot be converted (e.g. locked) are left as-is and listed in "failed" with the message; success is false if any failed. '
        + 'The outlined group does not inherit the text frame\'s UUID, so converted reports each oldUuid → newUuid pair and the name is carried over — use it to keep working with the artwork after converting.',
      inputSchema: {
        target: z
          .string()
          .describe('Target: "selection" (selected), "all" (all text), or a top-level layer name (includes text inside groups and sublayers; if several layers share the name, the topmost one is used and a warning is returned)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return formatToolResult(result);
    },
  );
}
