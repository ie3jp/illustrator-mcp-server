import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_text_frame_detail — テキストフレームの詳細情報取得
 * Detailed text analysis: character runs, paragraph styles applied, tables count, footnotes, threading.
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
    var targetUUID = params.uuid;

    if (!targetUUID) {
      writeResultFile(RESULT_PATH, { error: true, message: "uuid parameter is required" });
    } else {
      // テキストフレームをUUIDで検索
      var found = findItemByUUID(targetUUID);

      if (!found) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "No text frame found matching UUID: " + targetUUID
        });
      } else if (found.constructor.name !== "TextFrame" && getItemType(found) !== "TextFrame") {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "Item with UUID " + targetUUID + " is not a TextFrame (type: " + getItemType(found) + ")"
        });
      } else {
        var tf = found;

        // ページ情報
        var pageIndex = -1;
        try {
          var pp = tf.parentPage;
          if (pp) pageIndex = pp.index;
        } catch (e) {}

        // バウンズ
        var boundsObj = null;
        try {
          boundsObj = getBoundsOnPage(tf, pageIndex);
        } catch (e) {
          try {
            var gb = tf.geometricBounds;
            boundsObj = { top: gb[0], left: gb[1], bottom: gb[2], right: gb[3],
                          width: gb[3] - gb[1], height: gb[2] - gb[0] };
          } catch (e2) {}
        }

        // スレッド情報
        var tfInfo = getTextFrameInfo(tf);

        // 段落属性（各段落ごと）
        var paraAttrs = [];
        try {
          for (var pi = 0; pi < tf.paragraphs.length; pi++) {
            var para = tf.paragraphs[pi];
            var paraInfo = {
              index: pi,
              text: "",
              paragraphStyle: "",
              characterStyle: "",
              justification: "left",
              leading: 0,
              autoLeading: true,
              spaceBefore: 0,
              spaceAfter: 0,
              leftIndent: 0,
              rightIndent: 0,
              firstLineIndent: 0
            };

            try {
              var ptxt = para.contents || "";
              paraInfo.text = ptxt.length > 60 ? ptxt.substring(0, 60) + "..." : ptxt;
            } catch (e2) {}

            try {
              if (para.appliedParagraphStyle) {
                paraInfo.paragraphStyle = para.appliedParagraphStyle.name || "";
              }
            } catch (e2) {}

            try { paraInfo.spaceBefore = para.spaceBefore || 0; } catch (e2) {}
            try { paraInfo.spaceAfter = para.spaceAfter || 0; } catch (e2) {}
            try { paraInfo.leftIndent = para.leftIndent || 0; } catch (e2) {}
            try { paraInfo.rightIndent = para.rightIndent || 0; } catch (e2) {}
            try { paraInfo.firstLineIndent = para.firstLineIndent || 0; } catch (e2) {}

            try {
              var j = para.justification;
              if (j === Justification.LEFT_ALIGN) paraInfo.justification = "left";
              else if (j === Justification.CENTER_ALIGN) paraInfo.justification = "center";
              else if (j === Justification.RIGHT_ALIGN) paraInfo.justification = "right";
              else if (j === Justification.LEFT_JUSTIFIED) paraInfo.justification = "justify-left";
              else if (j === Justification.CENTER_JUSTIFIED) paraInfo.justification = "justify-center";
              else if (j === Justification.RIGHT_JUSTIFIED) paraInfo.justification = "justify-right";
              else if (j === Justification.FULLY_JUSTIFIED) paraInfo.justification = "justify-all";
              else paraInfo.justification = String(j);
            } catch (e2) {}

            try { paraInfo.leading = para.leading || 0; } catch (e2) {}
            try { paraInfo.autoLeading = para.autoLeading !== false; } catch (e2) {}

            paraAttrs.push(paraInfo);
          }
        } catch (e) {}

        // 文字ランの生成（同一属性の連続文字をまとめる）
        var runs = [];
        try {
          var chars = tf.characters;
          var prevKey = "";
          var currentRun = null;

          for (var ci = 0; ci < chars.length; ci++) {
            var ch = chars[ci];
            var chInfo = {
              fontFamily: "",
              fontStyle: "",
              fontSize: 0,
              pointSize: 0,
              color: { type: "none" },
              tracking: 0,
              baselineShift: 0,
              horizontalScale: 100,
              verticalScale: 100,
              characterStyle: ""
            };

            try {
              var af = ch.appliedFont;
              if (af) {
                chInfo.fontFamily = af.fontFamily || "";
                chInfo.fontStyle = af.fontStyleName || "";
              }
            } catch (e2) {}
            try { chInfo.fontSize = ch.pointSize || 0; chInfo.pointSize = chInfo.fontSize; } catch (e2) {}
            try { chInfo.color = colorToObject(ch.fillColor); } catch (e2) {}
            try { chInfo.tracking = ch.tracking || 0; } catch (e2) {}
            try { chInfo.baselineShift = ch.baselineShift || 0; } catch (e2) {}
            try { chInfo.horizontalScale = ch.horizontalScale || 100; } catch (e2) {}
            try { chInfo.verticalScale = ch.verticalScale || 100; } catch (e2) {}
            try {
              if (ch.appliedCharacterStyle) {
                chInfo.characterStyle = ch.appliedCharacterStyle.name || "";
              }
            } catch (e2) {}

            var key = chInfo.fontFamily + "|" + chInfo.fontStyle + "|" + chInfo.fontSize
              + "|" + chInfo.tracking + "|" + chInfo.baselineShift
              + "|" + chInfo.horizontalScale + "|" + chInfo.verticalScale
              + "|" + chInfo.characterStyle
              + "|" + (chInfo.color.type === "rgb"
                       ? chInfo.color.r + "," + chInfo.color.g + "," + chInfo.color.b
                       : chInfo.color.type === "cmyk"
                       ? chInfo.color.c + "," + chInfo.color.m + "," + chInfo.color.y + "," + chInfo.color.k
                       : chInfo.color.type);

            if (key === prevKey && currentRun) {
              currentRun.text += ch.contents;
            } else {
              currentRun = {
                text: ch.contents,
                fontFamily: chInfo.fontFamily,
                fontStyle: chInfo.fontStyle,
                fontSize: chInfo.fontSize,
                color: chInfo.color,
                tracking: chInfo.tracking,
                baselineShift: chInfo.baselineShift,
                horizontalScale: chInfo.horizontalScale,
                verticalScale: chInfo.verticalScale,
                characterStyle: chInfo.characterStyle
              };
              runs.push(currentRun);
              prevKey = key;
            }
          }
        } catch (e) {}

        // テーブル数
        var tableCount = 0;
        try {
          tableCount = tf.parentStory ? tf.parentStory.tables.length : 0;
        } catch (e) {}

        // 脚注数
        var footnoteCount = 0;
        try {
          footnoteCount = tf.parentStory ? tf.parentStory.footnotes.length : 0;
        } catch (e) {}

        // アンカー付きオブジェクト数
        var anchoredObjectCount = 0;
        try {
          anchoredObjectCount = tf.parentStory ? tf.parentStory.anchoredObjectSettings.length : 0;
        } catch (e) {}

        writeResultFile(RESULT_PATH, {
          uuid: targetUUID,
          contents: tf.contents,
          pageIndex: pageIndex,
          bounds: boundsObj,
          coordinateSystem: coordSystem,
          storyId: tfInfo.storyId,
          overflows: tfInfo.overflows,
          hasNext: tfInfo.hasNext,
          hasPrev: tfInfo.hasPrev,
          layerName: getParentLayerName(tf),
          tableCount: tableCount,
          footnoteCount: footnoteCount,
          anchoredObjectCount: anchoredObjectCount,
          characterRuns: runs,
          paragraphAttributes: paraAttrs
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to get text frame detail: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_text_frame_detail',
    {
      title: 'Get Text Frame Detail',
      description: 'Get detailed InDesign text frame attributes: character runs (font, size, color, tracking, scale), paragraph attributes (style, justification, indent, leading), threading info, table count, footnotes.',
      inputSchema: {
        uuid: z.string().describe('UUID of the target text frame'),
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
