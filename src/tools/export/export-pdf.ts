import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS, coerceBoolean } from '../modify/shared.js';
/**
 * export_pdf — PDF export for InDesign
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#ExportFormat
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#PDFExportPreference
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var outputPath = params.output_path;
    var preset = params.preset || "";
    var pageRange = params.page_range || "";
    var bleed = params.bleed || false;
    var marks = params.marks || false;

    var outFile = new File(outputPath);
    var parentFolder = outFile.parent;
    if (!parentFolder.exists) {
      writeResultFile(RESULT_PATH, { error: true, message: "Output directory does not exist: " + parentFolder.fsName });
    } else {
      // Apply PDF export preset if specified
      if (preset !== "") {
        try {
          var pdfPreset = app.pdfExportPresets.item(preset);
          pdfPreset.loadSettings();
        } catch(e) {
          // Preset not found or loadSettings not supported — try appliedFlattenerPreset
          try {
            app.pdfExportPreferences.appliedFlattenerPreset = preset;
          } catch(e2) {
            // Ignore preset errors and continue with current settings
          }
        }
      }

      // Page range
      if (pageRange !== "") {
        app.pdfExportPreferences.pageRange = pageRange;
      } else {
        app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
      }

      // Bleed: set 3mm (8.504pt) on all sides when requested
      if (bleed) {
        app.pdfExportPreferences.bleedBottom = 8.504;
        app.pdfExportPreferences.bleedTop = 8.504;
        app.pdfExportPreferences.bleedInside = 8.504;
        app.pdfExportPreferences.bleedOutside = 8.504;
        app.pdfExportPreferences.includeSlugWithPDF = false;
      } else {
        app.pdfExportPreferences.bleedBottom = 0;
        app.pdfExportPreferences.bleedTop = 0;
        app.pdfExportPreferences.bleedInside = 0;
        app.pdfExportPreferences.bleedOutside = 0;
      }

      // Printer's marks
      if (marks) {
        app.pdfExportPreferences.cropMarks = true;
        app.pdfExportPreferences.registrationMarks = true;
        app.pdfExportPreferences.colorBars = true;
        app.pdfExportPreferences.pageInformationMarks = true;
      } else {
        app.pdfExportPreferences.cropMarks = false;
        app.pdfExportPreferences.registrationMarks = false;
        app.pdfExportPreferences.colorBars = false;
        app.pdfExportPreferences.pageInformationMarks = false;
      }

      doc.exportFile(ExportFormat.PDF_TYPE, outFile);

      // Verify output
      var verifyFile = new File(outputPath);
      if (!verifyFile.exists) {
        writeResultFile(RESULT_PATH, { error: true, message: "PDF export completed but output file was not created. Path may not be writable: " + outputPath });
      } else {
        writeResultFile(RESULT_PATH, {
          success: true,
          output_path: outputPath,
          preset: preset || "(current settings)",
          page_range: pageRange || "all",
          bleed: bleed,
          marks: marks
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "PDF export failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'export_pdf',
    {
      title: 'Export PDF',
      description:
        'Export the active InDesign document as a PDF file. ' +
        'Supports PDF export presets, page range selection, bleed, and printer\'s marks. ' +
        'Note: InDesign will be activated (brought to foreground) during execution. ' +
        'The exported PDF should be verified by a human before final print submission.',
      inputSchema: {
        output_path: z.string().describe('Output file path'),
        preset: z
          .string()
          .optional()
          .describe('PDF export preset name (e.g. "[PDF/X-4:2008]", "[Press Quality]", "[Smallest File Size]")'),
        page_range: z
          .string()
          .optional()
          .describe('Page range string (e.g. "1-3", "1, 3, 5"). Omit to export all pages.'),
        bleed: coerceBoolean
          .optional()
          .describe('Include 3mm bleed on all sides'),
        marks: coerceBoolean
          .optional()
          .describe('Include crop marks, registration marks, and color bars'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsxHeavy(jsxCode, params);
      const output = {
        ...result,
        _note:
          'PDF exported. This file should be verified by a human before final print submission — automated checks cannot catch all print-critical issues.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    },
  );
}
