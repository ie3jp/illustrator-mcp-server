import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { invalidateAutoDetectCache } from '../session.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * assign_color_profile — カラープロファイルの割り当て
 *
 * 注意: Document.colorProfileName はリファレンスに記載がないが、実際のIllustratorでは動作する。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var profile = params.profile;

    var oldProfile = "";
    try {
      oldProfile = doc.colorProfileName;
    } catch(e) {
      oldProfile = "(unavailable)";
    }

    // ExtendScript には ICC 変換 API がないため、プロファイル名の割り当てだけ行う
    var note = "";
    var hasError = false;
    try {
      doc.colorProfileName = profile;
      note = "Profile assigned. ICC conversion (color value recalculation) is not directly supported due to ExtendScript limitations. For full conversion, use Edit > Convert to Profile in Illustrator.";
    } catch(e) {
      hasError = true;
      writeResultFile(RESULT_PATH, { error: true, message: "Failed to apply profile: " + e.message, line: e.line });
    }

    if (!hasError) {
      var actualProfile = "";
      try { actualProfile = doc.colorProfileName; } catch(e2) { actualProfile = "(unavailable)"; }
      // 例外なしで無視されることがある（RGB 文書に CMYK プロファイル等。実機確認）ので読み戻しで判定する
      if (actualProfile !== profile) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "Profile was not applied: the document still reports '" + actualProfile + "'. Illustrator ignores profiles that don't match the document color mode (e.g. a CMYK profile on an RGB document).",
          previousProfile: oldProfile,
          requestedProfile: profile,
          verified: { actualProfile: actualProfile }
        });
      } else {
        writeResultFile(RESULT_PATH, {
          assigned: true,
          converted: false,
          previousProfile: oldProfile,
          newProfile: profile,
          note: note,
          verified: { actualProfile: actualProfile }
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to operate color profile: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'assign_color_profile',
    {
      title: 'Assign Color Profile',
      description: 'Try to assign (tag) a color profile to the document. Illustrator\'s scripting API often ignores this silently (observed even for a matching RGB profile on an RGB document), so the result is verified by reading the profile back: an error is returned when it was not applied — then ask the user to use Edit > Assign Profile in Illustrator. Even when applied, color values are NOT converted (use Edit > Convert to Profile). Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        profile: z.string().describe('Color profile name or path'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      try {
        const result = await executeJsx(jsxCode, params, { activate: true });
        return formatToolResult(result);
      } finally {
        // colorProfile は座標系の自動検出（print/web 判定）の入力。
        // 失敗時も途中まで書き換わった可能性があるので常に捨てる
        invalidateAutoDetectCache();
      }
    },
  );
}
