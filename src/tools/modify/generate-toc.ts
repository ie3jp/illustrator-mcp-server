import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    // Check for TOC styles
    if (doc.tocStyles.length === 0) {
      writeResultFile(RESULT_PATH, { error: true, message: "No TOC styles defined in this document. Create a TOC style first via Type > Table of Contents Styles." });
    } else {
      var tocStyleName = params.toc_style_name;
      var tocStyle;
      if (tocStyleName) {
        tocStyle = doc.tocStyles.itemByName(tocStyleName);
      } else {
        tocStyle = doc.tocStyles[0];
      }

      var targetPage = resolveTargetPage(doc, params.page_index);
      var story = doc.createTOC(tocStyle, true);

      writeResultFile(RESULT_PATH, {
        success: true,
        tocStyleName: tocStyle.name,
        pageIndex: targetPage.documentOffset,
        message: "Table of contents generated successfully."
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "generate_toc failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'generate_toc',
    {
      title: 'Generate Table of Contents',
      description: 'Generate a table of contents using an existing TOC style.',
      inputSchema: {
        toc_style_name: z.string().optional().describe('TOC style name (uses first available if omitted)'),
        page_index: z.number().int().min(0).optional().describe('Page index to place TOC on (default: active page)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
