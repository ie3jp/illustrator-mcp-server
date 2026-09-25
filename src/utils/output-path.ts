import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

/** 相対パスは Illustrator のカレントフォルダ基準になり書き出し先が読めないため拒否する */
export function checkAbsoluteOutputPath(outputPath: string, paramName: string): string | null {
  return isAbsolute(outputPath) ? null : `${paramName} must be an absolute path: ${outputPath}`;
}

/**
 * 親ディレクトリを実パスに解決する。Illustrator はシンボリックリンク経由（macOS の /tmp 等）に
 * 書き込めない場合がある。解決できなければそのまま返す（存在チェックは JSX 側）
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
