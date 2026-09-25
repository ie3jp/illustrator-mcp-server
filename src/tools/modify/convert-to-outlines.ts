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

    // アウトライン化は不可逆。失敗（ロック・非表示など）を握りつぶさず、対象と理由を返す
    function convertFrame(tf) {
      try {
        tf.createOutline();
        count++;
      } catch (convErr) {
        var info = { uuid: null, name: "", layer: "", reason: convErr.message };
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
      var frames = doc.textFrames;
      for (var i = frames.length - 1; i >= 0; i--) {
        convertFrame(frames[i]);
      }
    } else {
      // target is a layer name
      var layer = null;
      try {
        layer = doc.layers.getByName(target);
      } catch(e) {
        hasError = true;
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + target });
      }
      if (layer) {
        frames = layer.textFrames;
        for (var i = frames.length - 1; i >= 0; i--) {
          convertFrame(frames[i]);
        }
      }
    }

    if (!hasError) {
      writeResultFile(RESULT_PATH, {
        success: failed.length === 0,
        convertedCount: count,
        failedCount: failed.length,
        failed: failed,
        verified: { convertedCount: count }
      });
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
        'Convert text to outlines (irreversible except via undo). Text frames that cannot be converted (e.g. locked) are left as-is and listed in "failed" with the reason; success is false if any failed. ' +
        'Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        target: z
          .string()
          .describe('Target: "selection" (selected), "all" (all text), or layer name'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
