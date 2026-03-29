import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function register(server: McpServer): void {
  server.registerPrompt(
    'quick-layout',
    {
      description:
        'Place text content onto the active Illustrator artboard with automatic layout. Paste your text and Claude will arrange it as headings, body text, and captions.',
      argsSchema: {
        text_content: z.string().describe('Text content to place (paste directly)'),
        style: z
          .enum(['minimal', 'business', 'casual'])
          .optional()
          .describe('Layout style (default: minimal)'),
      },
    },
    (args) => {
      const style = (args.style as string) || 'minimal';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Place the following text content onto the active Illustrator artboard with automatic layout.

## Rules
1. First, use get_document_info to check the artboard size and color mode.
2. Split the text into semantic blocks (infer headings, body text, captions, etc.).
3. Place each block using create_text_frame within the artboard:
   - Headings: large (18-32pt), body text: readable (10-14pt)
   - Arrange top to bottom with appropriate margins
   - Style: ${style}
4. After placement, use list_text_frames to verify the result and report the overall balance.

## Text Content
${args.text_content}

## Language
Always respond in the user's language.`,
            },
          },
        ],
      };
    },
  );
}
