import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import {
  colorSchema,
  COLOR_HELPERS_JSX,
  FONT_HELPERS_JSX,
  JUSTIFICATION_JSX,
  justificationSchema,
  WRITE_ANNOTATIONS,
} from './shared.js';

/**
 * create_text_frame — テキストフレームの作成（ポイント/エリア）
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItems/ — TextFrameItems.pointText(), areaText()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/CharacterAttributes/ — size, textFont, tracking, leading, autoLeading
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/ParagraphAttributes/ — justification
 *
 * ポイント文字の pointText([x, y]) はアンカー点指定で、y は 1 行目のベースライン。
 * modify_object の position（バウンディングボックス左上）とは基準が違うため description で明示する。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    ${COLOR_HELPERS_JSX}
    ${FONT_HELPERS_JSX}
    ${JUSTIFICATION_JSX}

    var inputX = params.x;
    var inputY = params.y;
    var kind = params.kind || "point";

    var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;
    var aiCoords = webToAiPoint(inputX, inputY, coordSystem, abRect);
    var aiX = aiCoords[0];
    var aiY = aiCoords[1];

    // フォントは作成前に解決する。見つからなければ何も作らずエラー
    // （JSX 全体は jsx-runner が関数で包むため return で抜けられる）
    var resolvedFont = null;
    if (params.font_name) {
      try {
        resolvedFont = app.textFonts.getByName(params.font_name);
      } catch (e) {
        writeResultFile(RESULT_PATH, fontNotFoundResult(params.font_name));
        return;
      }
    }

    var targetLayer = resolveTargetLayer(doc, params.layer_name);

    var tf;
    var rectPath = null;
    if (kind === "area") {
      var w = params.width || 100;
      var h = params.height || 100;
      rectPath = targetLayer.pathItems.rectangle(aiY, aiX, w, h);
      try {
        tf = targetLayer.textFrames.areaText(rectPath);
      } catch (eArea) {
        try { rectPath.remove(); } catch (_) {}
        throw eArea;
      }
    } else {
      tf = targetLayer.textFrames.pointText([aiX, aiY]);
    }

    var rawContents = params.contents || "";
    // Handle literal \\n (backslash + n) from MCP parameter passing
    rawContents = rawContents.replace(/\\\\n/g, String.fromCharCode(10));
    tf.contents = rawContents.split(String.fromCharCode(10)).join(String.fromCharCode(13));

    if (params.name) {
      tf.name = params.name;
    }

    var charAttrs = tf.textRange.characterAttributes;

    if (resolvedFont) {
      charAttrs.textFont = resolvedFont;
    }

    if (typeof params.font_size === "number") {
      charAttrs.size = params.font_size;
    }

    if (typeof params.tracking === "number") {
      charAttrs.tracking = params.tracking;
    }

    if (typeof params.fill !== "undefined") {
      charAttrs.fillColor = createColor(params.fill);
    }

    // 行送り: 指定時は自動行送りを切って固定値にする（未指定は自動のまま）
    if (typeof params.leading === "number") {
      charAttrs.autoLeading = false;
      charAttrs.leading = params.leading;
    }

    if (params.justification) {
      applyJustification(tf, params.justification);
    }

    var uuid = ensureUUID(tf);
    var resultData = { uuid: uuid, coordinateSystem: coordSystem, verified: verifyItem(tf, coordSystem, abRect) };
    writeResultFile(RESULT_PATH, appendColorSpaceWarnings(resultData));
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create text frame: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_text_frame',
    {
      title: 'Create Text Frame',
      description:
        'Create a text frame. Positioning differs by kind: for point text (x, y) is the text ANCHOR — y is the BASELINE of the first line (glyphs extend above it), and x is the left edge, center, or right edge depending on justification (so right-aligned text only needs justification: "right" with x at the right edge). For area text (x, y) is the top-left of the text area. verified.bounds always reports the resulting bounding box (top-left, width, height) — that box is what modify_object position moves. If font_name is not found, nothing is created and an error with font_candidates is returned. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        x: z.number().describe('X coordinate. Point text: anchor x (left/center/right edge per justification). Area text: left edge.'),
        y: z.number().describe('Y coordinate. Point text: BASELINE of the first line, not the top of the glyphs. Area text: top edge.'),
        contents: z.string().describe('Text contents. Use \\n for line breaks (automatically converted to CR for Illustrator).'),
        kind: z
          .enum(['point', 'area'])
          .optional()
          .default('point')
          .describe('Text frame type (point or area)'),
        width: z.number().optional().describe('Area text width'),
        height: z.number().optional().describe('Area text height'),
        font_name: z
          .string()
          .optional()
          .describe('Exact font name as listed by list_fonts (the "name" field, e.g. "HelveticaNeue-Bold", "ArialMT"). Not a partial match: if not found, nothing is created and an error with font_candidates is returned.'),
        font_size: z.number().optional().describe('Font size (pt)'),
        tracking: z
          .number()
          .min(-1000)
          .max(10000)
          .optional()
          .describe(
            'Letter spacing (tracking) in 1/1000 em, applied to the whole frame. 0 = none, positive = looser, negative = tighter. Same units and range as the tracking field in Illustrator\'s Character panel.',
          ),
        leading: z
          .number()
          .positive()
          .optional()
          .describe('Line spacing (leading) in pt, applied to the whole frame. Omit for auto leading (auto leading can be large in Japanese-default environments, e.g. 175%; set this for tight multi-line Latin text).'),
        justification: justificationSchema,
        fill: colorSchema.describe('Text color'),
        layer_name: z.string().optional().describe('Target layer name'),
        name: z.string().optional().describe('Object name'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true, resolveCoordinate: true });
    },
  );
}
