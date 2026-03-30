import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

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
      var xrefs = doc.crossReferences;
      var result = [];
      for (var i = 0; i < xrefs.length; i++) {
        var xr = xrefs.item(i);
        try {
          result.push({
            index: i,
            sourceText: xr.sourceText || "",
            referencedTopic: xr.referencedTopic || ""
          });
        } catch(e) {
          result.push({ index: i, error: e.message });
        }
      }
      writeResultFile(RESULT_PATH, { success: true, count: result.length, crossReferences: result });

    } else if (action === "add") {
      if (!params.source_uuid || !params.destination_text) {
        writeResultFile(RESULT_PATH, { error: true, message: "source_uuid and destination_text are required for add" });
      } else {
        var sourceTF = findItemByUUID(params.source_uuid);
        if (!sourceTF || sourceTF.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "Source TextFrame not found: " + params.source_uuid });
        } else {
          var charOffset = (typeof params.char_offset === "number") ? params.char_offset : -1;
          var ip = sourceTF.insertionPoints.item(charOffset);

          // Find or create cross-reference format
          var format = null;
          var formatName = params.format_name || "Full Paragraph & Page Number";
          try {
            format = doc.crossReferenceFormats.itemByName(formatName);
            if (!format || !format.isValid) format = doc.crossReferenceFormats.item(0);
          } catch(e) {
            try { format = doc.crossReferenceFormats.item(0); } catch(e2) {}
          }

          // Add cross-reference source destination
          var xref = ip.crossReferences.add({
            referencedTopic: params.destination_text,
            appliedFormat: format
          });
          writeResultFile(RESULT_PATH, {
            success: true,
            action: "add",
            sourceUuid: params.source_uuid,
            destinationText: params.destination_text
          });
        }
      }

    } else if (action === "update") {
      // Update all cross-references in the document
      doc.crossReferences.updateAll();
      writeResultFile(RESULT_PATH, { success: true, action: "update", count: doc.crossReferences.length });

    } else if (action === "delete") {
      if (typeof params.xref_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "xref_index is required for delete" });
      } else {
        var xr2 = doc.crossReferences.item(params.xref_index);
        if (!xr2 || !xr2.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Cross-reference not found at index: " + params.xref_index });
        } else {
          xr2.remove();
          writeResultFile(RESULT_PATH, { success: true, action: "delete", index: params.xref_index });
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: list, add, update, delete" });
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
      description: 'Create, list, update, or delete cross-references in an InDesign document.',
      inputSchema: {
        action: z.enum(['list', 'add', 'update', 'delete']).describe('Operation to perform'),
        source_uuid: z.string().optional().describe('UUID of the text frame where the cross-reference is inserted (for add)'),
        destination_text: z.string().optional().describe('Destination paragraph text or topic (for add)'),
        char_offset: z.number().int().optional().describe('Character offset in the source frame (default: -1 = end)'),
        format_name: z.string().optional().describe('Cross-reference format name (default: "Full Paragraph & Page Number")'),
        xref_index: z.number().int().min(0).optional().describe('Zero-based cross-reference index (for delete)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
