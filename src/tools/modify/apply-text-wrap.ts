import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
    } else {
      var wrapMode = params.wrap_mode || "none";

      // Map wrap mode string to InDesign enum
      var wrapType = TextWrapModes.NONE;
      if (wrapMode === "bounding_box") {
        wrapType = TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
      } else if (wrapMode === "contour") {
        wrapType = TextWrapModes.CONTOUR;
      } else if (wrapMode === "jump_object") {
        wrapType = TextWrapModes.JUMP_OBJECT_TEXT_WRAP;
      } else if (wrapMode === "jump_to_next_column") {
        wrapType = TextWrapModes.NEXT_COLUMN_TEXT_WRAP;
      } else if (wrapMode === "none") {
        wrapType = TextWrapModes.NONE;
      }

      var wrapPrefs = item.textWrapPreferences;
      wrapPrefs.textWrapMode = wrapType;

      // Set offsets if provided
      if (params.offsets) {
        var off = params.offsets;
        if (typeof off.top    === "number") wrapPrefs.textWrapOffset.top    = off.top;
        if (typeof off.bottom === "number") wrapPrefs.textWrapOffset.bottom = off.bottom;
        if (typeof off.left   === "number") wrapPrefs.textWrapOffset.left   = off.left;
        if (typeof off.right  === "number") wrapPrefs.textWrapOffset.right  = off.right;
      }

      // Wrap side
      if (params.wrap_side) {
        var sideMap = {
          "both": WrapSideOptions.BOTH_SIDES,
          "left": WrapSideOptions.LEFT_SIDE,
          "right": WrapSideOptions.RIGHT_SIDE,
          "largest": WrapSideOptions.LARGEST_AREA,
          "right_side": WrapSideOptions.RIGHT_SIDE
        };
        if (sideMap[params.wrap_side]) {
          wrapPrefs.textWrapSide = sideMap[params.wrap_side];
        }
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        uuid: params.uuid,
        wrapMode: wrapMode,
        verified: verifyItem(item)
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "apply_text_wrap failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'apply_text_wrap',
    {
      title: 'Apply Text Wrap',
      description: 'Set text wrap settings for an InDesign page item so surrounding text flows around it.',
      inputSchema: {
        uuid: z.string().describe('UUID of the object to apply text wrap to'),
        wrap_mode: z
          .enum(['none', 'bounding_box', 'contour', 'jump_object', 'jump_to_next_column'])
          .optional()
          .default('bounding_box')
          .describe('Text wrap mode: none=no wrap, bounding_box=wrap around bounds, contour=wrap around shape, jump_object=jump over object, jump_to_next_column=force text to next column'),
        offsets: z.object({
          top: z.number().optional().describe('Top offset in points'),
          bottom: z.number().optional().describe('Bottom offset in points'),
          left: z.number().optional().describe('Left offset in points'),
          right: z.number().optional().describe('Right offset in points'),
        }).optional().describe('Text wrap offset distances in points'),
        wrap_side: z
          .enum(['both', 'left', 'right', 'largest'])
          .optional()
          .default('both')
          .describe('Which side(s) text wraps around'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
