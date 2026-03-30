import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { invalidateAutoDetectCache } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
try {
  var params = readParamsFile(PARAMS_PATH);
  var openFile = new File(params.file_path);
  if (!openFile.exists) {
    writeResultFile(RESULT_PATH, { error: true, message: "File not found: " + params.file_path });
  } else {
    var doc = app.open(openFile);

    var docName = doc.name;
    var fullPath = "";
    try { fullPath = doc.fullName.fsName; } catch(e) {}

    var intent = "unknown";
    try {
      var di = doc.documentPreferences.intent;
      if (di === DocumentIntentOptions.PRINT_INTENT) intent = "print";
      else if (di === DocumentIntentOptions.WEB_INTENT) intent = "digital";
      else if (di === DocumentIntentOptions.MOBILE_INTENT) intent = "digital";
    } catch(e) {}

    writeResultFile(RESULT_PATH, {
      success: true,
      name: docName,
      path: fullPath,
      intent: intent,
      pageCount: doc.pages.length
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "open_document failed: " + e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'open_document',
    {
      title: 'Open Document',
      description: 'Open an InDesign document (.indd, .indt, .idml) from a file path.',
      inputSchema: {
        file_path: z.string().describe('Absolute file path to open (.indd, .indt, .idml, etc.)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      invalidateAutoDetectCache();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
