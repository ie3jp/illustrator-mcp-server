import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { invalidateAutoDetectCache } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * open_document — ファイルパスからドキュメントを開く
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Application/ — Application.open()
 *
 * JSX API:
 *   Application.open(file: File [, documentColorSpace: DocumentColorSpace]) → Document
 *
 * preflightChecks() はドキュメント未開封時にエラーを返すため、
 * checkIllustratorVersion() のみ使用。
 * handler 内で invalidateAutoDetectCache() を呼ぶ。
 */
const jsxCode = `
try {
  var verErr = checkIllustratorVersion();
  if (verErr) {
    writeResultFile(RESULT_PATH, verErr);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var openFile = new File(params.path);
    if (!openFile.exists) {
      writeResultFile(RESULT_PATH, { error: true, message: "File not found: " + params.path });
    } else {
      var colorSpace = null;
      if (params.color_space === "RGB") colorSpace = DocumentColorSpace.RGB;
      else if (params.color_space === "CMYK") colorSpace = DocumentColorSpace.CMYK;

      var doc;
      if (colorSpace) {
        doc = app.open(openFile, colorSpace);
      } else {
        doc = app.open(openFile);
      }

      $.sleep(500);

      var docName = doc.name;
      var fullPath = "";
      try { fullPath = doc.fullName.fsName; } catch(e) {}
      writeResultFile(RESULT_PATH, {
        success: true,
        name: docName,
        path: fullPath,
        colorSpace: (doc.documentColorSpace === DocumentColorSpace.CMYK) ? "CMYK" : "RGB"
      });
    }
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
      description:
        'Open an Illustrator document from a file path. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        path: z.string().describe('Absolute file path to open (.ai, .eps, .pdf, .svg, etc.)'),
        color_space: z
          .enum(['RGB', 'CMYK'])
          .optional()
          .describe('Force color space conversion on open. Omit to keep original.'),
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
