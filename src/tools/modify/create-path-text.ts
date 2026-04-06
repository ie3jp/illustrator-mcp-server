import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { FONT_HELPERS_JSX, WRITE_ANNOTATIONS } from './shared.js';

/**
 * create_path_text — パスに沿ったテキスト作成
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItems/ — TextFrameItems.pathText()
 *
 * JSX API:
 *   TextFrameItems.pathText(textPath: PathItem) → TextFrame
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    ${FONT_HELPERS_JSX}

    var pathItem = findItemByUUID(params.path_uuid);
    if (!pathItem) {
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
      var fontCandidates = null;

      if (params.font_name) {
        try {
          charAttrs.textFont = app.textFonts.getByName(params.font_name);
        } catch(e) {
          fontCandidates = findFontCandidates(params.font_name);
        }
      }

      if (typeof params.font_size === "number") {
        charAttrs.size = params.font_size;
      }

      var uuid = ensureUUID(tf);
      var resultData = { success: true, uuid: uuid, verified: verifyItem(tf) };
      if (fontCandidates !== null) {
        resultData.font_warning = "Font '" + params.font_name + "' not found. Text frame created with default font.";
        resultData.font_candidates = fontCandidates;
      }
      writeResultFile(RESULT_PATH, resultData);
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
        'Create a text frame that flows along a path. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        path_uuid: z.string().describe('UUID of the path to place text along'),
        contents: z.string().describe('Text contents'),
        font_name: z
          .string()
          .optional()
          .describe(
            'Font name (partial match, e.g. "Arial"). Use list_fonts to find exact PostScript names.',
          ),
        font_size: z.number().optional().describe('Font size (pt)'),
        layer_name: z.string().optional().describe('Target layer name'),
        name: z.string().optional().describe('Object name'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
