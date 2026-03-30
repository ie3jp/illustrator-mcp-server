import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_document_structure — ドキュメント構造のツリー取得
 * Hierarchical tree: spreads → pages → items. With depth control.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var maxDepth = (params.depth !== undefined) ? params.depth : 999;
    var filterPage = (params.page_index !== undefined) ? params.page_index : -1;
    var coordSystem = params.coordinate_system || "page-relative";
    var doc = app.activeDocument;

    function traverseItem(item, currentDepth) {
      var itemType = getItemType(item);
      var uuid = ensureUUID(item);

      var pageIdx = -1;
      try {
        var pp = item.parentPage;
        if (pp) pageIdx = pp.index;
      } catch (e) {}

      var boundsObj = null;
      try {
        boundsObj = getBoundsOnPage(item, pageIdx);
      } catch (e) {
        try {
          var gb = item.geometricBounds;
          boundsObj = { top: gb[0], left: gb[1], bottom: gb[2], right: gb[3],
                        width: gb[3] - gb[1], height: gb[2] - gb[0] };
        } catch (e2) {}
      }

      var node = {
        uuid: uuid,
        name: "",
        type: itemType,
        layerName: getParentLayerName(item),
        bounds: boundsObj
      };
      try { node.name = item.name || ""; } catch (e) {}

      // テキストフレームの追加情報
      if (itemType === "TextFrame") {
        try {
          var preview = item.contents || "";
          node.contentsPreview = preview.length > 50 ? preview.substring(0, 50) + "..." : preview;
        } catch (e) {}
        try {
          var tfInf = getTextFrameInfo(item);
          node.overflows = tfInf.overflows;
        } catch (e) {}
      }

      if (itemType === "Group" && currentDepth < maxDepth) {
        try {
          var children = [];
          var groupItems = item.pageItems;
          for (var gi = 0; gi < groupItems.length; gi++) {
            children.push(traverseItem(groupItems[gi], currentDepth + 1));
          }
          node.children = children;
        } catch (e) {
          node.children = [];
        }
      }

      return node;
    }

    function buildPageTree(pg, pgIndex) {
      var pgTree = {
        index: pgIndex,
        name: pg.name || String(pgIndex + 1),
        items: []
      };
      try {
        var pgBounds = pg.bounds;
        pgTree.width = pgBounds[3] - pgBounds[1];
        pgTree.height = pgBounds[2] - pgBounds[0];
      } catch (e) {}
      try {
        pgTree.appliedMaster = pg.appliedMaster ? pg.appliedMaster.name : "None";
      } catch (e) { pgTree.appliedMaster = "None"; }

      if (maxDepth > 0) {
        try {
          var pgItems = pg.allPageItems;
          for (var pi = 0; pi < pgItems.length; pi++) {
            var pItem = pgItems[pi];
            // 親がページ直下のアイテムのみ（グループ内は子として含める）
            var pParent = null;
            try { pParent = pItem.parent; } catch (e) {}
            var parentIsPage = false;
            try {
              if (pParent && pParent.constructor && pParent.constructor.name === "Page") {
                parentIsPage = true;
              }
            } catch (e) {}
            // parentPageとparentが一致し、parentがSpreadまたはPageの直下
            var parentTypeName = "";
            try { parentTypeName = pParent ? pParent.constructor.name : ""; } catch (e) {}
            if (parentTypeName === "Page" || parentTypeName === "Spread") {
              pgTree.items.push(traverseItem(pItem, 1));
            }
          }
        } catch (e) {}
      }

      return pgTree;
    }

    var spreads = [];
    for (var si = 0; si < doc.spreads.length; si++) {
      var spread = doc.spreads[si];
      var spreadInfo = {
        index: si,
        pages: []
      };

      for (var spi = 0; spi < spread.pages.length; spi++) {
        var pg = spread.pages[spi];
        var pgIndex = -1;
        // doc.pages でインデックスを探す
        for (var dpi = 0; dpi < doc.pages.length; dpi++) {
          try {
            if (doc.pages[dpi].id === pg.id) {
              pgIndex = dpi;
              break;
            }
          } catch (e) {}
        }

        if (filterPage >= 0 && pgIndex !== filterPage) continue;
        spreadInfo.pages.push(buildPageTree(pg, pgIndex));
      }

      if (filterPage >= 0 && spreadInfo.pages.length === 0) continue;
      spreads.push(spreadInfo);
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      spreadCount: spreads.length,
      pageCount: doc.pages.length,
      spreads: spreads
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_document_structure: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_document_structure',
    {
      title: 'Get Document Structure',
      description: 'Get hierarchical tree of InDesign document: spreads → pages → items (with group children). Supports depth control and page_index filter.',
      inputSchema: {
        depth: z
          .number()
          .optional()
          .describe('Maximum traversal depth (unlimited if omitted)'),
        page_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Filter by page index (0-based)'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = {
        ...params,
        coordinate_system: await resolveCoordinateSystem(params.coordinate_system),
      };
      const result = await executeJsx(jsxCode, resolvedParams);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
