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
    var action = params.action;

    if (action === "override_all") {
      // Override all master page items on a given page
      if (typeof params.page_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "page_index is required for override_all" });
      } else {
        var pg = doc.pages.item(params.page_index);
        if (!pg || !pg.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Page not found at index: " + params.page_index });
        } else {
          pg.override();
          var overridden = [];
          for (var oi = 0; oi < pg.pageItems.length; oi++) {
            var oItem = pg.pageItems.item(oi);
            if (oItem && oItem.isValid) {
              overridden.push({ uuid: ensureUUID(oItem), name: oItem.name, type: oItem.typename });
            }
          }
          writeResultFile(RESULT_PATH, { success: true, action: "override_all", pageIndex: params.page_index, overriddenCount: overridden.length, items: overridden });
        }
      }

    } else if (action === "override_item") {
      // Override a specific master page item by UUID on a target page
      if (!params.master_item_uuid || typeof params.page_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "master_item_uuid and page_index are required for override_item" });
      } else {
        var pg2 = doc.pages.item(params.page_index);
        if (!pg2 || !pg2.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Page not found at index: " + params.page_index });
        } else {
          // Find the master item via UUID in masterSpreads
          var masterItem = null;
          for (var ms = 0; ms < doc.masterSpreads.length; ms++) {
            var spread = doc.masterSpreads.item(ms);
            for (var mp = 0; mp < spread.pages.length; mp++) {
              var masterPg = spread.pages.item(mp);
              for (var mpi = 0; mpi < masterPg.allPageItems.length; mpi++) {
                var candidate = masterPg.allPageItems.item(mpi);
                if (extractLabel(candidate) === params.master_item_uuid) {
                  masterItem = candidate;
                  break;
                }
              }
              if (masterItem) break;
            }
            if (masterItem) break;
          }

          if (!masterItem) {
            writeResultFile(RESULT_PATH, { error: true, message: "Master item not found with UUID: " + params.master_item_uuid });
          } else {
            var overriddenItem = masterItem.override(pg2);
            var uuid = ensureUUID(overriddenItem);
            writeResultFile(RESULT_PATH, {
              success: true,
              action: "override_item",
              masterUuid: params.master_item_uuid,
              newUuid: uuid,
              verified: verifyItem(overriddenItem)
            });
          }
        }
      }

    } else if (action === "detach") {
      // Detach overridden item from master
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid is required for detach" });
      } else {
        var item = findItemByUUID(params.uuid);
        if (!item) {
          writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
        } else {
          item.detachAllCustomFrames();
          writeResultFile(RESULT_PATH, { success: true, action: "detach", uuid: params.uuid });
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: override_all, override_item, detach" });
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
      description: 'Override master page items on document pages, making them locally editable. Can override all items on a page or a specific item by UUID.',
      inputSchema: {
        action: z.enum(['override_all', 'override_item', 'detach']).describe('override_all=override all master items on a page, override_item=override one specific master item, detach=detach item from master'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index (for override_all/override_item)'),
        master_item_uuid: z.string().optional().describe('UUID of the master page item to override (for override_item)'),
        uuid: z.string().optional().describe('UUID of the overridden item to detach (for detach)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
