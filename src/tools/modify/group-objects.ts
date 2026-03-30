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
    var uuids = params.uuids;

    var items = [];
    for (var i = 0; i < uuids.length; i++) {
      var item = findItemByUUID(uuids[i]);
      if (item) items.push(item);
    }

    if (items.length === 0) {
      writeResultFile(RESULT_PATH, { error: true, message: "No valid objects found for the given UUIDs" });
    } else {
      // Select all items and group using app.activeWindow.activeSpread
      // In InDesign, group via selection
      var spread = items[0].parentPage.parent;
      var page = items[0].parentPage;

      // Use document's groupItems approach — group by moving to a new group
      // InDesign: select items then group
      app.select(items);
      app.activeDocument.activeSpread.group(items);
      var grp = null;
      // The newly created group should be the selected item
      var sel = app.selection;
      if (sel && sel.length > 0) {
        grp = sel[0];
      }

      if (!grp) {
        writeResultFile(RESULT_PATH, { error: true, message: "Failed to create group" });
      } else {
        if (params.name) {
          grp.name = params.name;
        }
        var uuid = ensureUUID(grp);
        writeResultFile(RESULT_PATH, {
          success: true,
          uuid: uuid,
          verified: verifyItem(grp)
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "group_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'group_objects',
    {
      title: 'Group Objects',
      description: 'Group multiple InDesign page items into a single group.',
      inputSchema: {
        uuids: z.array(z.string()).min(2).describe('UUIDs of objects to group (minimum 2)'),
        name: z.string().optional().describe('Name for the new group'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
