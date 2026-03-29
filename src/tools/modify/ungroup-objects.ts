import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * ungroup_objects — グループを解除し子要素を親レイヤーに移動
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/GroupItem/ — GroupItem, PageItem.move()
 *
 * JSX API:
 *   PageItem.move(relativeObject, insertionLocation: ElementPlacement) → PageItem
 *   GroupItem.remove() → void  (空グループを削除)
 *
 * ライブコレクション回避のため、先に children 配列に収集してから move する。
 * ライブコレクションの注意: pageItems は live collection なので反復中に変化する
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var group = findItemByUUID(params.uuid);
    if (!group) {
      writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
    } else if (group.typename !== "GroupItem") {
      writeResultFile(RESULT_PATH, { error: true, message: "Object is not a group (type: " + group.typename + ")" });
    } else {
      var childUuids = [];
      var children = [];
      for (var ci = 0; ci < group.pageItems.length; ci++) {
        children.push(group.pageItems[ci]);
      }
      for (var mi = 0; mi < children.length; mi++) {
        var childUuid = ensureUUID(children[mi]);
        childUuids.push(childUuid);
        children[mi].move(group, ElementPlacement.PLACEBEFORE);
      }
      group.remove();

      writeResultFile(RESULT_PATH, {
        success: true,
        releasedCount: childUuids.length,
        childUuids: childUuids
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "ungroup_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'ungroup_objects',
    {
      title: 'Ungroup Objects',
      description:
        'Ungroup a group, releasing its children to the parent layer. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuid: z.string().describe('UUID of the group to ungroup'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
