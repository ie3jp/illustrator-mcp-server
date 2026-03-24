import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

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
        save: z
          .boolean()
          .optional()
          .default(false)
          .describe('Whether to save before closing (default: false)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
