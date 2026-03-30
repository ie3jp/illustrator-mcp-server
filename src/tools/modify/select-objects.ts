import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var uuids = params.uuids;

    if (!uuids || uuids.length === 0) {
      app.select(null);
      writeResultFile(RESULT_PATH, { success: true, selected: [], deselected: true });
    } else {
      var notFound = [];
      var items = [];

      for (var i = 0; i < uuids.length; i++) {
        var item = findItemByUUID(uuids[i]);
        if (item) {
          items.push(item);
        } else {
          notFound.push(uuids[i]);
        }
      }

      app.select(items);

      var actualSel = app.selection;
      var verified = [];
      for (var k = 0; k < actualSel.length; k++) {
        var sel = actualSel[k];
        var selUuid = "";
        try { selUuid = extractLabel(sel); } catch(e2) {}
        verified.push({ uuid: selUuid, name: sel.name || "", type: sel.typename || "" });
      }

      var result = {
        success: true,
        verified: { selectionCount: verified.length, selection: verified }
      };
      if (notFound.length > 0) { result.notFound = notFound; }
      writeResultFile(RESULT_PATH, result);
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "select_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'select_objects',
    {
      title: 'Select Objects',
      description: 'Select InDesign page items by UUID. Pass an empty array to deselect all.',
      inputSchema: {
        uuids: z.array(z.string()).describe('Array of object UUIDs to select. Pass empty array [] to deselect all.'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
