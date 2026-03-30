import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);

    var group = findItemByUUID(params.uuid);
    if (!group) {
      writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
    } else if (group.constructor.name !== "Group" && group.typename !== "Group") {
      writeResultFile(RESULT_PATH, { error: true, message: "Object is not a group (type: " + group.typename + ")" });
    } else {
      // Collect child UUIDs before ungrouping
      var childUuids = [];
      for (var ci = 0; ci < group.pageItems.length; ci++) {
        childUuids.push(ensureUUID(group.pageItems[ci]));
      }

      // Ungroup
      app.select(group);
      app.activeDocument.activeSpread.ungroup(group);

      // Verify released items
      var verifiedChildren = [];
      for (var vi = 0; vi < childUuids.length; vi++) {
        var child = findItemByUUID(childUuids[vi]);
        if (child) verifiedChildren.push(verifyItem(child));
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        releasedCount: childUuids.length,
        childUuids: childUuids,
        verified: verifiedChildren
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "ungroup_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'ungroup_objects',
    {
      title: 'Ungroup Objects',
      description: 'Ungroup an InDesign group, releasing its children to the parent spread.',
      inputSchema: {
        uuid: z.string().describe('UUID of the group to ungroup'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
