import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

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
      writeResultFile(RESULT_PATH, {
        success: true,
        previousProfile: oldProfile,
        newProfile: profile,
        note: note
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to operate color profile: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'apply_color_profile',
    {
      title: 'Apply Color Profile',
      description: 'Apply or convert color profile. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        profile: z.string().describe('Color profile name or path'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
