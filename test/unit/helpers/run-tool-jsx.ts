import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ツールの埋め込み JSX を common.jsx と一緒に Node 上で実行し、writeResultFile の結果を返す。
 * 列挙定数・app は globals で注入する。動的評価の入力はリポジトリ内のソースのみ（テスト専用）。
 */
const COMMON_JSX = readFileSync(resolve(__dirname, '../../../src/jsx/helpers/common.jsx'), 'utf-8');

export function extractJsxCode(toolFile: string): string {
  const src = readFileSync(resolve(__dirname, '../../../src/tools', toolFile), 'utf-8');
  const m = src.match(/const jsxCode = `([\s\S]*?)\n`;/);
  if (!m) throw new Error(`jsxCode not found in ${toolFile}`);
  // テンプレートリテラルのエスケープを展開する
  // eslint-disable-next-line no-eval -- test-only: expanding a template literal from repo source
  return eval('`' + m[1].replace(/`/g, '\\`') + '`') as string;
}

export function runToolJsx(
  toolFile: string,
  globals: Record<string, unknown>,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return runJsxCode(extractJsxCode(toolFile), globals, params);
}

/** 展開済みの JSX（ハンドラが executeJsx に渡したもの等）を同じ条件で実行する */
export function runJsxCode(
  jsx: string,
  globals: Record<string, unknown>,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  const names = Object.keys(globals);
  const body = `
    ${COMMON_JSX}
    function preflightChecks() { return null; }
    function readParamsFile() { return __params; }
    function writeResultFile(p, r) { __out.result = r; }
    var RESULT_PATH = "result.json";
    var PARAMS_PATH = "params.json";
    ${jsx}
  `;
  const out: { result?: Record<string, unknown> } = {};
  // eslint-disable-next-line no-new-func -- test-only: evaluating ES3 ExtendScript in Node.js
  const fn = new Function('__out', '__params', ...names, body); // NOSONAR
  fn(out, params, ...names.map((n) => globals[n]));
  if (!out.result) throw new Error('writeResultFile was not called');
  return out.result;
}
