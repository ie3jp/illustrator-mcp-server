import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var filterLayer = (params && params.layer_name) ? params.layer_name : null;
    var filterArtboard = (params && typeof params.artboard_index === "number") ? params.artboard_index : null;
    var sortMode = (params && params.sort) ? params.sort : null;
    var contentsOnly = (params && params.contents_only === true) ? true : false;
    var paramOffset = (params && typeof params.offset === "number") ? params.offset : 0;
    var paramLimit = (params && typeof params.limit === "number") ? params.limit : null;

    // アートボードインデックスの範囲チェック
    if (filterArtboard !== null && (filterArtboard < 0 || filterArtboard >= doc.artboards.length)) {
      writeResultFile(RESULT_PATH, {
        error: true,
        message: "Artboard index " + filterArtboard + " is out of range (0-" + (doc.artboards.length - 1) + ")"
      });
    } else {

      // テキストフレームのソースを決定
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
        var artboardRect = (filterArtboard !== null) ? getArtboardRectByIndex(filterArtboard) : null;

        var textFrames = [];
        var canPaginateEarly = contentsOnly && sortMode !== "reading-order";
        var earlySkipped = 0;
        var earlyCollected = 0;

        for (var i = 0; i < sourceFrames.length; i++) {
          var tf = sourceFrames[i];

          // アートボードインデックスを取得
          var itemArtboardIndex = getArtboardIndexForItem(tf);

          // アートボードフィルタリング
          if (filterArtboard !== null) {
            if (itemArtboardIndex !== filterArtboard) continue;
          }

          // contentsOnly + sortなし: ループ内でページネーション適用
          if (canPaginateEarly) {
            if (earlySkipped < paramOffset) { earlySkipped++; continue; }
            if (paramLimit !== null && earlyCollected >= paramLimit) break;
          }

          if (contentsOnly) {
            var contentsItem = {
              uuid: ensureUUID(tf),
              contents: tf.contents,
              artboardIndex: itemArtboardIndex
            };
            if (sortMode === "reading-order") {
              var sortAbRect = null;
              if (coordSystem === "artboard-web" && itemArtboardIndex >= 0) {
                sortAbRect = getArtboardRectByIndex(itemArtboardIndex);
              }
              var sortBounds = getBounds(tf, coordSystem, sortAbRect);
              contentsItem.x = sortBounds.x;
              contentsItem.y = sortBounds.y;
            }
            textFrames.push(contentsItem);
            if (canPaginateEarly) { earlyCollected++; }
            continue;
          }

          var textKind = getTextKind(tf);

          // 座標変換用のアートボード矩形
          var boundsAbRect = artboardRect;
          if (!boundsAbRect && coordSystem === "artboard-web") {
            if (itemArtboardIndex >= 0) {
              boundsAbRect = getArtboardRectByIndex(itemArtboardIndex);
            }
          }

          var bounds = getBounds(tf, coordSystem, boundsAbRect);

          // フォント情報（先頭 textRange）
          var fontFamily = null;
          var fontSize = null;
          try {
            if (tf.textRanges.length > 0) {
              var firstRange = tf.textRanges[0];
              fontFamily = firstRange.characterAttributes.textFont.family;
              fontSize = firstRange.characterAttributes.size;
            }
          } catch (e) {
            // フォント情報が取得できない場合は null のまま
          }

          // 段落スタイル名
          var paragraphStyleName = "";
          try {
            if (tf.textRanges.length > 0) {
              var pStyle = tf.textRanges[0].paragraphAttributes.paragraphStyle;
              if (pStyle) {
                paragraphStyleName = pStyle.name || "";
              }
            }
          } catch (e) {
            // 段落スタイルが未設定の場合
          }

          // 文字スタイル名
          var characterStyleName = "";
          try {
            if (tf.textRanges.length > 0) {
              var cStyle = tf.textRanges[0].characterAttributes.characterStyle;
              if (cStyle) {
                characterStyleName = cStyle.name || "";
              }
            }
          } catch (e) {
            // 文字スタイルが未設定の場合
          }

          var info = {
            uuid: ensureUUID(tf),
            zIndex: getZIndex(tf),
            contents: tf.contents,
            artboardIndex: itemArtboardIndex,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            textKind: textKind,
            fontFamily: fontFamily,
            fontSize: fontSize,
            paragraphStyle: paragraphStyleName,
            characterStyle: characterStyleName
          };

          textFrames.push(info);
        }

        if (sortMode === "reading-order") {
          // document座標はY軸上向き正なので降順、artboard-web座標はY軸下向き正なので昇順
          var yDir = (coordSystem === "document") ? -1 : 1;
          textFrames.sort(function(a, b) {
            if (a.artboardIndex !== b.artboardIndex) return a.artboardIndex - b.artboardIndex;
            // y差が5pt以内なら同一行とみなしx座標で比較
            if (Math.abs(a.y - b.y) > 5) return (a.y - b.y) * yDir;
            return a.x - b.x;
          });
          if (contentsOnly) {
            for (var si = 0; si < textFrames.length; si++) {
              delete textFrames[si].x;
              delete textFrames[si].y;
            }
          }
        }

        // totalCount: 早期ページネーション時はbreakで途切れた残りを加算
        var totalCount;
        if (canPaginateEarly && paramLimit !== null && earlyCollected >= paramLimit) {
          if (filterArtboard === null) {
            totalCount = sourceFrames.length;
          } else {
            totalCount = earlySkipped + earlyCollected;
            for (var ri = i; ri < sourceFrames.length; ri++) {
              if (getArtboardIndexForItem(sourceFrames[ri]) === filterArtboard) totalCount++;
            }
          }
        } else if (canPaginateEarly) {
          totalCount = earlySkipped + earlyCollected;
        } else {
          totalCount = textFrames.length;
          if (paramOffset > 0 || paramLimit !== null) {
            textFrames = textFrames.slice(paramOffset, paramLimit !== null ? paramOffset + paramLimit : textFrames.length);
          }
        }

        var payload = { totalCount: totalCount, count: textFrames.length, textFrames: textFrames };
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
      description: 'List text frames with summary-level information. Supports reading-order sort, pagination, and a lightweight contents-only mode.',
      inputSchema: {
        layer_name: z.string().optional().describe('Filter by layer name'),
        artboard_index: z.number().int().min(0).optional().describe('Filter by artboard index (0-based integer)'),
        sort: z.enum(['reading-order']).optional().describe('Sort order. "reading-order" sorts by artboardIndex asc → y asc → x asc (rows within ~5pt tolerance are treated as the same line)'),
        contents_only: z.boolean().optional().describe('When true, return only uuid, contents, and artboardIndex (no position/font/style info). Useful for text proofreading.'),
        offset: z.number().int().min(0).optional().describe('Number of items to skip (for pagination). Applied after sort.'),
        limit: z.number().int().min(1).optional().describe('Maximum number of items to return (for pagination). Applied after sort.'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
