import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_selection — 現在の選択オブジェクト情報の取得
 * app.selection array. Return bounds, type, page index for each item.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "page-relative";
    var doc = app.activeDocument;
    var sel = app.selection;

    if (!sel || sel.length === 0) {
      writeResultFile(RESULT_PATH, { selectionCount: 0, items: [] });
    } else {
      var items = [];

      for (var i = 0; i < sel.length; i++) {
        var item = sel[i];
        var uuid = ensureUUID(item);
        var itemType = getItemType(item);

        // ページ情報の取得
        var pageIndex = -1;
        try {
          var pp = getPageForItem(item);
          if (pp) pageIndex = pp.index;
        } catch (e) {}

        // バウンズの取得
        var boundsObj = null;
        try {
          var b = item.geometricBounds; // [top, left, bottom, right]
          if (coordSystem === "spread") {
            // スプレッド座標系ではそのまま返す
            boundsObj = { top: b[0], left: b[1], bottom: b[2], right: b[3],
                          width: b[3] - b[1], height: b[2] - b[0] };
          } else {
            // ページ相対座標系
            boundsObj = getBoundsOnPage(item, pageIndex);
          }
        } catch (e) {}

        var info = {
          uuid: uuid,
          type: itemType,
          name: "",
          pageIndex: pageIndex,
          bounds: boundsObj,
          locked: false,
          hidden: false,
          layerName: ""
        };

        try { info.name = item.name || ""; } catch (e) {}
        try { info.locked = item.locked; } catch (e) {}
        try { info.hidden = item.hidden; } catch (e) {}
        try { info.layerName = getParentLayerName(item); } catch (e) {}

        // 型別の属性
        if (itemType === "TextFrame") {
          try { info.contents = item.contents; } catch (e) { info.contents = ""; }
          try {
            var tfInfo = getTextFrameInfo(item);
            info.storyId = tfInfo.storyId;
            info.overflows = tfInfo.overflows;
            info.hasNext = tfInfo.hasNext;
            info.hasPrev = tfInfo.hasPrev;
          } catch (e) {}
          try {
            if (item.paragraphs.length > 0) {
              var firstPara = item.paragraphs[0];
              info.appliedParagraphStyle = firstPara.appliedParagraphStyle ? firstPara.appliedParagraphStyle.name : "";
            }
          } catch (e) {}
        }

        if (itemType === "Rectangle" || itemType === "Oval" || itemType === "Polygon" || itemType === "GraphicLine") {
          try { info.fillColor = colorToObject(item.fillColor); } catch (e) {}
          try {
            info.strokeColor = colorToObject(item.strokeColor);
            info.strokeWeight = item.strokeWeight;
          } catch (e) {}
        }

        if (itemType === "Group") {
          try { info.childCount = item.allPageItems.length; } catch (e) {}
        }

        // リンク画像の場合
        if (itemType === "Rectangle" || itemType === "Oval") {
          try {
            var gfx = item.graphics;
            if (gfx && gfx.length > 0) {
              var gfxItem = gfx[0];
              info.hasGraphic = true;
              try {
                var lnk = gfxItem.itemLink;
                if (lnk) {
                  info.linkName = lnk.name;
                  info.linkStatus = lnk.status.toString();
                }
              } catch (e2) {}
            }
          } catch (e) {}
        }

        items.push(info);
      }

      writeResultFile(RESULT_PATH, {
        selectionCount: sel.length,
        coordinateSystem: coordSystem,
        items: items
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_selection',
    {
      title: 'Get Selection',
      description: 'Get detailed information about the currently selected objects in InDesign, including type, bounds, page index, and type-specific attributes.',
      inputSchema: {
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
