import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { FONT_HELPERS_JSX, JUSTIFICATION_JSX, WRITE_ANNOTATIONS } from './shared.js';

/**
 * create_path_text — パスに沿ったテキスト作成
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItems/ — TextFrameItems.pathText()
 *
 * JSX API:
 *   TextFrameItems.pathText(textPath: PathItem) → TextFrame
 *   ParagraphAttributes.justification → パス上での揃え
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
    ${FONT_HELPERS_JSX}
    ${JUSTIFICATION_JSX}

    // フォントは作成前に解決する。見つからなければ何も作らずエラー
    var resolvedFont = null;
    var fontMissing = false;
    if (params.font_name) {
      try {
        resolvedFont = app.textFonts.getByName(params.font_name);
      } catch (e) {
        fontMissing = true;
      }
    }

    var pathItem = findItemByUUID(params.path_uuid);
    if (fontMissing) {
      writeResultFile(RESULT_PATH, fontNotFoundResult(params.font_name));
    } else if (!pathItem) {
      writeResultFile(RESULT_PATH, { error: true, message: "Path not found: " + params.path_uuid });
    } else if (pathItem.typename !== "PathItem" && pathItem.typename !== "CompoundPathItem") {
      writeResultFile(RESULT_PATH, { error: true, message: "Object is not a path (type: " + pathItem.typename + ")" });
    } else {
      var targetLayer = resolveTargetLayer(doc, params.layer_name);
      var tf = targetLayer.textFrames.pathText(pathItem);

      var rawContents = params.contents || "";
      tf.contents = rawContents.split(String.fromCharCode(10)).join(String.fromCharCode(13));

      if (params.name) tf.name = params.name;

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

      if (params.justification) {
        applyJustification(tf, params.justification);
      }

      var uuid = ensureUUID(tf);
      var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;
      writeResultFile(RESULT_PATH, { success: true, uuid: uuid, coordinateSystem: coordSystem, verified: verifyItem(tf, coordSystem, abRect) });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "create_path_text failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_path_text',
    {
      title: 'Create Path Text',
      description:
        'Create a text frame that flows along a path. If font_name is not found, nothing is created and an error with font_candidates is returned. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        path_uuid: z.string().describe('UUID of the path to place text along'),
        contents: z.string().describe('Text contents'),
        font_name: z
          .string()
          .optional()
          .describe(
            'Exact font name as listed by list_fonts (the "name" field, e.g. "ArialMT"). Not a partial match: if not found, nothing is created and an error with font_candidates is returned.',
          ),
        font_size: z.number().optional().describe('Font size (pt)'),
        tracking: z
          .number()
          .min(-1000)
          .max(10000)
          .optional()
          .describe(
            'Letter spacing (tracking) in 1/1000 em. 0 = none, positive = looser, negative = tighter. Same units and range as Illustrator\'s Character panel.',
          ),
        justification: z
          .enum(['left', 'center', 'right'])
          .optional()
          .describe('Alignment of the text along the path: left (from the path start) | center | right (toward the path end).'),
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
