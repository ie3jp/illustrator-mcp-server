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
      var tv = doc.textVariables.add({
        name: params.name,
        variableType: TextVariableTypes.CUSTOM_TEXT_TYPE
      });
      tv.variableOptions.contents = params.contents || "";
      writeResultFile(RESULT_PATH, { success: true, action: "add", name: tv.name, contents: tv.variableOptions.contents });
    } else if (action === "update") {
      var tv = doc.textVariables.itemByName(params.name);
      tv.variableOptions.contents = params.contents || "";
      writeResultFile(RESULT_PATH, { success: true, action: "update", name: tv.name, contents: tv.variableOptions.contents });
    } else if (action === "delete") {
      var tv = doc.textVariables.itemByName(params.name);
      tv.remove();
      writeResultFile(RESULT_PATH, { success: true, action: "delete", name: params.name });
    } else if (action === "list") {
      var vars = [];
      for (var i = 0; i < doc.textVariables.length; i++) {
        var v = doc.textVariables[i];
        var info = { name: v.name, type: v.variableType.toString() };
        try { info.contents = v.variableOptions.contents; } catch(e) {}
        vars.push(info);
      }
      writeResultFile(RESULT_PATH, { variables: vars });
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Invalid action: " + action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_text_variables failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_text_variables',
    {
      title: 'Manage Text Variables',
      description: 'Add, update, delete, or list custom text variables in the document.',
      inputSchema: {
        action: z.enum(['add', 'update', 'delete', 'list']).describe('Action to perform'),
        name: z.string().optional().describe('Variable name (required for add/update/delete)'),
        contents: z.string().optional().describe('Variable contents (for add/update)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
