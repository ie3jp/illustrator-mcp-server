import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function register(server: McpServer): void {
  server.registerPrompt(
    'print-preflight-workflow',
    {
      description:
        'Run a comprehensive pre-press preflight workflow for InDesign. Checks document info, built-in preflight, images, text consistency, and styles in sequence.',
      argsSchema: {
        export_pdf: z
          .boolean()
          .optional()
          .describe('If true, export a PDF after all checks pass (requires output_path)'),
        output_path: z
          .string()
          .optional()
          .describe('Output PDF path (required when export_pdf is true)'),
      },
    },
    (args) => {
      const exportPdf = args.export_pdf === true || String(args.export_pdf) === 'true';
      const outputPath = (args.output_path as string | undefined) ?? '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Run a comprehensive pre-press preflight check for InDesign. Proceed in the following order.

## Check Procedure
1. **Document Info**: Use get_document_info to verify page size, page count, color mode, and document intent.
2. **Built-in Preflight**: Run preflight_check to execute InDesign's native preflight engine. Report all errors and warnings by category.
3. **Image Quality Check**: Use get_images (include_print_info: true) to verify that all placed images are linked, have sufficient resolution, and are in an appropriate color space for print.
4. **Text Consistency Check**: Use check_text_consistency to detect placeholder text (Lorem ipsum, Japanese placeholders) and notation inconsistencies (fullwidth/halfwidth, katakana long vowel, wave dash).
5. **Styles Check**: Use get_styles to review paragraph styles, character styles, and object styles for consistency and completeness.${exportPdf && outputPath ? `
6. **PDF Export**: If all preflight errors are resolved, export the document as PDF using export_pdf with output_path: "${outputPath}".` : ''}

## Report Format
After all checks are complete, output a summary report in this format:
- Error: must fix before submission
- Warning: review recommended
- OK: no issues found
Include page number, object name, UUID (if available), and specific remediation steps for each item.

## AI Limitation Awareness
Do NOT add a disclaimer to every report. Instead, apply these rules:
1. **Distinguish mechanical vs AI findings**: When reporting text consistency results, clearly separate deterministic pattern-match results (dummy text, fullwidth/halfwidth, katakana long vowel) from AI-based findings (typos, contextual inconsistencies). Label AI-based findings as such — they may miss errors or produce false positives.
2. **When no issues are detected**: Never say "no issues found, ready to submit." Say "no issues were detected by these automated checks" and note that items outside scope (design intent, contextual spelling, regulatory requirements, print-shop-specific rules) still require human review.
3. **When the user treats this as a final verification** — either explicitly ("Is this ready for submission?", "Can I send this to print?") or implicitly ("最終チェック", "入稿前チェック", "final check"): Remind them that automated checks are not exhaustive and a human must perform the final review.

## Language
Always respond in the user's language.`,
            },
          },
        ],
      };
    },
  );
}
