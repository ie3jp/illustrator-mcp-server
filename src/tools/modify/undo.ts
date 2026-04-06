import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * undo — Illustrator の操作を取り消し/やり直し
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Application/ — Application.undo(), Application.redo()
 *
 * JSX API:
 *   Application.undo() → void
 *   Application.redo() → void
 *
 * ドキュメント不要。checkIllustratorVersion() のみ使用。
 */
const jsxCode = `
try {
  var verErr = checkIllustratorVersion();
  if (verErr) {
    writeResultFile(RESULT_PATH, verErr);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var action = params.action || "undo";
    var count = params.count || 1;

    for (var i = 0; i < count; i++) {
      if (action === "undo") {
        app.undo();
      } else {
        app.redo();
      }
    }

    writeResultFile(RESULT_PATH, {
      success: true,
      action: action,
      count: count
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "undo failed: " + e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'undo',
    {
      title: 'Undo / Redo',
      description:
        'Undo or redo actions in Illustrator. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        action: z.enum(['undo', 'redo']).optional().default('undo'),
        count: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(1)
          .describe('Number of times to undo/redo (max 20)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
