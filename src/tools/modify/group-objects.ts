import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS, coerceBoolean } from './shared.js';

/**
 * group_objects — 複数オブジェクトをグループ化
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/GroupItems/ — GroupItems.add()
 *
 * JSX API:
 *   GroupItems.add() → GroupItem  (空グループ作成)
 *   PageItem.move(relativeObject, insertionLocation: ElementPlacement) → PageItem
 *   GroupItem.clipped → Boolean (writable)
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

    var items = [];
    for (var i = 0; i < uuids.length; i++) {
      var item = findItemByUUID(uuids[i]);
      if (item) items.push(item);
    }

    if (items.length === 0) {
      writeResultFile(RESULT_PATH, { error: true, message: "No valid objects found for the given UUIDs" });
    } else {
      var parentLayer = items[0].layer;
      var group = parentLayer.groupItems.add();

      // 順方向で PLACEATEND → items[0] がグループ最上位 (top)、最後が最下位
      // クリッピングマスクでは最上位アイテムがクリップパスになる
      for (var j = 0; j < items.length; j++) {
        items[j].move(group, ElementPlacement.PLACEATEND);
      }

      if (params.name) {
        group.name = params.name;
      }
      if (params.clipped === true) {
        group.clipped = true;
      }

      var uuid = ensureUUID(group);
      writeResultFile(RESULT_PATH, {
        success: true,
        uuid: uuid,
        childCount: group.pageItems.length
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "group_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'group_objects',
    {
      title: 'Group Objects',
      description:
        'Group multiple objects into a single group. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to group'),
        name: z.string().optional().describe('Name for the new group'),
        clipped: coerceBoolean
          .optional()
          .default(false)
          .describe('Create as clipping group (first item becomes clip path)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
