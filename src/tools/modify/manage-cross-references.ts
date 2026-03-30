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
    var action = params.action;

    if (action === "list") {
      var sources = [];
      for (var i = 0; i < doc.crossReferenceSources.length; i++) {
        var src = doc.crossReferenceSources[i];
        sources.push({
          name: src.name,
          content: src.sourceText.contents
        });
      }
      var formats = [];
      for (var i = 0; i < doc.crossReferenceFormats.length; i++) {
        formats.push({ name: doc.crossReferenceFormats[i].name });
      }
      writeResultFile(RESULT_PATH, { sources: sources, formats: formats });
    } else if (action === "add") {
      // Create a text anchor at specified UUID's text frame insertion point
      var targetItem = findItemByUUID(params.target_uuid);
      if (!targetItem) {
        writeResultFile(RESULT_PATH, { error: true, message: "Target item not found: " + params.target_uuid });
      } else {
        var dest;
        try {
          dest = doc.hyperlinkTextDestinations.add(targetItem.texts[0]);
        } catch(e) {
          dest = doc.hyperlinkTextDestinations.add(targetItem.insertionPoints[0]);
        }
        writeResultFile(RESULT_PATH, {
          success: true,
          action: "add",
          destinationName: dest.name
        });
      }
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Invalid action: " + action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_cross_references failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_cross_references',
    {
      title: 'Manage Cross-References',
      description: 'List cross-reference sources/formats or add hyperlink text destinations.',
      inputSchema: {
        action: z.enum(['list', 'add']).describe('Action to perform'),
        target_uuid: z.string().optional().describe('UUID of target item (for add action)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
