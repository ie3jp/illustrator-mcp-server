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

    if (action === "add") {
      var pageIndex = params.page_index || 0;
      var section = doc.sections.add(doc.pages[pageIndex]);
      if (typeof params.page_number_start === "number") {
        section.continueNumbering = false;
        section.pageNumberStart = params.page_number_start;
      }
      if (params.marker) {
        section.marker = params.marker;
      }
      if (params.name) {
        section.name = params.name;
      }
      writeResultFile(RESULT_PATH, {
        success: true,
        action: "add",
        name: section.name,
        pageNumberStart: section.pageNumberStart,
        marker: section.marker
      });
    } else if (action === "update") {
      var section = doc.sections.itemByName(params.name);
      if (typeof params.page_number_start === "number") {
        section.continueNumbering = false;
        section.pageNumberStart = params.page_number_start;
      }
      if (typeof params.continue_numbering === "boolean") {
        section.continueNumbering = params.continue_numbering;
      }
      if (params.marker !== void 0) {
        section.marker = params.marker;
      }
      writeResultFile(RESULT_PATH, {
        success: true,
        action: "update",
        name: section.name,
        pageNumberStart: section.pageNumberStart,
        continueNumbering: section.continueNumbering,
        marker: section.marker
      });
    } else if (action === "delete") {
      var section = doc.sections.itemByName(params.name);
      section.remove();
      writeResultFile(RESULT_PATH, { success: true, action: "delete", name: params.name });
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Invalid action: " + action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_sections failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_sections',
    {
      title: 'Manage Sections',
      description: 'Add, update, or delete page numbering sections.',
      inputSchema: {
        action: z.enum(['add', 'update', 'delete']).describe('Action to perform'),
        name: z.string().optional().describe('Section name (for update/delete)'),
        page_index: z.number().int().min(0).optional().describe('Starting page index (for add)'),
        page_number_start: z.number().int().min(1).optional().describe('Starting page number'),
        continue_numbering: z.boolean().optional().describe('Continue numbering from previous section'),
        marker: z.string().optional().describe('Section marker text'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
