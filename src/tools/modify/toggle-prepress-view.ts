import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * toggle_prepress_view — 入稿確認用の表示・パネルを切り替える
 *
 * 公式 API は無く executeMenuCommand 経由。したがって Illustrator が前面でないと失敗するため
 * activate: true を指定する（jsx-runner のコメント参照）。
 *
 * コマンド名は実機確認済み（Illustrator 2025 / 29.5.0 で全て成功）:
 *   ink / pagetiling / Adobe Separation Preview Panel / Adobe Flattening Preview /
 *   internal palettes posing as plug-in menus-attributes
 *
 * Illustrator は「いま表示中かどうか」を返さないため、すべて単純なトグルになる。
 * Document.printTiles は read-only で、しかも「タイル出力として印刷するか」という別概念なので
 * View > プリント分割表示の状態確認には使えない（実機確認: pagetiling を実行しても変化しない）。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var view = params.view;

    var COMMANDS = {
      overprint_preview: "ink",
      print_tiling: "pagetiling",
      separations_preview: "Adobe Separation Preview Panel",
      flattener_preview: "Adobe Flattening Preview",
      attributes_panel: "internal palettes posing as plug-in menus-attributes"
    };
    var cmd = COMMANDS[view];
    if (!cmd) {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown view: " + view });
    } else {
      executeMenuCommandSafe(cmd);
      writeResultFile(RESULT_PATH, {
        success: true,
        view: view,
        command: cmd,
        warnings: ["Illustrator does not report whether this view or panel is showing, so this switched it rather than setting it to a known state. Call it again to switch back."]
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "toggle_prepress_view failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'toggle_prepress_view',
    {
      title: 'Toggle Prepress View',
      description:
        'Switch a prepress view or panel on screen so a human can check the file before it goes to print: overprint preview, print tiling, the separations preview panel, the flattener preview panel, or the attributes panel. '
        + 'Illustrator does not report whether a view or panel is currently showing, so these switch rather than set: call the tool again to switch back. '
        + 'Note: Illustrator will be activated (brought to the foreground) during execution, because this runs a menu command and menu commands fail when it is in the background.',
      inputSchema: {
        view: z
          .enum(['overprint_preview', 'print_tiling', 'separations_preview', 'flattener_preview', 'attributes_panel'])
          .describe('Which view or panel to switch'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      // メニューコマンドは前面でないと失敗する（jsx-runner のコメント参照）
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
