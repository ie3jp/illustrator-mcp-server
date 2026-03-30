import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;

    function getSectionInfo(section) {
      return {
        name: section.name,
        pageStart: section.pageStart ? section.pageStart.documentOffset : -1,
        pageNumberStart: section.pageNumberStart,
        marker: section.marker,
        continueNumbering: section.continueNumbering,
        pageNumberStyle: section.pageNumberStyle ? section.pageNumberStyle.toString() : ""
      };
    }

    if (action === "list") {
      var sections = doc.sections;
      var result = [];
      for (var i = 0; i < sections.length; i++) {
        result.push(getSectionInfo(sections.item(i)));
      }
      writeResultFile(RESULT_PATH, { success: true, count: result.length, sections: result });

    } else if (action === "add") {
      if (typeof params.page_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "page_index is required for add" });
      } else {
        var pg = doc.pages.item(params.page_index);
        if (!pg || !pg.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Page not found at index: " + params.page_index });
        } else {
          var sectionProps = { pageStart: pg };
          if (typeof params.page_number_start === "number") {
            sectionProps.pageNumberStart = params.page_number_start;
            sectionProps.continueNumbering = false;
          }
          if (params.marker) sectionProps.marker = params.marker;
          if (params.section_name) sectionProps.name = params.section_name;

          // Set page numbering style
          if (params.numbering_style) {
            var styleMap = {
              "arabic": PageNumberStyle.ARABIC,
              "upper_roman": PageNumberStyle.UPPER_ROMAN,
              "lower_roman": PageNumberStyle.LOWER_ROMAN,
              "upper_letters": PageNumberStyle.UPPER_LETTERS,
              "lower_letters": PageNumberStyle.LOWER_LETTERS
            };
            if (styleMap[params.numbering_style]) {
              sectionProps.pageNumberStyle = styleMap[params.numbering_style];
            }
          }

          var newSection = doc.sections.add(sectionProps);
          writeResultFile(RESULT_PATH, { success: true, action: "add", section: getSectionInfo(newSection) });
        }
      }

    } else if (action === "edit") {
      if (typeof params.section_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "section_index is required for edit" });
      } else {
        var section = doc.sections.item(params.section_index);
        if (!section || !section.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Section not found at index: " + params.section_index });
        } else {
          if (params.section_name) section.name = params.section_name;
          if (typeof params.page_number_start === "number") {
            section.pageNumberStart = params.page_number_start;
            section.continueNumbering = false;
          }
          if (params.marker) section.marker = params.marker;
          if (typeof params.continue_numbering === "boolean") {
            section.continueNumbering = params.continue_numbering;
          }
          writeResultFile(RESULT_PATH, { success: true, action: "edit", section: getSectionInfo(section) });
        }
      }

    } else if (action === "delete") {
      if (typeof params.section_index !== "number") {
        writeResultFile(RESULT_PATH, { error: true, message: "section_index is required for delete" });
      } else if (params.section_index === 0) {
        writeResultFile(RESULT_PATH, { error: true, message: "Cannot delete the first section" });
      } else {
        var section2 = doc.sections.item(params.section_index);
        if (!section2 || !section2.isValid) {
          writeResultFile(RESULT_PATH, { error: true, message: "Section not found at index: " + params.section_index });
        } else {
          var secInfo = getSectionInfo(section2);
          section2.remove();
          writeResultFile(RESULT_PATH, { success: true, action: "delete", deletedSection: secInfo });
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: list, add, edit, delete" });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_sections failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_sections',
    {
      title: 'Manage Sections',
      description: 'Add, edit, delete, or list page numbering sections in an InDesign document.',
      inputSchema: {
        action: z.enum(['list', 'add', 'edit', 'delete']).describe('Section operation to perform'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index where section starts (for add)'),
        section_index: z.number().int().min(0).optional().describe('Zero-based section index (for edit/delete)'),
        section_name: z.string().optional().describe('Section name'),
        page_number_start: z.number().int().min(1).optional().describe('Starting page number for this section'),
        continue_numbering: z.boolean().optional().describe('Continue numbering from previous section'),
        marker: z.string().optional().describe('Section marker prefix (shown in page numbers)'),
        numbering_style: z
          .enum(['arabic', 'upper_roman', 'lower_roman', 'upper_letters', 'lower_letters'])
          .optional()
          .describe('Page number style (for add)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
