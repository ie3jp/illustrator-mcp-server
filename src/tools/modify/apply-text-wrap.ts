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
      writeResultFile(RESULT_PATH, { error: true, message: "No object found matching UUID: " + params.uuid });
    } else {
      var mode = params.mode || "none";
      var twp = item.textWrapPreferences;

      if (mode === "none") {
        twp.textWrapMode = TextWrapModes.NONE;
      } else if (mode === "bounding_box") {
        twp.textWrapMode = TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
      } else if (mode === "contour") {
        twp.textWrapMode = TextWrapModes.CONTOUR;
      } else if (mode === "jump_object") {
        twp.textWrapMode = TextWrapModes.JUMP_OBJECT_TEXT_WRAP;
      } else if (mode === "jump_to_next_column") {
        twp.textWrapMode = TextWrapModes.NEXT_COLUMN_TEXT_WRAP;
      }

      if (params.offset) {
        var off = params.offset;
        twp.textWrapOffset = [
          off.top || 0,
          off.left || 0,
          off.bottom || 0,
          off.right || 0
        ];
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        uuid: params.uuid,
        textWrapMode: twp.textWrapMode.toString(),
        textWrapOffset: [twp.textWrapOffset[0], twp.textWrapOffset[1], twp.textWrapOffset[2], twp.textWrapOffset[3]],
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
      description: 'Set text wrap mode and offset on an object.',
      inputSchema: {
        uuid: z.string().describe('UUID of the object'),
        mode: z.enum(['none', 'bounding_box', 'contour', 'jump_object', 'jump_to_next_column'])
          .describe('Text wrap mode'),
        offset: z.object({
          top: z.number().optional().describe('Top offset (pt)'),
          left: z.number().optional().describe('Left offset (pt)'),
          bottom: z.number().optional().describe('Bottom offset (pt)'),
          right: z.number().optional().describe('Right offset (pt)'),
        }).optional().describe('Text wrap offset in points'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
