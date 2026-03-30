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

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
    } else {
      var cmd = params.command;
      if (cmd === "bring_to_front") {
        item.bringToFront();
      } else if (cmd === "bring_forward") {
        item.bringForward();
      } else if (cmd === "send_backward") {
        item.sendBackward();
      } else if (cmd === "send_to_back") {
        item.sendToBack();
      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "Unknown command: " + cmd });
        item = null;
      }

      if (item) {
        writeResultFile(RESULT_PATH, {
          success: true,
          uuid: params.uuid,
          command: params.command,
          verified: verifyItem(item)
        });
      }
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
      description: 'Change the stacking order of an InDesign page item.',
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
