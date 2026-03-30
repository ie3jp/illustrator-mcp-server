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

    // Build TOC style options
    var tocStyles = params.toc_styles || [];
    var includeStyles = [];
    for (var i = 0; i < tocStyles.length; i++) {
      var entry = tocStyles[i];
      var paraStyle = doc.paragraphStyles.itemByName(entry.style_name);
      if (paraStyle && paraStyle.isValid) {
        includeStyles.push({ includedStyle: paraStyle, level: entry.level || 1 });
      }
    }

    if (includeStyles.length === 0) {
      // Default: include Heading 1 if it exists
      var h1 = doc.paragraphStyles.itemByName("Heading 1");
      if (h1 && h1.isValid) {
        includeStyles.push({ includedStyle: h1, level: 1 });
      }
    }

    // Get or create a TOC style
    var tocStyleName = params.toc_style_name || "Default";
    var tocStyle = null;
    try {
      tocStyle = doc.tocStyles.itemByName(tocStyleName);
      if (!tocStyle || !tocStyle.isValid) {
        tocStyle = doc.tocStyles.add({ name: tocStyleName });
      }
    } catch(e) {
      tocStyle = doc.tocStyles.add({ name: tocStyleName });
    }

    // Set included styles on the TOC style
    if (includeStyles.length > 0) {
      try {
        tocStyle.tocStyleEntries.everyItem().remove();
      } catch(e) {}
      for (var si = 0; si < includeStyles.length; si++) {
        var entry2 = includeStyles[si];
        try {
          tocStyle.tocStyleEntries.add(entry2.includedStyle, { level: entry2.level });
        } catch(e) {}
      }
    }

    // Determine placement page and position
    var page = resolveTargetPage(doc, params.page_index);
    var x = (typeof params.x === "number") ? params.x : 36;
    var y = (typeof params.y === "number") ? params.y : 36;
    var w = (typeof params.width === "number") ? params.width : 400;
    var h = (typeof params.height === "number") ? params.height : 600;

    // Create TOC
    var tf = doc.createTOC(tocStyle, false, page, [y, x]);

    if (tf && tf.length > 0) {
      var firstFrame = tf[0];
      firstFrame.geometricBounds = [y, x, y + h, x + w];
      var uuid = ensureUUID(firstFrame);
      writeResultFile(RESULT_PATH, {
        success: true,
        tocStyleName: tocStyleName,
        frameCount: tf.length,
        uuid: uuid,
        verified: verifyItem(firstFrame)
      });
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "TOC generation returned no text frames" });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "generate_toc failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'generate_toc',
    {
      title: 'Generate Table of Contents',
      description: 'Generate a table of contents in an InDesign document based on paragraph styles.',
      inputSchema: {
        toc_styles: z.array(z.object({
          style_name: z.string().describe('Paragraph style name to include in TOC (e.g. "Heading 1")'),
          level: z.number().int().min(1).max(10).optional().default(1).describe('TOC hierarchy level (1=top level)'),
        })).optional().describe('Paragraph styles to include in TOC (default: Heading 1 if present)'),
        toc_style_name: z.string().optional().default('Default').describe('Name for the TOC style to create or use'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index to place the TOC (default: active page)'),
        x: z.number().optional().describe('X position for TOC frame in points (default: 36)'),
        y: z.number().optional().describe('Y position for TOC frame in points (default: 36)'),
        width: z.number().optional().describe('TOC frame width in points (default: 400)'),
        height: z.number().optional().describe('TOC frame height in points (default: 600)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
