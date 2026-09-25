import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { READ_ANNOTATIONS, coerceBoolean } from '../modify/shared.js';
/**
 * list_text_frames — テキストフレーム一覧の取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItems/ — TextFrameItems collection
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItem/ — contents, kind, textRange
 */
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
          // Layer.textFrames はグループ内・サブレイヤー内のテキストを含まないため再帰的に集める
          sourceFrames = [];
          iterateAllItems(targetLayer, function(it) {
            if (it.typename === "TextFrame") sourceFrames.push(it);
          });
        }
      } else {
        sourceFrames = doc.textFrames;
      }

      if (sourceFrames !== null) {
        var artboardRect = (filterArtboard !== null) ? getArtboardRectByIndex(filterArtboard) : null;

        // 組み方向（縦組みは reading-order の並び順が変わる）
        function getOrientation(frame) {
          try { if (frame.orientation === TextOrientation.VERTICAL) return "vertical"; } catch (e) {}
          return "horizontal";
        }

        // reading-order 用のソートキー（結果からは後で取り除く）
        function attachSortKeys(entry, frame, abIdx) {
          var sortAbRect = null;
          if (coordSystem === "artboard-web" && abIdx >= 0) {
            sortAbRect = getArtboardRectByIndex(abIdx);
          }
          var sb = getBounds(frame, coordSystem, sortAbRect);
          entry._sortX = sb.x;
          entry._sortRight = sb.x + sb.width;
          entry._sortY = sb.y;
          entry._sortVertical = (getOrientation(frame) === "vertical");
        }

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
              attachSortKeys(contentsItem, tf, itemArtboardIndex);
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

          // 段落スタイル名・文字スタイル名（先頭 textRange が参照するスタイル）。
          // ParagraphAttributes / CharacterAttributes にスタイルのプロパティはなく、
          // TextRange.paragraphStyles / characterStyles から読む
          var paragraphStyleName = "";
          var characterStyleName = "";
          try {
            if (tf.textRanges.length > 0) {
              var firstTr = tf.textRanges[0];
              try {
                if (firstTr.paragraphStyles.length > 0) paragraphStyleName = firstTr.paragraphStyles[0].name || "";
              } catch (e) {}
              try {
                if (firstTr.characterStyles.length > 0) characterStyleName = firstTr.characterStyles[0].name || "";
              } catch (e) {}
            }
          } catch (e) {
            // スタイル情報が取得できない場合は空文字のまま
          }

          // スレッド連結（前後のフレーム）。連結がなければ null
          var nextFrameUUID = null;
          var previousFrameUUID = null;
          try { if (tf.nextFrame) nextFrameUUID = ensureUUID(tf.nextFrame); } catch (e) {}
          try { if (tf.previousFrame) previousFrameUUID = ensureUUID(tf.previousFrame); } catch (e) {}

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
            orientation: getOrientation(tf),
            nextFrameUUID: nextFrameUUID,
            previousFrameUUID: previousFrameUUID,
            fontFamily: fontFamily,
            fontSize: fontSize,
            paragraphStyle: paragraphStyleName,
            characterStyle: characterStyleName
          };
          if (sortMode === "reading-order") {
            attachSortKeys(info, tf, itemArtboardIndex);
          }

          textFrames.push(info);
        }

        if (sortMode === "reading-order") {
          // document座標はY軸上向き正なので降順、artboard-web座標はY軸下向き正なので昇順
          var yDir = (coordSystem === "document") ? -1 : 1;
          // アートボードごとに縦組みフレームが過半数なら縦組みの読み順（列を右→左、列内は上→下）。
          // 比較関数の一貫性を保つため、判定はフレーム単位ではなくアートボード単位で行う
          var verticalCount = {};
          var horizontalCount = {};
          for (var vi = 0; vi < textFrames.length; vi++) {
            var abKey = "ab" + textFrames[vi].artboardIndex;
            if (textFrames[vi]._sortVertical) verticalCount[abKey] = (verticalCount[abKey] || 0) + 1;
            else horizontalCount[abKey] = (horizontalCount[abKey] || 0) + 1;
          }
          textFrames.sort(function(a, b) {
            if (a.artboardIndex !== b.artboardIndex) return a.artboardIndex - b.artboardIndex;
            var k = "ab" + a.artboardIndex;
            if ((verticalCount[k] || 0) > (horizontalCount[k] || 0)) {
              // 縦組み: 右端の差が5pt以内なら同一列とみなし上→下
              if (Math.abs(a._sortRight - b._sortRight) > 5) return b._sortRight - a._sortRight;
              return (a._sortY - b._sortY) * yDir;
            }
            // 横組み: y差が5pt以内なら同一行とみなしx座標で比較
            if (Math.abs(a._sortY - b._sortY) > 5) return (a._sortY - b._sortY) * yDir;
            return a._sortX - b._sortX;
          });
          for (var si = 0; si < textFrames.length; si++) {
            delete textFrames[si]._sortX;
            delete textFrames[si]._sortRight;
            delete textFrames[si]._sortY;
            delete textFrames[si]._sortVertical;
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
      description: 'List text frames with summary-level information (including orientation and threaded-frame links nextFrameUUID/previousFrameUUID). Supports reading-order sort, pagination, and a lightweight contents-only mode. layer_name includes text inside groups and sublayers of that layer.',
      inputSchema: {
        layer_name: z.string().optional().describe('Filter by layer name'),
        artboard_index: z.number().int().min(0).optional().describe('Filter by artboard index (0-based integer)'),
        sort: z.enum(['reading-order']).optional().describe('Sort order. "reading-order" sorts by artboardIndex asc → y asc → x asc (rows within ~5pt tolerance are treated as the same line). On artboards where most frames are vertical text, columns are read right → left, then top → bottom.'),
        contents_only: coerceBoolean.optional().describe('When true, return only uuid, contents, and artboardIndex (no position/font/style info). Useful for text proofreading.'),
        offset: z.number().int().min(0).optional().describe('Number of items to skip (for pagination). Applied after sort.'),
        limit: z.number().int().min(1).optional().describe('Maximum number of items to return (for pagination). Applied after sort.'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { resolveCoordinate: true });
    },
  );
}
