import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
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
    var hasError = false;

    if (target === "selection") {
      var sel = doc.selection;
      if (sel && sel.length > 0) {
        for (var i = sel.length - 1; i >= 0; i--) {
          try {
            if (sel[i].typename === "TextFrame") {
              sel[i].createOutline();
              count++;
            }
          } catch(e) {}
        }
      }
    } else if (target === "all") {
      var frames = doc.textFrames;
      for (var i = frames.length - 1; i >= 0; i--) {
        try {
          frames[i].createOutline();
          count++;
        } catch(e) {}
      }
    } else {
      // target is a layer name
      try {
        var layer = doc.layers.getByName(target);
        frames = layer.textFrames;
        for (var i = frames.length - 1; i >= 0; i--) {
          try {
            frames[i].createOutline();
            count++;
          } catch(e) {}
        }
      } catch(e) {
        hasError = true;
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + target });
      }
    }

    if (!hasError) {
      writeResultFile(RESULT_PATH, { success: true, convertedCount: count, verified: { convertedCount: count } });
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
      description: 'Convert text to outlines. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        target: z
          .string()
          .describe('Target: "selection" (selected), "all" (all text), or layer name'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
