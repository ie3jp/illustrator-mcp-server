import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * list_fonts — Illustrator で利用可能なフォント一覧
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFonts/ — TextFonts, TextFont
 *
 * JSX API:
 *   Application.textFonts → TextFonts コレクション
 *   TextFont.name → String (PostScript名)
 *   TextFont.family → String (ファミリー名)
 *   TextFont.style → String (スタイル名)
 *
 * ドキュメント不要。checkIllustratorVersion() のみ使用。
 */
const jsxCode = `
try {
  var verErr = checkIllustratorVersion();
  if (verErr) {
    writeResultFile(RESULT_PATH, verErr);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var filterStr = (params.filter || "").toLowerCase();
    var limit = params.limit || 100;
    var fonts = [];

    for (var i = 0; i < app.textFonts.length; i++) {
      var tf = app.textFonts[i];
      if (filterStr) {
        var nameL = tf.name.toLowerCase();
        var familyL = tf.family ? tf.family.toLowerCase() : "";
        if (nameL.indexOf(filterStr) === -1 && familyL.indexOf(filterStr) === -1) {
          continue;
        }
      }
      fonts.push({
        name: tf.name,
        family: tf.family,
        style: tf.style
      });
      if (fonts.length >= limit) break;
    }

    writeResultFile(RESULT_PATH, {
      count: fonts.length,
      totalAvailable: app.textFonts.length,
      fonts: fonts
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "list_fonts failed: " + e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'list_fonts',
    {
      title: 'List Fonts',
      description: 'List fonts available in Illustrator. Does not require an open document.',
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe('Filter by family or name (case-insensitive partial match)'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(100)
          .describe('Max fonts to return (default 100)'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
