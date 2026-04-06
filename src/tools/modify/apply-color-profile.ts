import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
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

    // ExtendScript does not provide a single-call color conversion API.
    // We can assign a color profile name to embed/change the profile.
    // For full ICC-based conversion, manual workflow or actions are needed.
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
      writeResultFile(RESULT_PATH, {
        assigned: true,
        converted: false,
        previousProfile: oldProfile,
        newProfile: profile,
        note: note,
        verified: { actualProfile: actualProfile }
      });
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
      description: 'Assign (tag) a color profile to the document. WARNING: This only changes the profile tag — it does NOT convert color values (ICC conversion). For full conversion, use Edit > Convert to Profile in Illustrator. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        profile: z.string().describe('Color profile name or path'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
