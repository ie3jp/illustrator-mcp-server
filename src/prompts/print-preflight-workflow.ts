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
