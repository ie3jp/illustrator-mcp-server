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

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
    } else {
      if (params.action === "relink") {
        if (!params.new_path) {
          writeResultFile(RESULT_PATH, { error: true, message: "new_path is required for relink" });
        } else {
          var newFile = new File(params.new_path);
          if (!newFile.exists) {
            writeResultFile(RESULT_PATH, { error: true, message: "File not found: " + params.new_path });
          } else {
            // In InDesign, relink via the link object
            var links = item.allLinks;
            if (!links || links.length === 0) {
              writeResultFile(RESULT_PATH, { error: true, message: "No links found on the item" });
            } else {
              links[0].relink(newFile);
              links[0].update();
              writeResultFile(RESULT_PATH, {
                success: true,
                action: "relink",
                uuid: params.uuid,
                newPath: params.new_path,
                verified: verifyItem(item)
              });
            }
          }
        }

      } else if (params.action === "update") {
        // Update out-of-date link
        var links2 = item.allLinks;
        if (!links2 || links2.length === 0) {
          writeResultFile(RESULT_PATH, { error: true, message: "No links found on the item" });
        } else {
          var updated = 0;
          for (var li = 0; li < links2.length; li++) {
            try {
              if (links2[li].status === LinkStatus.LINK_OUT_OF_DATE) {
                links2[li].update();
                updated++;
              }
            } catch(e) {}
          }
          writeResultFile(RESULT_PATH, {
            success: true,
            action: "update",
            uuid: params.uuid,
            linksUpdated: updated,
            verified: verifyItem(item)
          });
        }

      } else if (params.action === "embed") {
        // Embed the link
        var links3 = item.allLinks;
        if (!links3 || links3.length === 0) {
          writeResultFile(RESULT_PATH, { error: true, message: "No links found on the item" });
        } else {
          links3[0].unlink();
          writeResultFile(RESULT_PATH, {
            success: true,
            action: "embed",
            uuid: params.uuid,
            verified: verifyItem(item)
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
      description: 'Relink, update, or embed linked images in an InDesign document.',
      inputSchema: {
        uuid: z.string().describe('UUID of the image frame containing the link'),
        action: z.enum(['relink', 'update', 'embed']).describe('Action: relink=change source, update=refresh out-of-date link, embed=embed the file'),
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
