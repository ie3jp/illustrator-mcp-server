import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS } from '../modify/shared.js';
/**
 * export_epub — EPUB export for InDesign
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#ExportFormat
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#EPubExportPreference
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
    var version = params.version || "3";

    var outFile = new File(outputPath);
    var parentFolder = outFile.parent;
    if (!parentFolder.exists) {
      writeResultFile(RESULT_PATH, { error: true, message: "Output directory does not exist: " + parentFolder.fsName });
    } else {
      // Set EPUB version via epubExportPreferences if available
      try {
        if (version === "2") {
          app.epubExportPreferences.epubVersion = EPubVersion.EPUB_2;
        } else {
          app.epubExportPreferences.epubVersion = EPubVersion.EPUB_3;
        }
      } catch(e) {
        // epubVersion property may not exist in older InDesign versions — proceed anyway
      }

      doc.exportFile(ExportFormat.EPUB, outFile);

      // Verify output
      var verifyFile = new File(outputPath);
      if (!verifyFile.exists) {
        writeResultFile(RESULT_PATH, { error: true, message: "EPUB export completed but output file was not created. Path may not be writable: " + outputPath });
      } else {
        writeResultFile(RESULT_PATH, {
          success: true,
          output_path: outputPath,
          epub_version: version
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "EPUB export failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'export_epub',
    {
      title: 'Export EPUB',
      description:
        'Export the active InDesign document as an EPUB file. Note: InDesign will be activated (brought to foreground) during execution.',
      inputSchema: {
        output_path: z.string().describe('Output file path (.epub)'),
        version: z
          .enum(['2', '3'])
          .optional()
          .default('3')
          .describe('EPUB version. "3" (default) for EPUB 3, "2" for EPUB 2 (legacy).'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsxHeavy(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
