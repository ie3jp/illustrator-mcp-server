import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * list_text_frames — テキストフレーム一覧の取得
 * List text frames with threading info (storyId, prev/next, overflows). Page index filter.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "page-relative";
    var filterLayer = (params && params.layer_name) ? params.layer_name : null;
    var filterPage = (params && typeof params.page_index === "number") ? params.page_index : null;
    var contentsOnly = (params && params.contents_only === true) ? true : false;
    var paramOffset = (params && typeof params.offset === "number") ? params.offset : 0;
    var paramLimit = (params && typeof params.limit === "number") ? params.limit : null;

    // ページインデックスの範囲チェック
    if (filterPage !== null && (filterPage < 0 || filterPage >= doc.pages.length)) {
      writeResultFile(RESULT_PATH, {
        error: true,
        message: "Page index " + filterPage + " is out of range (0-" + (doc.pages.length - 1) + ")"
      });
    } else {

      // レイヤーフィルタリング
      var sourceFrames = null;
      if (filterLayer) {
        var targetLayer = null;
        for (var li = 0; li < doc.layers.length; li++) {
          if (doc.layers[li].name === filterLayer) {
            targetLayer = doc.layers[li];
            break;
          }
        }
        if (!targetLayer) {
          writeResultFile(RESULT_PATH, {
            error: true,
            message: "Layer '" + filterLayer + "' not found"
          });
          sourceFrames = null;
        } else {
          sourceFrames = targetLayer.textFrames;
        }
      } else {
        sourceFrames = doc.textFrames;
      }

      if (sourceFrames !== null) {
        var textFrames = [];

        for (var i = 0; i < sourceFrames.length; i++) {
          var tf = sourceFrames[i];

          // ページフィルタリング
          var itemPageIndex = -1;
          try {
            var pp = tf.parentPage;
            if (pp) itemPageIndex = pp.index;
          } catch (e) {}

          if (filterPage !== null && itemPageIndex !== filterPage) {
            continue;
          }

          if (contentsOnly) {
            var contentsItem = {
              uuid: ensureUUID(tf),
              contents: tf.contents,
              pageIndex: itemPageIndex
            };
            textFrames.push(contentsItem);
            continue;
          }

          // バウンズ取得
          var boundsObj = null;
          try {
            boundsObj = getBoundsOnPage(tf, itemPageIndex);
          } catch (e) {
            try {
              var gb = tf.geometricBounds;
              boundsObj = { top: gb[0], left: gb[1], bottom: gb[2], right: gb[3],
                            width: gb[3] - gb[1], height: gb[2] - gb[0] };
            } catch (e2) {}
          }

          // スレッド情報
          var tfInfo = getTextFrameInfo(tf);

          // 段落スタイル（先頭段落）
          var paragraphStyleName = "";
          try {
            if (tf.paragraphs.length > 0) {
              var ps = tf.paragraphs[0].appliedParagraphStyle;
              if (ps) paragraphStyleName = ps.name || "";
            }
          } catch (e) {}

          // フォント情報（先頭文字）
          var fontFamily = null;
          var fontSize = null;
          try {
            if (tf.characters.length > 0) {
              var firstChar = tf.characters[0];
              fontFamily = firstChar.appliedFont ? firstChar.appliedFont.fontFamily : null;
              fontSize = firstChar.pointSize || null;
            }
          } catch (e) {}

          var info = {
            uuid: tfInfo.uuid,
            contents: tf.contents,
            pageIndex: itemPageIndex,
            bounds: boundsObj,
            storyId: tfInfo.storyId,
            overflows: tfInfo.overflows,
            hasNext: tfInfo.hasNext,
            hasPrev: tfInfo.hasPrev,
            paragraphStyle: paragraphStyleName,
            fontFamily: fontFamily,
            fontSize: fontSize,
            layerName: getParentLayerName(tf)
          };

          textFrames.push(info);
        }

        var totalCount = textFrames.length;
        if (paramOffset > 0 || paramLimit !== null) {
          textFrames = textFrames.slice(paramOffset, paramLimit !== null ? paramOffset + paramLimit : textFrames.length);
        }

        var payload = {
          totalCount: totalCount,
          count: textFrames.length,
          textFrames: textFrames
        };
        if (!contentsOnly) { payload.coordinateSystem = coordSystem; }
        if (paramOffset > 0 || paramLimit !== null) { payload.offset = paramOffset; }
        writeResultFile(RESULT_PATH, payload);
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to list text frames: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'list_text_frames',
    {
      title: 'List Text Frames',
      description: 'List InDesign text frames with threading info (storyId, prev/next linkage, overflow). Supports page_index filter, layer filter, pagination, and lightweight contents-only mode.',
      inputSchema: {
        layer_name: z.string().optional().describe('Filter by layer name'),
        page_index: z.number().int().min(0).optional().describe('Filter by page index (0-based)'),
        contents_only: z
          .boolean()
          .optional()
          .describe('When true, return only uuid, contents, and pageIndex (no position/font info). Useful for text proofreading.'),
        offset: z.number().int().min(0).optional().describe('Number of items to skip (for pagination)'),
        limit: z.number().int().min(1).optional().describe('Maximum number of items to return (for pagination)'),
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
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
