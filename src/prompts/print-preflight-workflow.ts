import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function register(server: McpServer): void {
  server.registerPrompt(
    'print-preflight-workflow',
    {
      description:
        'Run a comprehensive pre-press preflight workflow. Checks document info, overprint, separations, image quality, color diagnostics, and text consistency in sequence.',
      argsSchema: {
        target_profile: z
          .enum(['x1a', 'x4'])
          .optional()
          .describe('Target PDF/X profile for compliance checks'),
      },
    },
    (args) => {
      const profile = args.target_profile as string | undefined;
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Run a comprehensive pre-press preflight check. Proceed in the following order.

## Check Procedure
1. **Document Info**: Use get_document_info to verify color mode, dimensions, and profile.
2. **Preflight Check**: Run preflight_check${profile ? ` (target_pdf_profile: "${profile}")` : ''} for basic validation.
3. **Overprint Check**: Use get_overprint_info to detect unintended overprints (other than K100).
4. **Separation Check**: Use get_separation_info to verify plate count and spot color intent.
5. **Image Quality Check**: Use get_images (include_print_info: true) to check resolution and color space.
6. **Color Diagnostics**: Use get_colors (include_diagnostics: true) to check total ink coverage and color space mismatches.
7. **Text Consistency Check**: Use check_text_consistency to detect placeholder text and inconsistencies.

## Report Format
After all checks are complete, output a summary report in this format:
- Error: must fix before submission
- Warning: review recommended
- OK: no issues found
Include object name, UUID, and specific remediation steps for each item.

## AI Limitation Awareness
Do NOT include a disclaimer in every report. However, you MUST proactively warn the user in these situations:
- The user asks "Is this ready for submission?" or similar confirmation — remind them that AI checks are not exhaustive and a human must perform the final review.
- All checks return OK — do not say "no issues found, ready to submit." Instead, say something like "no issues were detected by these checks" and note that items outside the scope of automated checks (e.g. design intent, spelling in context, regulatory requirements) still need human review.
- The user treats the AI report as the final verification — remind them this does not replace a professional preflight check.

## Language
Always respond in the user's language.`,
            },
          },
        ],
      };
    },
  );
}
