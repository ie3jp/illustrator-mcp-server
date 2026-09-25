/**
 * export の SVG documentEncoding マッピング検証
 *
 * jsxCode はテンプレート文字列のため tsc の型検査が届かない。
 * jsx-syntax.test.ts と同じ手順でテンプレートを取り出し、encoding 分岐だけを
 * 切り出して実際に実行することで、文字列 grep では区別できない
 * 「既定が UTF8 になる」ことを挙動として確認する。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register as registerExport } from '../../src/tools/export/export.js';
import { captureInputSchema } from './helpers/tool-schema.js';

const EXPORT_TS = join(dirname(fileURLToPath(import.meta.url)), '../../src/tools/export/export.ts');

function extractEncodingBlock(): string {
  const src = readFileSync(EXPORT_TS, 'utf8');
  const tpl = src.match(/const jsxCode = `([\s\S]*?)\n`;/);
  if (!tpl) throw new Error('jsxCode template not found in export.ts');
  // テンプレートリテラルとして評価し、\\. 等のエスケープを実際のJSXコードに展開する。
  // 入力はこのリポジトリ内のソースファイルのみ（外部入力なし）。
  // eslint-disable-next-line no-eval
  const code = eval('`' + tpl[1].replace(/`/g, '\\`') + '`') as string;
  const block = code.match(/if \(svgOpts\.encoding === "ascii"\)[\s\S]*?SVGDocumentEncoding\.UTF8;\s*\}/);
  if (!block) throw new Error('encoding branch not found in export jsxCode');
  return block[0];
}

// ExtendScript の SVGDocumentEncoding を番兵値で差し替え、どの定数が選ばれたかを観測する。
const SENTINEL = { ASCII: 'ASCII', UTF8: 'UTF8', UTF16: 'UTF16' };

function resolveEncoding(svgOpts: Record<string, unknown>): string | undefined {
  const opts: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('svgOpts', 'opts', 'SVGDocumentEncoding', extractEncodingBlock())(
    svgOpts,
    opts,
    SENTINEL,
  );
  return opts.documentEncoding as string | undefined;
}

describe('export SVG documentEncoding', () => {
  it('defaults to UTF8 when svg_options.encoding is omitted', () => {
    expect(resolveEncoding({})).toBe('UTF8');
  });

  it('maps each accepted value to its SVGDocumentEncoding constant', () => {
    expect(resolveEncoding({ encoding: 'utf8' })).toBe('UTF8');
    expect(resolveEncoding({ encoding: 'ascii' })).toBe('ASCII');
    expect(resolveEncoding({ encoding: 'utf16' })).toBe('UTF16');
  });

  it('falls back to UTF8 for values the schema would have rejected', () => {
    expect(resolveEncoding({ encoding: 'iso8859' })).toBe('UTF8');
  });

  it('accepts the three documented values in the input schema', () => {
    const schema = captureInputSchema(registerExport);
    for (const encoding of ['utf8', 'ascii', 'utf16']) {
      expect(
        schema.safeParse({ target: 'artboard:0', format: 'svg', svg_options: { encoding } }).success,
      ).toBe(true);
    }
  });

  it('rejects an unsupported encoding at the schema layer', () => {
    const schema = captureInputSchema(registerExport);
    // ISO8859 は SVGDocumentEncoding に存在しない（ASCII が ISO 8859-1 を意味する）。
    expect(
      schema.safeParse({ target: 'artboard:0', format: 'svg', svg_options: { encoding: 'iso8859' } })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ target: 'artboard:0', format: 'svg', svg_options: { encoding: 'UTF-8' } })
        .success,
    ).toBe(false);
  });

  it('leaves raster formats unaffected', () => {
    const schema = captureInputSchema(registerExport);
    expect(schema.safeParse({ target: 'artboard:0', format: 'png' }).success).toBe(true);
    expect(
      schema.safeParse({ target: 'artboard:0', format: 'png', raster_options: { dpi: 300 } }).success,
    ).toBe(true);
  });
});
