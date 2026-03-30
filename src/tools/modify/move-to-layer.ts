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

    var targetLayer = doc.layers.itemByName(params.target_layer);
    if (!targetLayer || !targetLayer.isValid) {
      writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + params.target_layer });
    } else {
      var movedCount = 0;
      for (var i = 0; i < params.uuids.length; i++) {
        var item = findItemByUUID(params.uuids[i]);
        if (item) {
          item.itemLayer = targetLayer;
          movedCount++;
        }
      }

      var verifiedItems = [];
      for (var vi = 0; vi < params.uuids.length; vi++) {
        var vItem = findItemByUUID(params.uuids[vi]);
        if (vItem) verifiedItems.push(verifyItem(vItem));
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        movedCount: movedCount,
        targetLayer: params.target_layer,
        verified: verifiedItems
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "move_to_layer failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'move_to_layer',
    {
      title: 'Move to Layer',
      description: 'Move one or more InDesign page items to a different layer.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to move'),
        target_layer: z.string().describe('Target layer name'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
