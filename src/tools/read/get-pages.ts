import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_pages — ページ一覧の取得
 * index, name, width/height, appliedMaster, margins, columns
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;
    var pages = [];

    for (var i = 0; i < doc.pages.length; i++) {
      var pg = doc.pages[i];
      var pgInfo = {
        index: i,
        name: pg.name || String(i + 1)
      };

      // サイズ
      try {
        var b = pg.bounds; // [top, left, bottom, right]
        pgInfo.width = b[3] - b[1];
        pgInfo.height = b[2] - b[0];
        pgInfo.bounds = { top: b[0], left: b[1], bottom: b[2], right: b[3] };
      } catch (e) {}

      // マスター
      try {
        pgInfo.appliedMaster = pg.appliedMaster ? pg.appliedMaster.name : "None";
      } catch (e) { pgInfo.appliedMaster = "None"; }

      // スプレッドインデックス
      try {
        pgInfo.spreadIndex = pg.parent ? pg.parent.index : 0;
      } catch (e) {}

      // マージン
      try {
        var mp = pg.marginPreferences;
        pgInfo.margins = {
          top: mp.top,
          bottom: mp.bottom,
          left: mp.left,
          right: mp.right
        };
      } catch (e) { pgInfo.margins = null; }

      // カラム
      try {
        var mp2 = pg.marginPreferences;
        pgInfo.columns = {
          count: mp2.columnCount,
          gutter: mp2.columnGutter
        };
      } catch (e) { pgInfo.columns = null; }

      // アイテム数
      try {
        pgInfo.itemCount = pg.allPageItems.length;
      } catch (e) { pgInfo.itemCount = 0; }

      // セクション番号ラベル
      try {
        pgInfo.sectionLabel = pg.appliedSection ? pg.appliedSection.name : "";
      } catch (e) { pgInfo.sectionLabel = ""; }

      pages.push(pgInfo);
    }

    writeResultFile(RESULT_PATH, {
      pageCount: pages.length,
      spreadCount: doc.spreads.length,
      pages: pages
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_pages',
    {
      title: 'Get Pages',
      description: 'List all pages with index, name, size, applied master, margins, and column settings.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (_params) => {
      const result = await executeJsx(jsxCode, {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
