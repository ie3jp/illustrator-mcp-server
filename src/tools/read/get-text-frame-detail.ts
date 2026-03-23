import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var targetUUID = params.uuid;

    if (!targetUUID) {
      writeResultFile(RESULT_PATH, { error: true, message: "uuid parameter is required" });
    } else {
      // textFrames を走査して UUID が一致するテキストフレームを探す
      var found = null;
      for (var i = 0; i < doc.textFrames.length; i++) {
        var item = doc.textFrames[i];
        var itemUUID = ensureUUID(item);
        if (itemUUID === targetUUID) {
          found = item;
          break;
        }
      }

      if (!found) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "No text frame found matching UUID: " + targetUUID
        });
      } else {
        var tf = found;

        // テキスト種別
        var textKind = "unknown";
        if (tf.kind === TextType.POINTTEXT) {
          textKind = "point";
        } else if (tf.kind === TextType.AREATEXT) {
          textKind = "area";
        } else if (tf.kind === TextType.PATHTEXT) {
          textKind = "path";
        }

        // 座標
        var itemAbIdx = getArtboardIndexForItem(tf);
        var boundsAbRect = null;
        if (coordSystem === "artboard-web" && itemAbIdx >= 0) {
          boundsAbRect = doc.artboards[itemAbIdx].artboardRect;
        }
        var bounds = getBounds(tf, coordSystem, boundsAbRect);

        // 文字属性（各 textRange ごと）
        var charAttrs = [];
        for (var ri = 0; ri < tf.textRanges.length; ri++) {
          var tr = tf.textRanges[ri];
          var ca = tr.characterAttributes;
          var charInfo = {
            text: tr.contents,
            fontFamily: "",
            fontStyle: "",
            fontSize: 0,
            color: { type: "none" },
            kerning: 0,
            tracking: 0,
            baselineShift: 0,
            horizontalScale: 100,
            verticalScale: 100,
            characterStyle: ""
          };

          try { charInfo.fontFamily = ca.textFont.family; } catch (e) {}
          try { charInfo.fontStyle = ca.textFont.style; } catch (e) {}
          try { charInfo.fontSize = ca.size; } catch (e) {}
          try { charInfo.color = colorToObject(ca.fillColor); } catch (e) {}
          try { charInfo.kerning = ca.kerningMethod ? ca.kerningMethod : 0; } catch (e) {}
          try { charInfo.tracking = ca.tracking; } catch (e) {}
          try { charInfo.baselineShift = ca.baselineShift; } catch (e) {}
          try { charInfo.horizontalScale = ca.horizontalScale; } catch (e) {}
          try { charInfo.verticalScale = ca.verticalScale; } catch (e) {}
          try {
            if (ca.characterStyle) {
              charInfo.characterStyle = ca.characterStyle.name || "";
            }
          } catch (e) {}

          charAttrs.push(charInfo);
        }

        // 段落属性（各段落ごと）
        var paraAttrs = [];
        for (var pi = 0; pi < tf.paragraphs.length; pi++) {
          var para = tf.paragraphs[pi];
          var pa = para.paragraphAttributes;
          var paraInfo = {
            text: para.contents,
            leading: 0,
            autoLeading: false,
            firstLineIndent: 0,
            leftIndent: 0,
            rightIndent: 0,
            spaceBefore: 0,
            spaceAfter: 0,
            justification: "left",
            hyphenation: false,
            paragraphStyle: ""
          };

          try { paraInfo.leading = pa.leading; } catch (e) {}
          try { paraInfo.autoLeading = pa.autoLeading; } catch (e) {}
          try { paraInfo.firstLineIndent = pa.firstLineIndent; } catch (e) {}
          try { paraInfo.leftIndent = pa.leftIndent; } catch (e) {}
          try { paraInfo.rightIndent = pa.rightIndent; } catch (e) {}
          try { paraInfo.spaceBefore = pa.spaceBefore; } catch (e) {}
          try { paraInfo.spaceAfter = pa.spaceAfter; } catch (e) {}
          try {
            var j = pa.justification;
            if (j === Justification.LEFT) paraInfo.justification = "left";
            else if (j === Justification.CENTER) paraInfo.justification = "center";
            else if (j === Justification.RIGHT) paraInfo.justification = "right";
            else if (j === Justification.FULLJUSTIFYLASTLINELEFT) paraInfo.justification = "justify-left";
            else if (j === Justification.FULLJUSTIFYLASTLINECENTER) paraInfo.justification = "justify-center";
            else if (j === Justification.FULLJUSTIFYLASTLINERIGHT) paraInfo.justification = "justify-right";
            else if (j === Justification.FULLJUSTIFY) paraInfo.justification = "justify-all";
            else paraInfo.justification = j.toString();
          } catch (e) {}
          try { paraInfo.hyphenation = pa.hyphenation; } catch (e) {}
          try {
            if (pa.paragraphStyle) {
              paraInfo.paragraphStyle = pa.paragraphStyle.name || "";
            }
          } catch (e) {}

          paraAttrs.push(paraInfo);
        }

        var result = {
          uuid: targetUUID,
          contents: tf.contents,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          textKind: textKind,
          zIndex: getZIndex(tf),
          artboardIndex: itemAbIdx,
          coordinateSystem: coordSystem,
          characterAttributes: charAttrs,
          paragraphAttributes: paraAttrs
        };

        writeResultFile(RESULT_PATH, result);
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
      description: 'Get detailed attributes of a specific text frame',
      inputSchema: {
        uuid: z.string().describe('UUID of the target text frame'),
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe('Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
