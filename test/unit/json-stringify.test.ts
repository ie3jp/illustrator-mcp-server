import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// common.jsx を読み込んでテスト用にロードする
// ExtendScript (ES3) の関数を Node.js 環境でテストするため、
// テストコード内でのみ動的評価を使用（プロダクションコードではない）
const jsxPath = path.resolve(__dirname, '../../src/jsx/helpers/common.jsx');
const jsxCode = fs.readFileSync(jsxPath, 'utf-8');

const wrappedCode = `
  ${jsxCode}
  return { jsonStringify, jsonParse, _jsonEscapeString, generateUUID };
`;
// eslint-disable-next-line no-new-func -- test-only: loading ES3 helpers for validation
const factory = new Function(wrappedCode); // NOSONAR
const helpers = factory() as {
  jsonStringify: (obj: unknown) => string;
  jsonParse: (str: string) => unknown;
  generateUUID: () => string;
};

describe('jsonStringify', () => {
  it('handles null', () => {
    expect(helpers.jsonStringify(null)).toBe('null');
  });

  it('handles undefined', () => {
    expect(helpers.jsonStringify(undefined)).toBe('null');
  });

  it('handles numbers', () => {
    expect(helpers.jsonStringify(42)).toBe('42');
    expect(helpers.jsonStringify(0)).toBe('0');
    expect(helpers.jsonStringify(-3.14)).toBe('-3.14');
  });

  it('handles NaN as null', () => {
    expect(helpers.jsonStringify(NaN)).toBe('null');
  });

  it('handles Infinity as null', () => {
    expect(helpers.jsonStringify(Infinity)).toBe('null');
    expect(helpers.jsonStringify(-Infinity)).toBe('null');
  });

  it('handles booleans', () => {
    expect(helpers.jsonStringify(true)).toBe('true');
    expect(helpers.jsonStringify(false)).toBe('false');
  });

  it('handles strings', () => {
    expect(helpers.jsonStringify('hello')).toBe('"hello"');
    expect(helpers.jsonStringify('')).toBe('""');
  });

  it('escapes special characters', () => {
    expect(helpers.jsonStringify('line1\nline2')).toBe('"line1\\nline2"');
    expect(helpers.jsonStringify('tab\there')).toBe('"tab\\there"');
    expect(helpers.jsonStringify('quote"here')).toBe('"quote\\"here"');
  });

  it('handles Japanese characters', () => {
    expect(helpers.jsonStringify('日本語テスト')).toBe('"日本語テスト"');
  });

  it('handles arrays', () => {
    expect(helpers.jsonStringify([1, 2, 3])).toBe('[1,2,3]');
    expect(helpers.jsonStringify([])).toBe('[]');
  });

  it('handles objects', () => {
    expect(helpers.jsonStringify({ a: 1, b: 'hello' })).toBe('{"a":1,"b":"hello"}');
  });

  it('handles nested structures', () => {
    const obj = { items: [{ name: 'test', value: 42 }] };
    expect(helpers.jsonStringify(obj)).toBe('{"items":[{"name":"test","value":42}]}');
  });

  it('handles NaN in nested objects', () => {
    const result = helpers.jsonStringify({ x: 10, y: NaN, name: 'point' });
    const parsed = JSON.parse(result);
    expect(parsed.x).toBe(10);
    expect(parsed.y).toBe(null);
    expect(parsed.name).toBe('point');
  });
});

describe('jsonParse', () => {
  it('parses objects', () => {
    expect(helpers.jsonParse('{"a":1,"b":"hello"}')).toEqual({ a: 1, b: 'hello' });
  });

  it('parses arrays', () => {
    expect(helpers.jsonParse('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns null for empty string', () => {
    expect(helpers.jsonParse('')).toBe(null);
  });

  it('strips BOM', () => {
    expect(helpers.jsonParse('\uFEFF{"key":"value"}')).toEqual({ key: 'value' });
  });
});

describe('generateUUID', () => {
  it('returns a valid UUID v4 format', () => {
    const uuid = helpers.generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates unique UUIDs', () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      uuids.add(helpers.generateUUID());
    }
    expect(uuids.size).toBe(100);
  });
});
