import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { DESTRUCTIVE_ANNOTATIONS, READ_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;

    function getVarInfo(tv) {
      return {
        name: tv.name,
        variableType: tv.variableType.toString()
      };
    }

    if (action === "list") {
      var vars = [];
      for (var i = 0; i < doc.textVariables.length; i++) {
        vars.push(getVarInfo(doc.textVariables.item(i)));
      }
      writeResultFile(RESULT_PATH, { success: true, count: vars.length, variables: vars });

    } else if (action === "add") {
      if (!params.variable_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "variable_name is required for add" });
      } else {
        var varType = TextVariableTypes.CUSTOM_TEXT_TYPE;
        if (params.variable_type === "page_number") varType = TextVariableTypes.PAGE_NUMBER_TYPE;
        else if (params.variable_type === "chapter_number") varType = TextVariableTypes.CHAPTER_NUMBER_TYPE;
        else if (params.variable_type === "date_created") varType = TextVariableTypes.DATE_CREATED_TYPE;
        else if (params.variable_type === "date_modified") varType = TextVariableTypes.DATE_MODIFIED_TYPE;
        else if (params.variable_type === "file_name") varType = TextVariableTypes.FILE_NAME_TYPE;
        else if (params.variable_type === "output_date") varType = TextVariableTypes.OUTPUT_DATE_TYPE;

        var newVar = doc.textVariables.add({ name: params.variable_name, variableType: varType });

        if (params.variable_type === "custom" && params.value) {
          try { newVar.variableOptions.contents = params.value; } catch(e) {}
        }
        writeResultFile(RESULT_PATH, { success: true, action: "add", variable: getVarInfo(newVar) });
      }

    } else if (action === "edit") {
      if (!params.variable_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "variable_name is required for edit" });
      } else {
        var tv = doc.textVariables.itemByName(params.variable_name);
        if (!tv || !tv.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Text variable not found: " + params.variable_name });
        } else {
          if (params.new_name) tv.name = params.new_name;
          if (params.value) {
            try { tv.variableOptions.contents = params.value; } catch(e) {}
          }
          writeResultFile(RESULT_PATH, { success: true, action: "edit", variable: getVarInfo(tv) });
        }
      }

    } else if (action === "delete") {
      if (!params.variable_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "variable_name is required for delete" });
      } else {
        var tv2 = doc.textVariables.itemByName(params.variable_name);
        if (!tv2 || !tv2.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Text variable not found: " + params.variable_name });
        } else {
          tv2.remove();
          writeResultFile(RESULT_PATH, { success: true, action: "delete", name: params.variable_name });
        }
      }

    } else if (action === "insert") {
      // Insert a variable instance into a text frame at a character offset
      if (!params.uuid || !params.variable_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid and variable_name are required for insert" });
      } else {
        var tf = findItemByUUID(params.uuid);
        if (!tf || tf.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          var tv3 = doc.textVariables.itemByName(params.variable_name);
          if (!tv3 || !tv3.isValid) {
            writeResultFile(RESULT_PATH, { error: true, message: "Text variable not found: " + params.variable_name });
          } else {
            var charOffset = (typeof params.char_offset === "number") ? params.char_offset : -1;
            var ip = tf.insertionPoints.item(charOffset);
            ip.textVariableInstances.add(tv3);
            writeResultFile(RESULT_PATH, { success: true, action: "insert", variableName: params.variable_name });
          }
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: list, add, edit, delete, insert" });
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
      description: 'Create, edit, delete, list, or insert text variables (e.g. page number, file name, custom text) in InDesign.',
      inputSchema: {
        action: z.enum(['list', 'add', 'edit', 'delete', 'insert']).describe('Operation to perform'),
        variable_name: z.string().optional().describe('Text variable name'),
        new_name: z.string().optional().describe('New name for the variable (for edit)'),
        variable_type: z
          .enum(['custom', 'page_number', 'chapter_number', 'date_created', 'date_modified', 'file_name', 'output_date'])
          .optional()
          .default('custom')
          .describe('Variable type (for add)'),
        value: z.string().optional().describe('Custom text value (for custom type variables)'),
        uuid: z.string().optional().describe('UUID of text frame to insert the variable into (for insert)'),
        char_offset: z.number().int().optional().describe('Character offset for insertion (default: -1 = end)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
