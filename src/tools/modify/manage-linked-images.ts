import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * manage_linked_images — リンク画像の差し替え・埋め込み
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PlacedItem/ — PlacedItem.relink(), PlacedItem.embed()
 *
 * JSX API:
 *   PlacedItem.relink(linkFile: File) → void
 *   PlacedItem.embed() → void  (PlacedItem → RasterItem に変換)
 *
 * embed() 後は PlacedItem が無効化されるため、name タグで RasterItem を追跡する。
 */
const jsxCode = `
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
    } else if (item.typename !== "PlacedItem") {
      writeResultFile(RESULT_PATH, { error: true, message: "Object is not a linked image (type: " + item.typename + ")" });
    } else {
      if (params.action === "relink") {
        if (!params.new_path) {
          writeResultFile(RESULT_PATH, { error: true, message: "new_path is required for relink" });
        } else {
          var newFile = new File(params.new_path);
          if (!newFile.exists) {
            writeResultFile(RESULT_PATH, { error: true, message: "File not found: " + params.new_path });
          } else {
            item.relink(newFile);
            writeResultFile(RESULT_PATH, {
              success: true,
              action: "relink",
              uuid: params.uuid,
              newPath: params.new_path,
              verified: verifyItem(item)
            });
          }
        }
      } else if (params.action === "embed") {
        var tag = "__embed_" + (new Date()).getTime();
        item.name = tag;
        item.embed();
        var resultUuid = null;
        for (var ri = 0; ri < doc.rasterItems.length; ri++) {
          if (doc.rasterItems[ri].name === tag) {
            doc.rasterItems[ri].name = "";
            resultUuid = ensureUUID(doc.rasterItems[ri]);
            break;
          }
        }
        if (resultUuid) {
          var embeddedItem = null;
          for (var ei = 0; ei < doc.rasterItems.length; ei++) {
            if (ensureUUID(doc.rasterItems[ei]) === resultUuid) {
              embeddedItem = doc.rasterItems[ei];
              break;
            }
          }
          writeResultFile(RESULT_PATH, {
            success: true,
            action: "embed",
            previousUuid: params.uuid,
            newUuid: resultUuid,
            verified: embeddedItem ? verifyItem(embeddedItem) : null
          });
        } else {
          writeResultFile(RESULT_PATH, {
            error: true,
            message: "embed() succeeded but resulting RasterItem could not be found"
          });
        }
      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + params.action });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_linked_images failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_linked_images',
    {
      title: 'Manage Linked Images',
      description:
        'Relink or embed a placed (linked) image. embed converts PlacedItem to RasterItem — the original UUID becomes invalid and a new UUID for the RasterItem is returned. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuid: z.string().describe('UUID of the placed (linked) image'),
        action: z.enum(['relink', 'embed']).describe('Action to perform'),
        new_path: z.string().optional().describe('New file path (required for relink)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
