import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS } from '../modify/shared.js';
/**
 * export — PNG/JPG page export for InDesign
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#ExportFormat
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#PNGExportPreference
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#JPEGExportPreference
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var format = params.format;
    var outputPath = params.output_path;
    var pageRange = params.page_range || "";
    var dpi = params.dpi || 150;
    var quality = params.quality || "high";

    var outFile = new File(outputPath);
    var parentFolder = outFile.parent;
    if (!parentFolder.exists) {
      writeResultFile(RESULT_PATH, { error: true, message: "Output directory does not exist: " + parentFolder.fsName });
    } else {
      if (format === "png") {
        app.pngExportPreferences.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE;
        if (pageRange !== "") {
          app.pngExportPreferences.pageString = pageRange;
        } else {
          app.pngExportPreferences.pngExportRange = PNGExportRangeEnum.ALL_PAGES;
        }
        app.pngExportPreferences.exportResolution = dpi;
        doc.exportFile(ExportFormat.PNG_FORMAT, outFile);
      } else if (format === "jpg") {
        app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
        if (pageRange !== "") {
          app.jpegExportPreferences.pageString = pageRange;
        } else {
          app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.ALL_PAGES;
        }
        app.jpegExportPreferences.exportResolution = dpi;
        // Map quality string to enum
        if (quality === "maximum") {
          app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
        } else if (quality === "high") {
          app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.HIGH;
        } else if (quality === "medium") {
          app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MEDIUM;
        } else {
          app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.LOW;
        }
        doc.exportFile(ExportFormat.JPG, outFile);
      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "Unsupported format: " + format + ". Use 'png' or 'jpg'." });
      }

      // Verify output
      var verifyFile = new File(outputPath);
      if (!verifyFile.exists) {
        writeResultFile(RESULT_PATH, { error: true, message: "Export completed but output file was not created. Path may not be writable: " + outputPath });
      } else {
        writeResultFile(RESULT_PATH, {
          success: true,
          output_path: outputPath,
          format: format,
          dpi: dpi,
          page_range: pageRange || "all"
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Export failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'export',
    {
      title: 'Export',
      description:
        'Export InDesign document pages as PNG or JPG raster images. Note: InDesign will be activated (brought to foreground) during execution.',
      inputSchema: {
        format: z.enum(['png', 'jpg']).describe('Export format'),
        output_path: z.string().describe('Output file path'),
        page_range: z
          .string()
          .optional()
          .describe('Page range string (e.g. "1-3", "1, 3, 5"). Omit to export all pages.'),
        dpi: z
          .number()
          .optional()
          .default(150)
          .describe('Export resolution in DPI (default: 150)'),
        quality: z
          .enum(['maximum', 'high', 'medium', 'low'])
          .optional()
          .describe('JPEG quality (ignored for PNG). Default: high'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsxHeavy(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
