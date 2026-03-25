import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';

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
        // アートボード矩形の取得（座標変換用）
        var artboardRect = null;
        if (filterArtboard !== null) {
          artboardRect = doc.artboards[filterArtboard].artboardRect;
        }

        var textFrames = [];
        for (var i = 0; i < sourceFrames.length; i++) {
          var tf = sourceFrames[i];

          // アートボードフィルタリング
          if (filterArtboard !== null) {
            var abIdx = getArtboardIndexForItem(tf);
            if (abIdx !== filterArtboard) continue;
          }

          // テキスト種別
          var textKind = "unknown";
          if (tf.kind === TextType.POINTTEXT) {
            textKind = "point";
          } else if (tf.kind === TextType.AREATEXT) {
            textKind = "area";
          } else if (tf.kind === TextType.PATHTEXT) {
            textKind = "path";
          }

          // 座標変換用のアートボード矩形
          var boundsAbRect = artboardRect;
          if (!boundsAbRect && coordSystem === "artboard-web") {
            var itemAbIdx = getArtboardIndexForItem(tf);
            if (itemAbIdx >= 0) {
              boundsAbRect = doc.artboards[itemAbIdx].artboardRect;
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

        writeResultFile(RESULT_PATH, {
          coordinateSystem: coordSystem,
          count: textFrames.length,
          textFrames: textFrames
        });
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
      description: 'List text frames with summary-level information',
      inputSchema: {
        layer_name: z.string().optional().describe('Filter by layer name'),
        artboard_index: z.number().int().min(0).optional().describe('Filter by artboard index (0-based integer)'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
