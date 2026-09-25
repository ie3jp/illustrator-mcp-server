import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ツールファイルの埋め込み JSX（const jsxCode = `...`）を common.jsx と一緒に
 * Node 上で実行し、writeResultFile に渡された結果を返すテスト用ヘルパー。
 *
 * - preflightChecks は常に通過、readParamsFile は params を返す
 * - Illustrator の列挙定数やアプリオブジェクトは globals で注入する
 * 入力はこのリポジトリ内のソースのみのため、動的評価はテスト用途に限って使う。
 */
const COMMON_JSX = readFileSync(resolve(__dirname, '../../../src/jsx/helpers/common.jsx'), 'utf-8');

export function extractJsxCode(toolFile: string): string {
  const src = readFileSync(resolve(__dirname, '../../../src/tools', toolFile), 'utf-8');
  const m = src.match(/const jsxCode = `([\s\S]*?)\n`;/);
  if (!m) throw new Error(`jsxCode not found in ${toolFile}`);
  // テンプレートリテラルのエスケープを展開する（jsx-syntax.test.ts と同じ手法）
  // eslint-disable-next-line no-eval -- test-only: expanding a template literal from repo source
  return eval('`' + m[1].replace(/`/g, '\\`') + '`') as string;
}

export function runToolJsx(
  toolFile: string,
  globals: Record<string, unknown>,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  const jsx = extractJsxCode(toolFile);
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
