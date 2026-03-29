import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS } from './shared.js';

/**
 * save_document — ドキュメントの上書き保存・別名保存
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — Document.save(), Document.saveAs()
 *
 * JSX API:
 *   Document.save() → void  (上書き保存)
 *   Document.saveAs(saveIn: File [, options]) → void  (別名保存)
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var mode = params.mode || "save";

    if (mode === "save") {
      doc.save();
      writeResultFile(RESULT_PATH, { success: true, mode: "save" });
    } else if (mode === "save_as") {
      if (!params.path) {
        writeResultFile(RESULT_PATH, { error: true, message: "path is required for save_as mode" });
      } else {
        var saveFile = new File(params.path);
        doc.saveAs(saveFile);
        writeResultFile(RESULT_PATH, { success: true, mode: "save_as", path: params.path });
      }
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown mode: " + mode });
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
      description:
        'Save the active Illustrator document. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        mode: z
          .enum(['save', 'save_as'])
          .optional()
          .default('save')
          .describe('save = overwrite, save_as = save to new path'),
        path: z
          .string()
          .optional()
          .describe('File path for save_as mode (required when mode is save_as)'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
