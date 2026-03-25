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
              text: `印刷入稿前の包括的チェックを実行してください。以下の順序で進めてください。

## チェック手順
1. **ドキュメント情報確認**: get_document_info でカラーモード、サイズ、プロファイルを確認
2. **プリフライトチェック**: preflight_check${profile ? ` (target_pdf_profile: "${profile}")` : ''} で基本チェック
3. **オーバープリント確認**: get_overprint_info で K100 以外のオーバープリント事故を検出
4. **色分解確認**: get_separation_info で版数とスポットカラーの意図確認
5. **画像品質確認**: get_images (include_print_info: true) で解像度・色空間チェック
6. **カラー診断**: get_colors (include_diagnostics: true) でインク総量・色空間ミスマッチ確認
7. **テキスト確認**: check_text_consistency でダミーテキスト・表記揺れ確認

## 報告形式
全チェック完了後、以下の形式で総合レポートを出力:
- ❌ エラー（入稿前に必ず修正）
- ⚠ 警告（確認推奨）
- ✅ 問題なし
各項目にオブジェクト名・UUID・具体的な修正方法を含めること。`,
            },
          },
        ],
      };
    },
  );
}
