import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

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
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid of a text frame is required for add" });
      } else {
        var tf = findItemByUUID(params.uuid);
        if (!tf || tf.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          // Insert footnote at character offset
          var charOffset = (typeof params.char_offset === "number") ? params.char_offset : 0;
          var ip = tf.insertionPoints.item(charOffset);
          var fn = ip.footnotes.add();
          if (params.contents) {
            // Footnote text goes in fn.insertionPoints after the marker
            fn.insertionPoints.item(-1).contents = params.contents;
          }
          writeResultFile(RESULT_PATH, {
            success: true,
            action: "add",
            footnoteIndex: tf.parentStory.footnotes.length - 1,
            contents: params.contents || ""
          });
        }
      }

    } else if (action === "edit") {
      if (!params.uuid || typeof params.footnote_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid and footnote_index are required for edit" });
      } else {
        var tf2 = findItemByUUID(params.uuid);
        if (!tf2 || tf2.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          var story = tf2.parentStory;
          var fn2 = story.footnotes.item(params.footnote_index);
          if (!fn2 || !fn2.isValid) {
            writeResultFile(RESULT_PATH, { error: true, message: "Footnote not found at index: " + params.footnote_index });
          } else {
            if (params.contents) {
              fn2.texts[0].contents = params.contents;
            }
            writeResultFile(RESULT_PATH, { success: true, action: "edit", footnoteIndex: params.footnote_index });
          }
        }
      }

    } else if (action === "delete") {
      if (!params.uuid || typeof params.footnote_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid and footnote_index are required for delete" });
      } else {
        var tf3 = findItemByUUID(params.uuid);
        if (!tf3 || tf3.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          var story3 = tf3.parentStory;
          var fn3 = story3.footnotes.item(params.footnote_index);
          if (!fn3 || !fn3.isValid) {
            writeResultFile(RESULT_PATH, { error: true, message: "Footnote not found at index: " + params.footnote_index });
          } else {
            fn3.remove();
            writeResultFile(RESULT_PATH, { success: true, action: "delete", footnoteIndex: params.footnote_index });
          }
        }
      }

    } else if (action === "list") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid is required for list" });
      } else {
        var tf4 = findItemByUUID(params.uuid);
        if (!tf4 || tf4.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          var story4 = tf4.parentStory;
          var footnotes = story4.footnotes;
          var result = [];
          for (var fi = 0; fi < footnotes.length; fi++) {
            var fn4 = footnotes.item(fi);
            result.push({ index: fi, contents: fn4.contents || "" });
          }
          writeResultFile(RESULT_PATH, { success: true, action: "list", count: result.length, footnotes: result });
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: add, edit, delete, list" });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_footnotes failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_footnotes',
    {
      title: 'Manage Footnotes',
      description: 'Add, edit, delete, or list footnotes in InDesign text stories.',
      inputSchema: {
        action: z.enum(['add', 'edit', 'delete', 'list']).describe('Footnote operation'),
        uuid: z.string().optional().describe('UUID of the text frame whose story contains the footnotes'),
        footnote_index: z.number().int().min(0).optional().describe('Zero-based footnote index (for edit/delete)'),
        char_offset: z.number().int().min(0).optional().describe('Character offset to insert footnote at (for add, default: 0)'),
        contents: z.string().optional().describe('Footnote text content (for add/edit)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
