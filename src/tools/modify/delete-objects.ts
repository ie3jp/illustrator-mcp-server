import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * delete_objects — UUID 指定でオブジェクトを削除
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — PageItem.remove()
 *
 * 設計メモ:
 * - レイヤー単位の削除は manage_layers(delete) が担うので、ここは PageItem 単位のみ
 * - ロック中のオブジェクトは remove() が失敗するため、force_unlock 指定時のみ解除して削除する
 * - グループとその子を同時に指定した場合、親を先に消すと子の参照が無効になる。
 *   per-item の try/catch で「既に削除済み」として errors に積む
 * - 削除後は _uuidIndex から該当エントリを落とし、同一実行内で stale 参照を返さないようにする
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var forceUnlock = params.force_unlock === true;

    var deleted = [];
    var notFound = [];
    var errors = [];

    for (var i = 0; i < params.uuids.length; i++) {
      var uuid = params.uuids[i];
      var item = findItemByUUID(uuid);
      if (!item) {
        notFound.push(uuid);
        continue;
      }

      try {
        var snap = { uuid: uuid, name: item.name || "", type: getItemType(item), layer: getParentLayerName(item) };

        if (item.locked) {
          if (forceUnlock) {
            item.locked = false;
          } else {
            errors.push({ uuid: uuid, message: "Object is locked. Set force_unlock: true to delete it." });
            continue;
          }
        }

        item.remove();
        if (_uuidIndex) { delete _uuidIndex[uuid]; }
        deleted.push(snap);
      } catch (itemErr) {
        errors.push({ uuid: uuid, message: itemErr.message });
      }
    }

    // 見つからなかった UUID も失敗扱い（全 UUID 不存在で success: true を返さない）
    writeResultFile(RESULT_PATH, {
      success: errors.length === 0 && notFound.length === 0,
      deletedCount: deleted.length,
      deleted: deleted,
      notFound: notFound,
      errors: errors
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "delete_objects failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'delete_objects',
    {
      title: 'Delete Objects',
      description:
        'Delete one or more objects by UUID (get UUIDs from find_objects / get_layers / get_selection). ' +
        'Locked objects are skipped unless force_unlock is true. success is false if any UUID was not found or could not be deleted (see notFound / errors). ' +
        'The undo tool may revert it, but undo steps are Illustrator history steps, not tied to MCP calls. ' +
        'To delete a whole layer use manage_layers instead. ' +
        'Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to delete'),
        force_unlock: z
          .boolean()
          .optional()
          .default(false)
          .describe('Unlock locked objects before deleting them (default: false = skip locked objects with an error)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
