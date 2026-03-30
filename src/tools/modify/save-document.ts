import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    if (params.file_path) {
      var saveFile = new File(params.file_path);
      doc.save(saveFile);
      writeResultFile(RESULT_PATH, { success: true, mode: "save_as", path: params.file_path });
    } else {
      doc.save();
      var fullPath = "";
      try { fullPath = doc.fullName.fsName; } catch(e) {}
      writeResultFile(RESULT_PATH, { success: true, mode: "save", path: fullPath, name: doc.name });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "save_document failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'save_document',
    {
      title: 'Save Document',
      description: 'Save the active InDesign document. Optionally save to a new file path.',
      inputSchema: {
        file_path: z.string().optional().describe('File path to save to (omit for overwrite save). Use .indd extension.'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
