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
    var styleType = params.style_type;

    function getStyleCollection(sType) {
      if (sType === "paragraph") return doc.paragraphStyles;
      if (sType === "character") return doc.characterStyles;
      if (sType === "object") return doc.objectStyles;
      if (sType === "table") return doc.tableStyles;
      if (sType === "cell") return doc.cellStyles;
      return null;
    }

    function listStyles(collection) {
      var result = [];
      for (var i = 0; i < collection.length; i++) {
        var s = collection.item(i);
        result.push({ name: s.name, id: s.id });
      }
      return result;
    }

    if (action === "list") {
      if (styleType) {
        var coll = getStyleCollection(styleType);
        if (!coll) {
          writeResultFile(RESULT_PATH, { error: true, message: "Unknown style_type: " + styleType });
        } else {
          writeResultFile(RESULT_PATH, { success: true, styleType: styleType, styles: listStyles(coll) });
        }
      } else {
        writeResultFile(RESULT_PATH, {
          success: true,
          paragraphStyles: listStyles(doc.paragraphStyles),
          characterStyles: listStyles(doc.characterStyles),
          objectStyles: listStyles(doc.objectStyles),
          tableStyles: listStyles(doc.tableStyles),
          cellStyles: listStyles(doc.cellStyles)
        });
      }

    } else if (action === "add") {
      if (!params.style_name || !styleType) {
        writeResultFile(RESULT_PATH, { error: true, message: "style_name and style_type are required for add" });
      } else {
        var coll2 = getStyleCollection(styleType);
        if (!coll2) {
          writeResultFile(RESULT_PATH, { error: true, message: "Unknown style_type: " + styleType });
        } else {
          var newStyle = coll2.add({ name: params.style_name });
          // Apply any provided properties
          if (params.properties) {
            var props = params.properties;
            if (typeof props.pointSize === "number") {
              try { newStyle.pointSize = props.pointSize; } catch(e) {}
            }
            if (props.fontFamily) {
              try { newStyle.appliedFont = app.fonts.item(props.fontFamily); } catch(e) {}
            }
            if (typeof props.leading === "number") {
              try { newStyle.leading = props.leading; } catch(e) {}
            }
          }
          writeResultFile(RESULT_PATH, { success: true, action: "add", styleType: styleType, name: params.style_name, id: newStyle.id });
        }
      }

    } else if (action === "rename") {
      if (!params.style_name || !params.new_name || !styleType) {
        writeResultFile(RESULT_PATH, { error: true, message: "style_name, new_name, and style_type are required for rename" });
      } else {
        var coll3 = getStyleCollection(styleType);
        if (!coll3) {
          writeResultFile(RESULT_PATH, { error: true, message: "Unknown style_type: " + styleType });
        } else {
          var style3 = coll3.itemByName(params.style_name);
          if (!style3 || !style3.isValid) {
            writeResultFile(RESULT_PATH, { error: true, message: "Style not found: " + params.style_name });
          } else {
            style3.name = params.new_name;
            writeResultFile(RESULT_PATH, { success: true, action: "rename", from: params.style_name, to: params.new_name });
          }
        }
      }

    } else if (action === "delete") {
      if (!params.style_name || !styleType) {
        writeResultFile(RESULT_PATH, { error: true, message: "style_name and style_type are required for delete" });
      } else {
        var coll4 = getStyleCollection(styleType);
        if (!coll4) {
          writeResultFile(RESULT_PATH, { error: true, message: "Unknown style_type: " + styleType });
        } else {
          var style4 = coll4.itemByName(params.style_name);
          if (!style4 || !style4.isValid) {
            writeResultFile(RESULT_PATH, { error: true, message: "Style not found: " + params.style_name });
          } else {
            style4.remove();
            writeResultFile(RESULT_PATH, { success: true, action: "delete", styleType: styleType, name: params.style_name });
          }
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: list, add, rename, delete" });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_styles failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_styles',
    {
      title: 'Manage Styles',
      description: 'CRUD operations for paragraph, character, object, table, and cell styles in InDesign.',
      inputSchema: {
        action: z.enum(['list', 'add', 'rename', 'delete']).describe('Style operation to perform'),
        style_type: z
          .enum(['paragraph', 'character', 'object', 'table', 'cell'])
          .optional()
          .describe('Type of style (omit for list to return all types)'),
        style_name: z.string().optional().describe('Style name (required for add/rename/delete)'),
        new_name: z.string().optional().describe('New style name (required for rename)'),
        properties: z.object({
          pointSize: z.number().optional().describe('Font size in points'),
          fontFamily: z.string().optional().describe('Font family name'),
          leading: z.number().optional().describe('Leading in points'),
        }).optional().describe('Style properties to set on creation (for add action)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
