import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { READ_ANNOTATIONS, WRITE_ANNOTATIONS, coerceBoolean } from './shared.js';

/**
 * apply_text_style / list_text_styles
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/CharacterStyle/ — CharacterStyle, ParagraphStyle
 *
 * JSX API:
 *   Document.characterStyles → CharacterStyles
 *   Document.paragraphStyles → ParagraphStyles
 *   CharacterStyle.applyTo(textItem, clearingOverrides?: Boolean) → void
 *   ParagraphStyle.applyTo(textItem, clearingOverrides?: Boolean) → void
 */
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
      var style = null;
      try {
        if (params.style_type === "character") {
          style = doc.characterStyles.getByName(params.style_name);
        } else {
          style = doc.paragraphStyles.getByName(params.style_name);
        }
      } catch(e) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: params.style_type + " style not found: " + params.style_name
        });
      }

      if (style) {
        var clearOverrides = params.clear_overrides === true;
        if (params.style_type === "character") {
          style.applyTo(item.textRange, clearOverrides);
        } else {
          for (var pi = 0; pi < item.paragraphs.length; pi++) {
            style.applyTo(item.paragraphs[pi], clearOverrides);
          }
        }
        writeResultFile(RESULT_PATH, {
          success: true,
          styleType: params.style_type,
          styleName: params.style_name,
          verified: verifyItem(item)
        });
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
      charStyles.push({ name: doc.characterStyles[i].name });
    }
    var paraStyles = [];
    for (var j = 0; j < doc.paragraphStyles.length; j++) {
      paraStyles.push({ name: doc.paragraphStyles[j].name });
    }
    writeResultFile(RESULT_PATH, {
      characterStyles: charStyles,
      paragraphStyles: paraStyles
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
      description:
        'Apply a character or paragraph style to a text frame. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuid: z.string().describe('UUID of the text frame'),
        style_type: z.enum(['character', 'paragraph']).describe('Type of style to apply'),
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
      return formatToolResult(result);
    },
  );

  server.registerTool(
    'list_text_styles',
    {
      title: 'List Text Styles',
      description: 'List all character and paragraph styles in the active document.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(listJsxCode, params);
      return formatToolResult(result);
    },
  );
}
