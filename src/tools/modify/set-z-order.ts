import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * set_z_order — オブジェクトの重ね順を変更
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — PageItem.zOrder()
 *
 * JSX API:
 *   PageItem.zOrder(zOrderCmd: ZOrderMethod) → void
 *   ZOrderMethod: BRINGTOFRONT | BRINGFORWARD | SENDBACKWARD | SENDTOBACK
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
    } else {
      var cmdMap = {
        "bring_to_front": ZOrderMethod.BRINGTOFRONT,
        "bring_forward": ZOrderMethod.BRINGFORWARD,
        "send_backward": ZOrderMethod.SENDBACKWARD,
        "send_to_back": ZOrderMethod.SENDTOBACK
      };
      item.zOrder(cmdMap[params.command]);
      writeResultFile(RESULT_PATH, {
        success: true,
        uuid: params.uuid,
        command: params.command,
        newZIndex: getZIndex(item)
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "set_z_order failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'set_z_order',
    {
      title: 'Set Z-Order',
      description:
        'Change the stacking order of an object. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuid: z.string().describe('UUID of the object'),
        command: z
          .enum(['bring_to_front', 'bring_forward', 'send_backward', 'send_to_back'])
          .describe('Stacking order command'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
