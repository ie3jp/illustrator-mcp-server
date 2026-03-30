import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { invalidateAutoDetectCache } from '../session.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

const jsxCode = `
try {
  var params = readParamsFile(PARAMS_PATH);
  var save = params.save || "no";

  if (app.documents.length === 0) {
    writeResultFile(RESULT_PATH, { error: true, message: "No document is open" });
  } else {
    var saveOpt;
    if (save === "yes") {
      saveOpt = SaveOptions.YES;
    } else if (save === "ask") {
      saveOpt = SaveOptions.ASK;
    } else {
      saveOpt = SaveOptions.NO;
    }
    var docName = app.activeDocument.name;
    app.activeDocument.close(saveOpt);
    writeResultFile(RESULT_PATH, { success: true, closedDocument: docName });
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
      description: 'Close the active InDesign document.',
      inputSchema: {
        save: z
          .enum(['yes', 'no', 'ask'])
          .optional()
          .default('no')
          .describe('Save behavior: yes=save before closing, no=discard changes, ask=show dialog'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      invalidateAutoDetectCache();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
