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
    var pageIndex = params.page_index || 0;
    var page = doc.pages[pageIndex];

    var masterItems = page.masterPageItems;
    if (masterItems.length === 0) {
      writeResultFile(RESULT_PATH, { error: true, message: "No master page items on page " + (pageIndex + 1) });
    } else {
      var overridden = [];
      if (typeof params.item_index === "number" && params.item_index >= 0) {
        // Override specific item
        if (params.item_index >= masterItems.length) {
          writeResultFile(RESULT_PATH, { error: true, message: "item_index " + params.item_index + " out of range (0-" + (masterItems.length - 1) + ")" });
        } else {
          var item = masterItems[params.item_index].override(page);
          var uuid = ensureUUID(item);
          overridden.push({ index: params.item_index, uuid: uuid, verified: verifyItem(item) });
          writeResultFile(RESULT_PATH, { success: true, overridden: overridden });
        }
      } else {
        // Override all master items
        for (var i = masterItems.length - 1; i >= 0; i--) {
          try {
            var item = masterItems[i].override(page);
            var uuid = ensureUUID(item);
            overridden.push({ index: i, uuid: uuid, type: getItemType(item) });
          } catch(e) {
            // Some items may not be overridable
          }
        }
        writeResultFile(RESULT_PATH, { success: true, pageIndex: pageIndex, overriddenCount: overridden.length, overridden: overridden });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "override_master_items failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'override_master_items',
    {
      title: 'Override Master Items',
      description: 'Override master page items on a specific page, detaching them for local editing.',
      inputSchema: {
        page_index: z.number().int().min(0).optional().default(0).describe('Zero-based page index'),
        item_index: z.number().int().min(0).optional().describe('Specific master item index to override (omit to override all)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
