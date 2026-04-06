import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS } from './shared.js';

/**
 * select_objects — UUID指定でオブジェクトを選択する
 *
 * JSX API:
 *   Document.selection = [PageItem, ...]
 *
 * UUIDリストで指定したオブジェクトをIllustratorの選択状態にする。
 * 空配列を渡すと選択解除になる。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var uuids = params.uuids;

    if (!uuids || uuids.length === 0) {
      doc.selection = null;
      writeResultFile(RESULT_PATH, { success: true, selected: [], deselected: true });
    } else {
      var notFound = [];
      var items = [];

      for (var i = 0; i < uuids.length; i++) {
        var item = findItemByUUID(uuids[i]);
        if (item) {
          items.push(item);
        } else {
          notFound.push(uuids[i]);
        }
      }

      doc.selection = items;

      // Post-operation verification: 実際の選択状態を読み返す
      var actualSel = doc.selection;
      var verified = [];
      for (var k = 0; k < actualSel.length; k++) {
        var sel = actualSel[k];
        var selUuid = "";
        try { selUuid = sel.note || ""; } catch(e2) {}
        verified.push({ uuid: selUuid, name: sel.name || "", type: getItemType(sel) });
      }

      var result = {
        success: true,
        verified: { selectionCount: verified.length, selection: verified }
      };
      if (notFound.length > 0) result.notFound = notFound;
      writeResultFile(RESULT_PATH, result);
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "select_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'select_objects',
    {
      title: 'Select Objects',
      description:
        'Select objects by UUID. Pass an empty array to deselect all. Selected objects can then be manipulated interactively in Illustrator.',
      inputSchema: {
        uuids: z
          .array(z.string())
          .describe(
            'Array of object UUIDs to select. Pass empty array [] to deselect all.',
          ),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
