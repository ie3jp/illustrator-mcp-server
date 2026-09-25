import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

/**
 * 明示された出力パスの検証（export / export_pdf / save_document 共用）。
 * 相対パスは Illustrator 側のカレントフォルダ基準で解釈され、書き出し先が予測できないため受け付けない。
 * 問題なければ null、あればエラーメッセージを返す。
 */
export function checkAbsoluteOutputPath(outputPath: string, paramName: string): string | null {
  return isAbsolute(outputPath) ? null : `${paramName} must be an absolute path: ${outputPath}`;
}

/**
 * 出力パスの親ディレクトリをシンボリックリンク解決した実パスに置き換える。
 * macOS の /tmp は /private/tmp へのシンボリックリンクで、Illustrator の書き出しは
 * シンボリックリンク経由のパスに書き込めない場合がある。
 * ディレクトリが存在しない・解決できない場合は元のパスをそのまま返す（存在チェックは JSX 側で行う）。
 */
export function resolveOutputPath(outputPath: string): string {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) return outputPath;
  try {
    return join(realpathSync(dir), basename(outputPath));
  } catch {
    return outputPath;
  }
}
