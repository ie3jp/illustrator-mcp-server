import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

/** 相対パスは Illustrator のカレントフォルダ基準になり書き出し先が読めないため拒否する */
export function checkAbsoluteOutputPath(outputPath: string, paramName: string): string | null {
  return isAbsolute(outputPath) ? null : `${paramName} must be an absolute path: ${outputPath}`;
}

/**
 * 拡張子を書き出し形式に揃える。Document.exportFile() は拡張子を自動で付けるため、省略したパスのまま
 * 既存ファイルを確認すると実際に書かれる <path>.<ext> を見落とす。
 * 別の拡張子が付いている場合に置換か追記かは未確認なので推測せず拒否する
 */
export function normalizeOutputExtension(
  outputPath: string,
  ext: string,
  paramName: string,
): { path: string; error?: undefined } | { error: string; path?: undefined } {
  const name = basename(outputPath);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { path: `${outputPath}.${ext}` };
  const current = name.substring(dot + 1);
  if (current.toLowerCase() === ext) return { path: outputPath };
  return { error: `${paramName} has extension ".${current}" but the format needs ".${ext}". Use a path ending in ".${ext}": ${outputPath}` };
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
