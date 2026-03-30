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
    var doc = app.activeDocument;
    var action = params.action;

    function getPageInfo(page) {
      return {
        index: page.documentOffset,
        name: page.name,
        appliedMaster: page.appliedMaster ? page.appliedMaster.name : "None"
      };
    }

    if (action === "add") {
      var count = params.count || 1;
      var insertAt = (typeof params.insert_at === "number") ? params.insert_at : doc.pages.length;
      var afterPage = doc.pages.item(insertAt - 1);
      doc.pages.add(LocationOptions.AFTER, afterPage, { count: count });
      var addedPages = [];
      for (var ai = insertAt; ai < Math.min(insertAt + count, doc.pages.length); ai++) {
        addedPages.push(getPageInfo(doc.pages.item(ai)));
      }
      writeResultFile(RESULT_PATH, { success: true, action: "add", addedCount: count, pages: addedPages, totalPages: doc.pages.length });

    } else if (action === "remove") {
      if (typeof params.page_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "page_index is required for remove" });
      } else if (doc.pages.length <= 1) {
        writeResultFile(RESULT_PATH, { error: true, message: "Cannot remove the only page" });
      } else {
        var pg = doc.pages.item(params.page_index);
        if (!pg || !pg.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Page not found at index: " + params.page_index });
        } else {
          var pgInfo = getPageInfo(pg);
          pg.remove();
          writeResultFile(RESULT_PATH, { success: true, action: "remove", removedPage: pgInfo, totalPages: doc.pages.length });
        }
      }

    } else if (action === "reorder") {
      if (typeof params.from_index !== "number" || typeof params.to_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "from_index and to_index are required for reorder" });
      } else {
        var fromPg = doc.pages.item(params.from_index);
        var toPg = doc.pages.item(params.to_index);
        if (!fromPg || !fromPg.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Page not found at from_index: " + params.from_index });
        } else {
          fromPg.move(LocationOptions.BEFORE, toPg);
          writeResultFile(RESULT_PATH, { success: true, action: "reorder", fromIndex: params.from_index, toIndex: params.to_index, totalPages: doc.pages.length });
        }
      }

    } else if (action === "set_margins") {
      if (typeof params.page_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "page_index is required for set_margins" });
      } else {
        var mpg = doc.pages.item(params.page_index);
        if (!mpg || !mpg.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Page not found at index: " + params.page_index });
        } else {
          var m = params.margins || {};
          mpg.marginPreferences.top    = (typeof m.top    === "number") ? m.top    : mpg.marginPreferences.top;
          mpg.marginPreferences.bottom = (typeof m.bottom === "number") ? m.bottom : mpg.marginPreferences.bottom;
          mpg.marginPreferences.left   = (typeof m.left   === "number") ? m.left   : mpg.marginPreferences.left;
          mpg.marginPreferences.right  = (typeof m.right  === "number") ? m.right  : mpg.marginPreferences.right;
          writeResultFile(RESULT_PATH, { success: true, action: "set_margins", pageIndex: params.page_index, margins: m });
        }
      }

    } else if (action === "apply_master") {
      if (typeof params.page_index !== "number" || !params.master_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "page_index and master_name are required for apply_master" });
      } else {
        var apg = doc.pages.item(params.page_index);
        if (!apg || !apg.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Page not found at index: " + params.page_index });
        } else {
          if (params.master_name === "None" || params.master_name === "") {
            apg.appliedMaster = NothingEnum.NOTHING;
            writeResultFile(RESULT_PATH, { success: true, action: "apply_master", pageIndex: params.page_index, masterName: "None", verified: getPageInfo(apg) });
          } else {
            var master = doc.masterSpreads.itemByName(params.master_name);
            if (!master || !master.isValid) {
              writeResultFile(RESULT_PATH, { error: true, message: "Master page not found: " + params.master_name });
            } else {
              apg.appliedMaster = master;
              writeResultFile(RESULT_PATH, { success: true, action: "apply_master", pageIndex: params.page_index, masterName: params.master_name, verified: getPageInfo(apg) });
            }
          }
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: add, remove, reorder, set_margins, apply_master" });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_pages failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_pages',
    {
      title: 'Manage Pages',
      description: 'Add, remove, reorder pages, set page margins, or apply master pages in an InDesign document.',
      inputSchema: {
        action: z
          .enum(['add', 'remove', 'reorder', 'set_margins', 'apply_master'])
          .describe('Page operation to perform'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index (for remove/set_margins/apply_master)'),
        count: z.number().int().min(1).optional().describe('Number of pages to add (for add action, default: 1)'),
        insert_at: z.number().int().min(0).optional().describe('Page index to insert after (for add, default: end)'),
        from_index: z.number().int().min(0).optional().describe('Source page index (for reorder)'),
        to_index: z.number().int().min(0).optional().describe('Destination page index (for reorder)'),
        margins: z.object({
          top: z.number().optional(),
          bottom: z.number().optional(),
          left: z.number().optional(),
          right: z.number().optional(),
        }).optional().describe('Margin values in points (for set_margins)'),
        master_name: z.string().optional().describe('Master page name to apply, or "None" to remove master (for apply_master)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
