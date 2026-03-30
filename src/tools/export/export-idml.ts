import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS } from '../modify/shared.js';
/**
 * export_idml — IDML interchange format export for InDesign
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#ExportFormat
 *
 * IDML (InDesign Markup Language) is the interchange format for sharing InDesign
 * documents with older versions or other applications.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var outputPath = params.output_path;

    var outFile = new File(outputPath);
    var parentFolder = outFile.parent;
    if (!parentFolder.exists) {
      writeResultFile(RESULT_PATH, { error: true, message: "Output directory does not exist: " + parentFolder.fsName });
    } else {
      doc.exportFile(ExportFormat.INDESIGN_MARKUP, outFile);

      // Verify output
      var verifyFile = new File(outputPath);
      if (!verifyFile.exists) {
        writeResultFile(RESULT_PATH, { error: true, message: "IDML export completed but output file was not created. Path may not be writable: " + outputPath });
      } else {
        writeResultFile(RESULT_PATH, {
          success: true,
          output_path: outputPath
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "IDML export failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'export_idml',
    {
      title: 'Export IDML',
      description:
        'Export the active InDesign document as an IDML (InDesign Markup Language) interchange file. ' +
        'Useful for sharing documents with users on older InDesign versions or third-party applications. ' +
        'Note: InDesign will be activated (brought to foreground) during execution.',
      inputSchema: {
        output_path: z.string().describe('Output file path (.idml)'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsxHeavy(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
