import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { invalidateAutoDetectCache } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
try {
  var params = readParamsFile(PARAMS_PATH);

  var docPrefs = {
    documentBleedBottomOffset: 0,
    documentBleedTopOffset: 0,
    documentBleedInsideOrLeftOffset: 0,
    documentBleedOutsideOrRightOffset: 0
  };

  var w = params.width || "210mm";
  var h = params.height || "297mm";
  var facingPages = (params.facing_pages === true);
  var pageCount = (typeof params.page_count === "number") ? params.page_count : 1;

  var intentVal = DocumentIntentOptions.PRINT_INTENT;
  if (params.intent === "digital") {
    intentVal = DocumentIntentOptions.WEB_INTENT;
  }

  var doc = app.documents.add(facingPages, PageSize.CUSTOM, pageCount, DocumentColorSpace.CMYK, intentVal);

  // Set page size
  doc.documentPreferences.pageWidth = w;
  doc.documentPreferences.pageHeight = h;

  // Set margins if provided
  if (params.margins) {
    var m = params.margins;
    doc.documentPreferences.facingPages = facingPages;
    try {
      doc.marginPreferences.top    = (typeof m.top    === "number") ? m.top    : 0;
      doc.marginPreferences.bottom = (typeof m.bottom === "number") ? m.bottom : 0;
      doc.marginPreferences.left   = (typeof m.left   === "number") ? m.left   : 0;
      doc.marginPreferences.right  = (typeof m.right  === "number") ? m.right  : 0;
    } catch(em) {}
  }

  // Set columns if provided
  if (typeof params.columns === "number" && params.columns > 1) {
    try {
      doc.textPreferences.baselineGridRelativeOption = BaselineGridRelativeOption.TOP_OF_PAGE;
      doc.textFramePreferences.textColumnCount = params.columns;
    } catch(ec) {}
  }

  var docName = doc.name;
  var fullPath = "";
  try { fullPath = doc.fullName.fsName; } catch(e) {}

  writeResultFile(RESULT_PATH, {
    success: true,
    name: docName,
    path: fullPath,
    width: w,
    height: h,
    facingPages: facingPages,
    pageCount: pageCount,
    intent: params.intent || "print"
  });
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "Failed to create document: " + e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_document',
    {
      title: 'Create Document',
      description: 'Create a new InDesign document with specified size, pages, margins and intent.',
      inputSchema: {
        width: z.string().optional().default('210mm').describe('Page width as string with unit (e.g. "210mm", "8.5in", "595pt"). Default: A4 width.'),
        height: z.string().optional().default('297mm').describe('Page height as string with unit. Default: A4 height.'),
        facing_pages: z.boolean().optional().default(false).describe('Enable facing pages (spreads) for print layouts'),
        page_count: z.number().int().min(1).optional().default(1).describe('Initial number of pages'),
        margins: z.object({
          top: z.number().optional().describe('Top margin in points'),
          bottom: z.number().optional().describe('Bottom margin in points'),
          left: z.number().optional().describe('Left/inside margin in points'),
          right: z.number().optional().describe('Right/outside margin in points'),
        }).optional().describe('Page margins in points'),
        columns: z.number().int().min(1).optional().describe('Number of text columns'),
        intent: z.enum(['print', 'digital']).optional().default('print').describe('Document intent: print or digital/web'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      invalidateAutoDetectCache();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
