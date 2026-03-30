import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_sections — ページ番号セクション一覧の取得
 * Page numbering sections.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;
    var sections = [];

    for (var i = 0; i < doc.sections.length; i++) {
      var sec = doc.sections[i];

      var secInfo = {
        index: i,
        name: "",
        marker: "",
        pageStart: -1,
        pageNumberStart: 1,
        pageNumberStyle: "arabic",
        continueNumbering: false,
        includeSectionPrefix: false,
        sectionPrefix: "",
        pageCount: 0
      };

      try { secInfo.name = sec.name || ""; } catch (e2) {}
      try { secInfo.marker = sec.marker || ""; } catch (e2) {}
      try { secInfo.pageNumberStart = sec.pageNumberStart || 1; } catch (e2) {}
      try { secInfo.continueNumbering = sec.continueNumbering === true; } catch (e2) {}
      try { secInfo.includeSectionPrefix = sec.includeSectionPrefix === true; } catch (e2) {}
      try { secInfo.sectionPrefix = sec.sectionPrefix || ""; } catch (e2) {}

      // ページ番号スタイル
      try {
        var ns = sec.pageNumberStyle;
        if (ns === PageNumberStyle.ARABIC) secInfo.pageNumberStyle = "arabic";
        else if (ns === PageNumberStyle.UPPER_ROMAN) secInfo.pageNumberStyle = "upper-roman";
        else if (ns === PageNumberStyle.LOWER_ROMAN) secInfo.pageNumberStyle = "lower-roman";
        else if (ns === PageNumberStyle.UPPER_LETTERS) secInfo.pageNumberStyle = "upper-letters";
        else if (ns === PageNumberStyle.LOWER_LETTERS) secInfo.pageNumberStyle = "lower-letters";
        else if (ns === PageNumberStyle.CURRENT_PAGE_NUMBER) secInfo.pageNumberStyle = "current";
        else secInfo.pageNumberStyle = String(ns);
      } catch (e2) {}

      // セクション開始ページの特定
      try {
        var spg = sec.pageStart;
        if (spg) {
          secInfo.pageStart = spg.index;
        }
      } catch (e2) {}

      // このセクションが対象とするページ数（次セクションの開始まで）
      try {
        var nextSecStart = doc.pages.length; // デフォルトは最終ページの次
        if (i + 1 < doc.sections.length) {
          var nextSec = doc.sections[i + 1];
          try {
            var nsp = nextSec.pageStart;
            if (nsp) nextSecStart = nsp.index;
          } catch (e3) {}
        }
        if (secInfo.pageStart >= 0) {
          secInfo.pageCount = nextSecStart - secInfo.pageStart;
        }
      } catch (e2) {}

      // ページ名サンプル（このセクション内の最初のページ）
      try {
        if (secInfo.pageStart >= 0 && secInfo.pageStart < doc.pages.length) {
          secInfo.firstPageName = doc.pages[secInfo.pageStart].name || "";
        }
      } catch (e2) {}

      sections.push(secInfo);
    }

    writeResultFile(RESULT_PATH, {
      sectionCount: sections.length,
      sections: sections
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_sections: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_sections',
    {
      title: 'Get Sections',
      description: 'List InDesign page numbering sections with start page, number style (arabic, roman, letters), prefix, page count, and whether numbering continues from previous section.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (_params) => {
      const result = await executeJsx(jsxCode, {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
