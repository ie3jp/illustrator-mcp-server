import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_master_spreads — マスタースプレッド一覧の取得
 * List master spreads: name, namePrefix, baseName, page count, item counts.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var includeItems = (params && params.include_items === true) ? true : false;

    var masterSpreads = [];

    for (var i = 0; i < doc.masterSpreads.length; i++) {
      var ms = doc.masterSpreads[i];

      var msInfo = {
        index: i,
        name: "",
        namePrefix: "",
        baseName: "",
        pageCount: 0,
        itemCount: 0,
        appliedCount: 0
      };

      try { msInfo.name = ms.name || ""; } catch (e) {}
      try { msInfo.namePrefix = ms.namePrefix || ""; } catch (e) {}
      try { msInfo.baseName = ms.baseName || ""; } catch (e) {}

      // ページ数
      try { msInfo.pageCount = ms.pages.length; } catch (e) {}

      // ページ情報
      try {
        var msPages = [];
        for (var pi = 0; pi < ms.pages.length; pi++) {
          var mp = ms.pages[pi];
          var mpInfo = {
            index: pi,
            name: mp.name || String(pi + 1)
          };
          try {
            var mpBounds = mp.bounds; // [top, left, bottom, right]
            mpInfo.width = mpBounds[3] - mpBounds[1];
            mpInfo.height = mpBounds[2] - mpBounds[0];
          } catch (e2) {}
          try {
            var mpMp = mp.marginPreferences;
            mpInfo.margins = {
              top: mpMp.top,
              bottom: mpMp.bottom,
              left: mpMp.left,
              right: mpMp.right
            };
            mpInfo.columns = {
              count: mpMp.columnCount,
              gutter: mpMp.columnGutter
            };
          } catch (e2) {}
          msPages.push(mpInfo);
        }
        msInfo.pages = msPages;
      } catch (e) {}

      // アイテム数
      try { msInfo.itemCount = ms.allPageItems.length; } catch (e) {}

      // ベースマスター
      try {
        msInfo.basedOn = ms.appliedMaster ? ms.appliedMaster.name : "None";
      } catch (e) { msInfo.basedOn = "None"; }

      // このマスターを適用されているドキュメントページ数
      try {
        var applyCount = 0;
        for (var dpi = 0; dpi < doc.pages.length; dpi++) {
          var dp = doc.pages[dpi];
          try {
            if (dp.appliedMaster && dp.appliedMaster.name === msInfo.name) {
              applyCount++;
            }
          } catch (e2) {}
        }
        msInfo.appliedCount = applyCount;
      } catch (e) {}

      // アイテム一覧（オプション）
      if (includeItems) {
        try {
          var msItems = [];
          var allItems = ms.allPageItems;
          for (var ii = 0; ii < allItems.length; ii++) {
            var mItem = allItems[ii];
            var mItemInfo = {
              uuid: ensureUUID(mItem),
              name: "",
              type: getItemType(mItem)
            };
            try { mItemInfo.name = mItem.name || ""; } catch (e2) {}
            try {
              var mb = mItem.geometricBounds;
              mItemInfo.bounds = { top: mb[0], left: mb[1], bottom: mb[2], right: mb[3] };
            } catch (e2) {}
            msItems.push(mItemInfo);
          }
          msInfo.items = msItems;
        } catch (e) {}
      }

      masterSpreads.push(msInfo);
    }

    writeResultFile(RESULT_PATH, {
      masterSpreadCount: masterSpreads.length,
      masterSpreads: masterSpreads
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_master_spreads: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_master_spreads',
    {
      title: 'Get Master Spreads',
      description: 'List InDesign master spreads with name, prefix, page count, item count, pages applied to, and optional item list.',
      inputSchema: {
        include_items: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include page items on each master spread (default: false)'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
