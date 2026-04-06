import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { invalidateAutoDetectCache } from '../session.js';
import { DESTRUCTIVE_ANNOTATIONS, coerceBoolean } from './shared.js';

/**
 * close_document — アクティブドキュメントを閉じる
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — Document.close(saveOptions)
 */
const jsxCode = `
try {
  var verErr = checkIllustratorVersion();
  if (verErr) {
    writeResultFile(RESULT_PATH, verErr);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var save = params.save === true;

    if (app.documents.length === 0) {
      writeResultFile(RESULT_PATH, { error: true, message: "No document is open" });
    } else {
      var saveOpt = save ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES;
      app.activeDocument.close(saveOpt);
      writeResultFile(RESULT_PATH, { success: true });
    }
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "Failed to close document: " + e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'close_document',
    {
      title: 'Close Document',
      description:
        'Close the active Illustrator document. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        save: coerceBoolean
          .optional()
          .default(false)
          .describe('Whether to save before closing (default: false)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      invalidateAutoDetectCache();
      return formatToolResult(result);
    },
  );
}
