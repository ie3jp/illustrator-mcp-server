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

    var targetPage = null;
    if (typeof params.target_page_index === "number") {
      targetPage = resolveTargetPage(doc, params.target_page_index);
    }

    var results = [];
    for (var i = 0; i < params.uuids.length; i++) {
      var item = findItemByUUID(params.uuids[i]);
      if (!item) continue;

      var dup;
      if (targetPage) {
        dup = item.duplicate(targetPage);
      } else {
        dup = item.duplicate();
      }

      if (params.offset_x || params.offset_y) {
        var dx = params.offset_x || 0;
        var dy = params.offset_y || 0;
        var ob = dup.geometricBounds;
        var dw = ob[3] - ob[1];
        var dh = ob[2] - ob[0];
        dup.geometricBounds = [ob[0] + dy, ob[1] + dx, ob[0] + dy + dh, ob[1] + dx + dw];
      }

      var uuid = ensureUUID(dup);
      results.push({ sourceUuid: params.uuids[i], newUuid: uuid, verified: verifyItem(dup) });
    }

    writeResultFile(RESULT_PATH, {
      success: true,
      duplicatedCount: results.length,
      items: results
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "duplicate_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'duplicate_objects',
    {
      title: 'Duplicate Objects',
      description: 'Duplicate one or more InDesign page items, optionally offsetting the copies or placing them on a different page.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to duplicate'),
        offset_x: z.number().optional().describe('X offset from original in points'),
        offset_y: z.number().optional().describe('Y offset from original in points'),
        target_page_index: z.number().int().min(0).optional().describe('Zero-based target page index (default: same page)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
