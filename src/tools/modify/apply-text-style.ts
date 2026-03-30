import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS, WRITE_ANNOTATIONS, coerceBoolean } from './shared.js';

const applyJsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
    } else if (item.typename !== "TextFrame") {
      writeResultFile(RESULT_PATH, { error: true, message: "Object is not a text frame (type: " + item.typename + ")" });
    } else {
      var clearOverrides = params.clear_overrides === true;

      if (params.style_type === "paragraph") {
        var paraStyle = null;
        try {
          paraStyle = doc.paragraphStyles.itemByName(params.style_name);
          if (!paraStyle || !paraStyle.isValid) throw new Error("Not found");
        } catch(e) {
          writeResultFile(RESULT_PATH, { error: true, message: "Paragraph style not found: " + params.style_name });
          paraStyle = null;
        }
        if (paraStyle) {
          var paras = item.paragraphs;
          for (var pi = 0; pi < paras.length; pi++) {
            paras[pi].applyParagraphStyle(paraStyle, clearOverrides);
          }
          writeResultFile(RESULT_PATH, { success: true, styleType: "paragraph", styleName: params.style_name, verified: verifyItem(item) });
        }

      } else if (params.style_type === "character") {
        var charStyle = null;
        try {
          charStyle = doc.characterStyles.itemByName(params.style_name);
          if (!charStyle || !charStyle.isValid) throw new Error("Not found");
        } catch(e) {
          writeResultFile(RESULT_PATH, { error: true, message: "Character style not found: " + params.style_name });
          charStyle = null;
        }
        if (charStyle) {
          item.texts[0].applyCharacterStyle(charStyle, clearOverrides);
          writeResultFile(RESULT_PATH, { success: true, styleType: "character", styleName: params.style_name, verified: verifyItem(item) });
        }

      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "style_type must be 'paragraph' or 'character'" });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "apply_text_style failed: " + e.message, line: e.line });
  }
}
`;

const listJsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;
    var charStyles = [];
    for (var i = 0; i < doc.characterStyles.length; i++) {
      charStyles.push({ name: doc.characterStyles.item(i).name });
    }
    var paraStyles = [];
    for (var j = 0; j < doc.paragraphStyles.length; j++) {
      paraStyles.push({ name: doc.paragraphStyles.item(j).name });
    }
    var objStyles = [];
    for (var k = 0; k < doc.objectStyles.length; k++) {
      objStyles.push({ name: doc.objectStyles.item(k).name });
    }
    writeResultFile(RESULT_PATH, {
      characterStyles: charStyles,
      paragraphStyles: paraStyles,
      objectStyles: objStyles
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "list_text_styles failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'apply_text_style',
    {
      title: 'Apply Text Style',
      description: 'Apply a paragraph or character style to a text frame in InDesign.',
      inputSchema: {
        uuid: z.string().describe('UUID of the text frame'),
        style_type: z.enum(['paragraph', 'character']).describe('Type of style to apply'),
        style_name: z.string().describe('Name of the style'),
        clear_overrides: coerceBoolean
          .optional()
          .default(false)
          .describe('Clear existing formatting overrides before applying'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(applyJsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'list_text_styles',
    {
      title: 'List Text Styles',
      description: 'List all paragraph, character, and object styles in the active InDesign document.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(listJsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
