import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * list_fonts — InDesign で利用可能なフォント一覧
 * app.fonts with fontFamily, fontStyleName, status. Support filter param.
 */
const jsxCode = `
try {
  var params = readParamsFile(PARAMS_PATH);
  var filterStr = (params && params.filter) ? params.filter.toLowerCase() : "";
  var limit = (params && typeof params.limit === "number") ? params.limit : 100;
  var filterStatus = (params && params.status) ? params.status : null;
  var fonts = [];
  var skipped = 0;

  for (var i = 0; i < app.fonts.length; i++) {
    var f = app.fonts[i];

    // フィルタ処理
    if (filterStr) {
      var nameL = "";
      var familyL = "";
      try { nameL = (f.name || "").toLowerCase(); } catch (e2) {}
      try { familyL = (f.fontFamily || "").toLowerCase(); } catch (e2) {}
      if (nameL.indexOf(filterStr) === -1 && familyL.indexOf(filterStr) === -1) {
        skipped++;
        continue;
      }
    }

    // ステータスフィルタ
    var statusStr = "unknown";
    try {
      var fs = f.status;
      if (fs === FontStatus.INSTALLED) statusStr = "installed";
      else if (fs === FontStatus.NOT_AVAILABLE) statusStr = "not-available";
      else if (fs === FontStatus.FAUXED) statusStr = "fauxed";
      else if (fs === FontStatus.SUBSTITUTE) statusStr = "substitute";
      else statusStr = String(fs);
    } catch (e2) {}

    if (filterStatus && statusStr !== filterStatus) {
      skipped++;
      continue;
    }

    var fontInfo = {
      name: "",
      fontFamily: "",
      fontStyleName: "",
      fullName: "",
      postScriptName: "",
      status: statusStr
    };

    try { fontInfo.name = f.name || ""; } catch (e2) {}
    try { fontInfo.fontFamily = f.fontFamily || ""; } catch (e2) {}
    try { fontInfo.fontStyleName = f.fontStyleName || ""; } catch (e2) {}
    try { fontInfo.fullName = f.fullName || ""; } catch (e2) {}
    try { fontInfo.postScriptName = f.postScriptName || ""; } catch (e2) {}

    fonts.push(fontInfo);
    if (fonts.length >= limit) break;
  }

  writeResultFile(RESULT_PATH, {
    count: fonts.length,
    totalAvailable: app.fonts.length,
    skipped: skipped,
    fonts: fonts
  });
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "list_fonts failed: " + e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'list_fonts',
    {
      title: 'List Fonts',
      description: 'List fonts available in InDesign with family, style name, and status (installed/not-available/fauxed). Does not require a specific document.',
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
        status: z
          .enum(['installed', 'not-available', 'fauxed', 'substitute'])
          .optional()
          .describe('Filter by font status'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
