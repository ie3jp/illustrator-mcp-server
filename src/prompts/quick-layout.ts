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
              text: `以下のテキスト原稿をアクティブな Illustrator ドキュメントに配置してください。

## ルール
1. まず get_document_info でアートボードサイズとカラーモードを確認
2. テキストを意味的なブロックに分割（見出し、本文、キャプション等を推測）
3. 各ブロックを create_text_frame でアートボード内に配置:
   - 見出しは大きく (18-32pt)、本文は読みやすく (10-14pt)
   - 上から下へ、適切なマージンを取って配置
   - スタイル: ${style}
4. 配置後に list_text_frames で結果を確認し、全体のバランスを報告

## テキスト原稿
${args.text_content}`,
            },
          },
        ],
      };
    },
  );
}
