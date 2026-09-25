import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
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
    var notFound = [];
    for (var i = 0; i < uuids.length; i++) {
      var item = findItemByUUID(uuids[i]);
      if (item) {
        items.push(item);
      } else {
        notFound.push(uuids[i]);
      }
    }

    // 一部だけでグループ化すると構造が変わる（clipped では別アイテムがクリップパスになる）ため、
    // 1 件でも見つからなければ何も変更せずエラーにする
    if (notFound.length > 0) {
      writeResultFile(RESULT_PATH, {
        error: true,
        message: "Objects not found for " + notFound.length + " of " + uuids.length + " UUIDs. Nothing was grouped.",
        notFound: notFound
      });
    } else {
      var parentLayer = items[0].layer;
      var group = parentLayer.groupItems.add();

      // 順方向で PLACEATEND → items[0] がグループ最下位 (bottom)、最後が最上位 (top)
      // クリッピングマスクでは最上位アイテム（＝配列末尾）がクリップパスになる
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
        childCount: group.pageItems.length,
        verified: verifyItem(group)
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
        'Group multiple objects into a single group. The first UUID in the array becomes the bottommost item, the last becomes the topmost. If any UUID is not found, nothing is grouped and the missing UUIDs are returned in notFound. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to group. Order matters: first=bottom, last=top in layer panel.'),
        name: z.string().optional().describe('Name for the new group'),
        clipped: coerceBoolean
          .optional()
          .default(false)
          .describe('Create as clipping group. The last UUID becomes the clip path (topmost). Example: [content-uuid, mask-uuid] — mask-uuid clips content-uuid.'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
