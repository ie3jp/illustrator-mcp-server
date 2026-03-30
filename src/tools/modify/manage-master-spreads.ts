import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { DESTRUCTIVE_ANNOTATIONS, WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;

    function getMasterInfo(master) {
      var pages = [];
      for (var pi = 0; pi < master.pages.length; pi++) {
        pages.push(master.pages.item(pi).name);
      }
      return {
        name: master.name,
        namePrefix: master.namePrefix,
        baseMaster: master.basedOn ? master.basedOn.name : "None",
        pageCount: master.pages.length
      };
    }

    if (action === "add") {
      var masterName = params.master_name || "New Master";
      var prefix = params.prefix || "B";
      var newMaster = doc.masterSpreads.add({ namePrefix: prefix, name: masterName });
      if (params.based_on) {
        var baseMaster = doc.masterSpreads.itemByName(params.based_on);
        if (baseMaster && baseMaster.isValid) {
          newMaster.basedOn = baseMaster;
        }
      }
      writeResultFile(RESULT_PATH, { success: true, action: "add", master: getMasterInfo(newMaster) });

    } else if (action === "rename") {
      if (!params.master_name || !params.new_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "master_name and new_name are required for rename" });
      } else {
        var master2 = doc.masterSpreads.itemByName(params.master_name);
        if (!master2 || !master2.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Master not found: " + params.master_name });
        } else {
          master2.name = params.new_name;
          if (params.prefix) master2.namePrefix = params.prefix;
          writeResultFile(RESULT_PATH, { success: true, action: "rename", master: getMasterInfo(master2) });
        }
      }

    } else if (action === "delete") {
      if (!params.master_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "master_name is required for delete" });
      } else {
        var master3 = doc.masterSpreads.itemByName(params.master_name);
        if (!master3 || !master3.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Master not found: " + params.master_name });
        } else {
          var masterInfo3 = getMasterInfo(master3);
          master3.remove();
          writeResultFile(RESULT_PATH, { success: true, action: "delete", deletedMaster: masterInfo3 });
        }
      }

    } else if (action === "apply") {
      if (!params.master_name || typeof params.page_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "master_name and page_index are required for apply" });
      } else {
        var pg = doc.pages.item(params.page_index);
        if (!pg || !pg.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Page not found at index: " + params.page_index });
        } else {
          var master4 = doc.masterSpreads.itemByName(params.master_name);
          if (!master4 || !master4.isValid) {
            writeResultFile(RESULT_PATH, { error: true, message: "Master not found: " + params.master_name });
          } else {
            pg.appliedMaster = master4;
            writeResultFile(RESULT_PATH, { success: true, action: "apply", pageIndex: params.page_index, masterName: params.master_name });
          }
        }
      }

    } else if (action === "list") {
      var masters = [];
      for (var mi = 0; mi < doc.masterSpreads.length; mi++) {
        masters.push(getMasterInfo(doc.masterSpreads.item(mi)));
      }
      writeResultFile(RESULT_PATH, { success: true, action: "list", masters: masters });

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: add, rename, delete, apply, list" });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_master_spreads failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_master_spreads',
    {
      title: 'Manage Master Spreads',
      description: 'Create, rename, delete, apply, or list master pages (spreads) in an InDesign document.',
      inputSchema: {
        action: z
          .enum(['add', 'rename', 'delete', 'apply', 'list'])
          .describe('Action to perform'),
        master_name: z.string().optional().describe('Master spread name (e.g. "A-Master", "B-Master")'),
        new_name: z.string().optional().describe('New name (for rename action)'),
        prefix: z.string().optional().describe('Single-character prefix for new/renamed master (e.g. "B", "C")'),
        based_on: z.string().optional().describe('Base master name to inherit from (for add action)'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index (for apply action)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
