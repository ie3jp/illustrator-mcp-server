/**
 * ExtendScript は括弧なしでネストした三項演算子（a ? x : b ? y : z）を誤評価する。
 * Node では正しく動くためユニットテストをすり抜け、実機でだけ壊れる（modify_object の
 * justification が常に "right" になった実例あり）。JSX 中の該当パターンを検出する。
 * @see https://community.adobe.com/t5/after-effects/extendscript-throws-on-nested-ternary-operator/m-p/9574014
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src');

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectFiles(full);
    return /\.(ts|jsx)$/.test(entry) ? [full] : [];
  });
}

/** .jsx はそのまま、.ts は JSX らしいテンプレートリテラルだけを対象にする */
function jsxBlocks(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  if (file.endsWith('.jsx')) return [src];
  return [...src.matchAll(/`([\s\S]*?)`/g)]
    .map((m) => m[1])
    .filter((code) => code.length > 150 && /app\.|function |var /.test(code));
}

/** 文字列リテラルとコメントを空白に置き換える（括弧・?・: の誤検出を防ぐ） */
function stripStringsAndComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** 同じ括弧深さで 2 つ目の ? が現れる三項演算子を返す */
export function findNestedTernaries(code: string): string[] {
  const s = stripStringsAndComments(code);
  const found: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '?') continue;
    let depth = 0;
    for (let j = i + 1; j < s.length; j++) {
      const c = s[j];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && (c === ';' || c === ',')) break;
      else if (depth === 0 && c === '?') {
        found.push(code.slice(Math.max(0, i - 40), j + 20).replace(/\s+/g, ' '));
        break;
      }
    }
  }
  return found;
}

describe('JSX の三項演算子', () => {
  it('検出器: 括弧なしのネストを検出し、括弧付きは許容する', () => {
    expect(findNestedTernaries('var a = x ? 1 : y ? 2 : 3;')).toHaveLength(1);
    expect(findNestedTernaries('var a = x ? y ? 1 : 2 : 3;')).toHaveLength(1);
    expect(findNestedTernaries('var a = x ? 1 : (y ? 2 : 3);')).toHaveLength(0);
    expect(findNestedTernaries('var a = x ? "?" : 3; var b = f(p ? 1 : 2, q ? 3 : 4);')).toHaveLength(0);
  });

  it('src 配下の JSX に括弧なしでネストした三項演算子がない', () => {
    const offenders = collectFiles(SRC_DIR).flatMap((file) =>
      jsxBlocks(file).flatMap((code) => findNestedTernaries(code).map((snippet) => `${relative(SRC_DIR, file)}: ${snippet}`)),
    );
    expect(offenders).toEqual([]);
  });
});
