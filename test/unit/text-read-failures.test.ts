/**
 * 文字属性の読み取り失敗（MRAP）を握りつぶさないことの検証。
 * 長く使った Illustrator では characterAttributes / paragraphAttributes の読み取りが
 * "an Illustrator error occurred: 1346458189 ('MRAP')"（e.number 1200）で散発的に失敗する（2026 / 30.3.0 実機）。
 * 読めなかった値を既定値で埋めて成功で返すと「成功したのに値が違う」結果になるため、
 * 各ツールが失敗を明示する（isError になる success: false / error: true）ことを、属性を読むと例外を投げるフェイクで確かめる。
 * 一時的な失敗は新しい textRange から 1 度だけ読み直して回復する（実機で回復を確認した経路）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../../src/executor/jsx-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/executor/jsx-runner.js')>();
  return { ...actual, executeJsx: vi.fn(), executeJsxHeavy: vi.fn() };
});
vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return { ...actual, resolveCoordinateSystem: vi.fn(async () => 'artboard-web') };
});

import { executeJsx } from '../../src/executor/jsx-runner.js';
import { register as registerCheckTextConsistency } from '../../src/tools/utility/check-text-consistency.js';
import * as fs from 'fs';
import * as path from 'path';
import { loadToolJsx, runToolJsx, fakeDoc, fakeItem, fakeLayer } from './helpers/read-tool-jsx.js';
import { makeApp, makeDoc, makeLayer, makeTextFrame, mrapError, mrapOnRead, runToolJsx as runAppToolJsx } from './helpers/fake-illustrator.js';
import { extractJsxCode } from './helpers/run-tool-jsx.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID_A = '11111111-2222-4333-8444-555555555555';
const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// ─── common.jsx のヘルパー ─────────────────────────────────────

const COMMON_JSX = fs.readFileSync(path.resolve(__dirname, '../../src/jsx/helpers/common.jsx'), 'utf-8');

function loadHelpers(): any {
  const code = `
  var TextType = { POINTTEXT: 1, AREATEXT: 2, PATHTEXT: 3 };
  var app = { version: "30.3" };
  ${COMMON_JSX}
  return {
    isIllustratorInternalError: isIllustratorInternalError,
    readTextWhole: readTextWhole,
    readTextUnits: readTextUnits,
    newTextReadLog: newTextReadLog,
    noteTextReadFailure: noteTextReadFailure,
    markTextReadFailures: markTextReadFailures,
    attachTextReadFailures: attachTextReadFailures,
    verifyItem: verifyItem
  };`;
  // eslint-disable-next-line no-new-func -- test-only: evaluating ES3 ExtendScript in Node.js
  return new Function(code)(); // NOSONAR
}

const h = loadHelpers();

function errorWithNumber(message: string, num: number): Error {
  const e = new Error(message) as Error & { number: number };
  e.number = num;
  return e;
}

/** 1 文字ずつの範囲（characterAttributes を持つ）の配列 */
function chars(...attrs: Array<Record<string, unknown>>): any[] {
  return attrs.map((ca, i) => ({ contents: String.fromCharCode(65 + i), characterAttributes: { ...ca } }));
}

describe('isIllustratorInternalError', () => {
  it('MRAP（e.number 1200）は内部エラー、値が無いことを表す例外は違う', () => {
    expect(h.isIllustratorInternalError(mrapError())).toBe(true);
    // 実機: 手動カーニングが無い位置の TextRange.kerning は 9551 を投げる
    expect(h.isIllustratorInternalError(errorWithNumber('There is no manual kerning amount set at this location', 9551))).toBe(false);
    // 実機: 空のフレームの文字属性は 1220 Illegal Argument
    expect(h.isIllustratorInternalError(errorWithNumber('Illegal Argument', 1220))).toBe(false);
    expect(h.isIllustratorInternalError(new TypeError('null is not an object'))).toBe(false);
  });
});

describe('readTextWhole', () => {
  it('MRAP なら新しい textRange で 1 度だけ読み直す（同じ characterAttributes は読み直さない）', () => {
    const broken = mrapOnRead({ characterAttributes: { size: 12 } }, 'characterAttributes');
    const good = { characterAttributes: { size: 12 } };
    let calls = 0;
    const tf = { get textRange() { calls++; return calls === 1 ? broken : good; } };
    expect(h.readTextWhole(tf, (tr: any) => tr.characterAttributes.size)).toBe(12);
    expect(calls).toBe(2);
  });

  it('refetch があれば文書から取り直した tf で読み直す', () => {
    const tf = { textRange: mrapOnRead({ characterAttributes: { size: 9 } }, 'characterAttributes') };
    const fresh = { textRange: { characterAttributes: { size: 9 } } };
    expect(h.readTextWhole(tf, (tr: any) => tr.characterAttributes.size, () => fresh)).toBe(9);
  });

  it('読み直しも失敗したら投げる', () => {
    const tf = { textRange: mrapOnRead({ characterAttributes: { size: 9 } }, 'characterAttributes') };
    expect(() => h.readTextWhole(tf, (tr: any) => tr.characterAttributes.size)).toThrow(/MRAP/);
  });

  it('内部エラー以外は読み直さずにそのまま投げる', () => {
    let calls = 0;
    const tf = { get textRange() { calls++; throw errorWithNumber('Illegal Argument', 1220); } };
    expect(() => h.readTextWhole(tf, (tr: any) => tr.characterAttributes.size)).toThrow(/Illegal Argument/);
    expect(calls).toBe(1);
  });
});

describe('readTextUnits', () => {
  it('MRAP の文字は新しい textRange.characters から読み直し、続きもそちらで読む', () => {
    const brokenChars = chars({ size: 1 }, { size: 2 }, { size: 3 });
    mrapOnRead(brokenChars[1], 'characterAttributes');
    mrapOnRead(brokenChars[2], 'characterAttributes');
    const freshChars = chars({ size: 1 }, { size: 2 }, { size: 3 });
    let calls = 0;
    const tf = {
      get textRange() {
        calls++;
        return { characters: calls === 1 ? brokenChars : freshChars };
      },
    };
    expect(h.readTextUnits(tf, 'characters', (ch: any) => ch.characterAttributes.size)).toEqual([1, 2, 3]);
    expect(calls).toBe(2);
  });

  it('最初は units（従来のコレクション）を読み、壊れていたら新しい textRange に切り替えて残りも読む', () => {
    // 実機: tf.characters / tf.textRanges は一度 MRAP を出すと失敗し続けるが、新しい tf.textRange.characters は読める
    const cached = chars({ size: 1 }, { size: 2 }, { size: 3 });
    mrapOnRead(cached[1], 'characterAttributes');
    mrapOnRead(cached[2], 'characterAttributes');
    let freshCalls = 0;
    const tf = {
      textRanges: cached,
      get textRange() { freshCalls++; return { characters: chars({ size: 1 }, { size: 2 }, { size: 3 }) }; },
    };
    const out = h.readTextUnits(tf, 'characters', (ch: any) => ch.characterAttributes.size, { units: tf.textRanges });
    expect(out).toEqual([1, 2, 3]);
    expect(freshCalls).toBe(1);
  });

  it('平常時は units だけを読み、新しい textRange を作らない（Illustrator への触り方を変えない）', () => {
    let freshCalls = 0;
    const cached = chars({ size: 1 }, { size: 2 });
    const tf = { textRanges: cached, get textRange() { freshCalls++; return { characters: cached }; } };
    expect(h.readTextUnits(tf, 'characters', (ch: any) => ch.characterAttributes.size, { units: tf.textRanges })).toEqual([1, 2]);
    expect(freshCalls).toBe(0);
  });

  it('refetch があれば取り直した tf の textRange を使う', () => {
    const broken = chars({ size: 1 }, { size: 2 });
    mrapOnRead(broken[1], 'characterAttributes');
    const tf = { textRange: { characters: broken } };
    let refetched = 0;
    const fresh = { textRange: { characters: chars({ size: 1 }, { size: 2 }) } };
    const out = h.readTextUnits(tf, 'characters', (ch: any) => ch.characterAttributes.size, {
      refetch: () => { refetched++; return fresh; },
    });
    expect(out).toEqual([1, 2]);
    expect(refetched).toBe(1);
  });

  it('同じ文字が読み直しても失敗したら投げる（既定値で埋めない）', () => {
    const broken = chars({ size: 1 }, { size: 2 });
    mrapOnRead(broken[1], 'characterAttributes');
    expect(() => h.readTextUnits({ textRange: { characters: broken } }, 'characters', (ch: any) => ch.characterAttributes.size)).toThrow(/MRAP/);
  });

  it('空のフレームは段落数が 1 でも paragraphs[0] に触れず空配列を返す（実機は No such element）', () => {
    const paragraphs = [] as any[];
    Object.defineProperty(paragraphs, 0, { get: () => { throw errorWithNumber('No such element', 1302); } });
    Object.defineProperty(paragraphs, 'length', { value: 1 });
    const tf = { characters: [], paragraphs, textRange: { characters: [], paragraphs } };
    expect(h.readTextUnits(tf, 'paragraphs', () => 'x', { units: tf.paragraphs })).toEqual([]);
  });

  it('limit / step / until で読む文字を絞れる', () => {
    const tf = { textRange: { characters: chars({ size: 1 }, { size: 2 }, { size: 3 }, { size: 4 }, { size: 5 }) } };
    const size = (ch: any) => ch.characterAttributes.size;
    expect(h.readTextUnits(tf, 'characters', size, { limit: 1 })).toEqual([1]);
    expect(h.readTextUnits(tf, 'characters', size, { step: 2 })).toEqual([1, 3, 5]);
    expect(h.readTextUnits(tf, 'characters', size, { until: (v: number) => v === 3 })).toEqual([1, 2, 3]);
  });
});

describe('markTextReadFailures / attachTextReadFailures', () => {
  it('記録があれば success: false にして件数・UUID を付け、20 件を超えた分は truncated', () => {
    const log = h.newTextReadLog();
    for (let i = 0; i < 25; i++) h.noteTextReadFailure(log, { note: UUID_A, name: 'f' + i }, 'font', mrapError());
    const r = h.markTextReadFailures({ items: [] }, log);
    expect(r.success).toBe(false);
    expect(r.textReadFailures.count).toBe(25);
    expect(r.textReadFailures.items).toHaveLength(20);
    expect(r.textReadFailures.items[0]).toMatchObject({ uuid: UUID_A, what: 'font' });
    expect(r.textReadFailures.truncated).toBe(true);
    expect(r.textReadFailures.note).toContain('MRAP');
  });

  it('記録が無ければ結果を変えない', () => {
    expect(h.markTextReadFailures({ a: 1 }, h.newTextReadLog())).toEqual({ a: 1 });
  });

  it('attach は success を変えない（作成済みのオブジェクトを失敗扱いにしない）', () => {
    const log = h.newTextReadLog();
    h.noteTextReadFailure(log, {}, 'colors', mrapError());
    const r = h.attachTextReadFailures({ success: true }, log);
    expect(r.success).toBe(true);
    expect(r.textReadFailures.count).toBe(1);
  });
});

describe('verifyItem（TextFrame）', () => {
  function frame(ca: Record<string, unknown>, contents = 'Hello'): any {
    return {
      typename: 'TextFrame', name: '', contents, kind: 1, geometricBounds: [0, 10, 10, 0],
      textRange: { characterAttributes: ca },
      parent: { typename: 'Layer', name: 'L1', visible: true, parent: { typename: 'Document' } },
    };
  }

  it('文字属性を読めなければ textReadError を付け、fontSize / fill を黙って省かない', () => {
    const tf = frame(mrapOnRead({ size: 12, tracking: 0, fillColor: { typename: 'NoColor' } }, 'size'));
    const snap = h.verifyItem(tf, 'artboard-web', null);
    expect(snap.textReadError).toContain('MRAP');
    expect(snap.fontSize).toBeUndefined();
  });

  it('一時的な MRAP は読み直して値を返す', () => {
    const tf = frame(mrapOnRead({ size: 12, tracking: 0, fillColor: { typename: 'NoColor' } }, 'size', 1));
    const snap = h.verifyItem(tf, 'artboard-web', null);
    expect(snap.textReadError).toBeUndefined();
    expect(snap.fontSize).toBe(12);
    expect(snap.fill).toEqual({ type: 'none' });
  });

  it('空のフレームは読むものが無いのでエラーにしない', () => {
    const tf = frame(mrapOnRead({}, 'size'), '');
    expect(h.verifyItem(tf, 'artboard-web', null).textReadError).toBeUndefined();
  });
});

// ─── 読み取り系ツール ───────────────────────────────────────

function detailFrame(charList: any[], extra: Record<string, unknown> = {}): any {
  const paragraphs = [
    {
      contents: charList.map((c) => c.contents).join(''),
      paragraphAttributes: { autoLeadingAmount: 120, justification: 'LEFT' },
      characterAttributes: { leading: 14.4, autoLeading: true },
      paragraphStyles: [{ name: 'Normal Paragraph Style' }],
    },
  ];
  // 実機と同じく、従来のコレクション（tf.paragraphs / tf.characters）と毎回新しい tf.textRange の両方を持たせる。
  // 同じ要素を共有するので、要素に仕込んだ失敗はどちらの経路でも起きる（＝読み直しても失敗する）
  return fakeItem('TextFrame', [0, 0, 100, -20], {
    note: UUID_A,
    kind: 'POINTTEXT',
    contents: charList.map((c) => c.contents).join(''),
    orientation: 'HORIZONTAL',
    paragraphs,
    characters: charList,
    textRange: { paragraphs, characters: charList },
    ...extra,
  });
}

const baseChar = {
  textFont: { family: 'Myriad Pro', style: 'Regular' }, size: 12, fillColor: { typename: 'NoColor' }, tracking: 0,
  kerningMethod: 'AUTO', proportionalMetrics: false, akiLeft: -1, akiRight: -1, Tsume: 0,
  baselineShift: 0, horizontalScale: 100, verticalScale: 100, rotation: 0,
};

/** 実機どおり、手動カーニングが無い位置では kerning が 9551 を投げる文字 */
function noKerning<T extends object>(ch: T): T {
  Object.defineProperty(ch, 'kerning', { get: () => { throw errorWithNumber('There is no manual kerning amount set at this location', 9551); } });
  return ch;
}

describe('get_text_frame_detail', () => {
  const jsx = loadToolJsx('read/get-text-frame-detail.ts');
  const run = (tf: any) => runToolJsx(jsx, fakeDoc({ textFrames: [tf] }), { uuid: UUID_A, coordinate_system: 'artboard-web' });

  it('文字属性が読めなければ、どの文字かを添えてエラーにする（autoLeading: false / leading: 0 などで埋めない）', () => {
    const cs = chars(baseChar, baseChar).map(noKerning);
    mrapOnRead(cs[1], 'characterAttributes');
    const result = run(detailFrame(cs));
    expect(result.error).toBe(true);
    expect(result.message).toContain('character 1');
    expect(result.message).toContain('MRAP');
    expect(result.characterRuns).toBeUndefined();
  });

  it('段落属性が読めなければエラーにする（paragraphAttributes を欠いたまま返さない）', () => {
    const cs = chars(baseChar).map(noKerning);
    const tf = detailFrame(cs);
    mrapOnRead(tf.paragraphs[0], 'paragraphAttributes');
    const result = run(tf);
    expect(result.error).toBe(true);
    expect(result.message).toContain('paragraph 0');
  });

  it('一時的な MRAP は読み直して正しい値を返す', () => {
    const cs = chars(baseChar, { ...baseChar, size: 20 }).map(noKerning);
    mrapOnRead(cs[1], 'characterAttributes', 1);
    const tf = detailFrame(cs);
    mrapOnRead(tf.paragraphs[0], 'characterAttributes', 1);
    const result = run(tf);
    expect(result.error).toBeUndefined();
    expect(result.characterRuns.map((r: any) => r.fontSize)).toEqual([12, 20]);
    expect(result.paragraphAttributes[0]).toMatchObject({ autoLeading: true, leading: 14.4, justification: 'left' });
  });

  it('手動カーニングが無い位置（9551）はペアに入れず、ある位置は値を返す', () => {
    const cs = chars(baseChar, baseChar);
    noKerning(cs[0]);
    cs[1].kerning = -40;
    const result = run(detailFrame(cs));
    expect(result.error).toBeUndefined();
    expect(result.kerningPairs).toEqual([{ index: 1, left: 'B', right: '', value: -40 }]);
  });

  it('kerning の読み取りが MRAP なら「手動カーニングなし」とみなさずエラーにする', () => {
    const cs = chars(baseChar);
    Object.defineProperty(cs[0], 'kerning', { get: () => { throw mrapError(); } });
    expect(run(detailFrame(cs)).error).toBe(true);
  });

  it('空のフレームは段落・ランが空のまま成功する（paragraphs[0] の No such element で落ちない）', () => {
    const paragraphs = [] as any[];
    Object.defineProperty(paragraphs, 0, { get: () => { throw errorWithNumber('No such element', 1302); } });
    Object.defineProperty(paragraphs, 'length', { value: 1 });
    const tf = fakeItem('TextFrame', [0, 0, 100, -20], {
      note: UUID_A, kind: 'POINTTEXT', contents: '', orientation: 'HORIZONTAL',
      paragraphs, characters: [], textRange: { paragraphs, characters: [] },
    });
    const result = run(tf);
    expect(result.error).toBeUndefined();
    expect(result.paragraphAttributes).toEqual([]);
    expect(result.characterRuns).toEqual([]);
  });
});

function listFrame(uuid: string, bounds: number[]): any {
  const cs = [{
    characterAttributes: { textFont: { family: 'Helvetica', style: 'Regular' }, size: 12 },
    paragraphStyles: [{ name: 'Body' }],
    characterStyles: [{ name: 'Emphasis' }],
  }];
  return fakeItem('TextFrame', bounds, {
    note: uuid, kind: 'POINTTEXT', contents: 'Hello', orientation: 'HORIZONTAL',
    textRanges: cs, textRange: { characters: cs },
  });
}

describe('list_text_frames', () => {
  const jsx = loadToolJsx('read/list-text-frames.ts');

  it('読めなかったフレームは font を null にして部分失敗（success: false）にし、他のフレームは返す', () => {
    const a = listFrame(UUID_A, [0, 0, 50, -10]);
    const b = listFrame(UUID_B, [0, -20, 50, -30]);
    mrapOnRead(b.textRange.characters[0], 'characterAttributes');
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [a, b] }), { coordinate_system: 'artboard-web' });
    expect(result.success).toBe(false);
    expect(result.textReadFailures.count).toBe(1);
    expect(result.textReadFailures.items[0].uuid).toBe(UUID_B);
    const fb = result.textFrames.find((f: any) => f.uuid === UUID_B);
    expect(fb).toMatchObject({ fontFamily: null, fontSize: null, paragraphStyle: null });
    expect(fb.textReadError).toContain('MRAP');
    expect(result.textFrames.find((f: any) => f.uuid === UUID_A)).toMatchObject({ fontFamily: 'Helvetica', fontSize: 12 });
  });

  it('返すページに入らないフレームの失敗では部分失敗にしない', () => {
    const a = listFrame(UUID_A, [0, 0, 50, -10]);
    const b = listFrame(UUID_B, [0, -20, 50, -30]);
    mrapOnRead(b.textRange.characters[0], 'characterAttributes');
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [a, b] }), { coordinate_system: 'artboard-web', limit: 1 });
    expect(result.textFrames.map((f: any) => f.uuid)).toEqual([UUID_A]);
    expect(result.success).toBeUndefined();
  });

  it('一時的な MRAP は読み直して成功する', () => {
    const a = listFrame(UUID_A, [0, 0, 50, -10]);
    mrapOnRead(a.textRange.characters[0], 'characterAttributes', 1);
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [a] }), { coordinate_system: 'artboard-web' });
    expect(result.success).toBeUndefined();
    expect(result.textFrames[0].fontFamily).toBe('Helvetica');
  });
});

describe('check_text_consistency', () => {
  it('内容を読めなかったフレームを黙って除かず、部分失敗にする', () => {
    const a = listFrame(UUID_A, [0, 0, 50, -10]);
    const b = listFrame(UUID_B, [0, -20, 50, -30]);
    mrapOnRead(b, 'contents');
    const result = runToolJsx(loadToolJsx('utility/check-text-consistency.ts'), fakeDoc({ textFrames: [a, b] }), {});
    expect(result.totalFrames).toBe(1);
    expect(result.success).toBe(false);
    expect(result.textReadFailures.items[0]).toMatchObject({ uuid: UUID_B, what: 'contents' });
  });
});

describe('extract_design_tokens (JSX)', () => {
  it('フォントを読めなかったフレームを記録して部分失敗にする', () => {
    const a = makeTextFrame({ note: UUID_A, contents: 'A' });
    const b = makeTextFrame({ note: UUID_B, contents: 'B' });
    a.textRange.characterAttributes.textFont = { name: 'Helvetica', style: 'Regular' };
    b.textRange.characterAttributes.textFont = { name: 'Helvetica', style: 'Regular' };
    mrapOnRead(b.textRange.characters[0], 'characterAttributes');
    const layer = makeLayer('L1');
    layer.addItem(a);
    layer.addItem(b);
    const result = runAppToolJsx(extractJsxCode('read/extract-design-tokens.ts'), {}, makeApp(makeDoc({ layers: [layer] })));
    expect(result.success).toBe(false);
    expect(result.fontEntries).toEqual([{ fontFamily: 'Helvetica', fontStyle: 'Regular', fontSize: 12 }]);
    expect(result.textReadFailures.items[0].uuid).toBe(UUID_B);
  });
});

describe('get_selection / find_objects / get_effects', () => {
  function docWith(tf: any): any {
    const layer = fakeLayer('L1', [tf]);
    tf.parent = layer;
    tf.layer = layer;
    return fakeDoc({ layers: [layer], selection: [tf], textFrames: [tf] });
  }

  it('get_selection: フォントを読めなければ null にして部分失敗にする', () => {
    const tf = listFrame(UUID_A, [0, 0, 50, -10]);
    mrapOnRead(tf.textRange.characters[0], 'characterAttributes');
    const result = runToolJsx(loadToolJsx('read/get-selection.ts'), docWith(tf), { coordinate_system: 'artboard-web' });
    expect(result.success).toBe(false);
    expect(result.items[0]).toMatchObject({ fontFamily: null, fontSize: null, contents: 'Hello' });
  });

  it('find_objects: font_name で読めなかったテキストを「不一致」で黙って外さず、部分失敗にする', () => {
    const tf = listFrame(UUID_A, [0, 0, 50, -10]);
    mrapOnRead(tf.textRange.characters[0], 'characterAttributes');
    const result = runToolJsx(loadToolJsx('read/find-objects.ts'), docWith(tf), { coordinate_system: 'artboard-web', font_name: 'Helvetica' });
    expect(result.count).toBe(0);
    expect(result.success).toBe(false);
    expect(result.textReadFailures.items[0]).toMatchObject({ uuid: UUID_A, what: 'font' });
  });

  it('find_objects: 読めれば font_name / font_size で見つかる', () => {
    const tf = listFrame(UUID_A, [0, 0, 50, -10]);
    const result = runToolJsx(loadToolJsx('read/find-objects.ts'), docWith(tf), {
      coordinate_system: 'artboard-web', font_name: 'Helv', font_size: { min: 10, max: 14 },
    });
    expect(result.count).toBe(1);
    expect(result.success).toBeUndefined();
  });

  it('get_effects: 文字の塗りを読めなければ部分失敗にする', () => {
    const tf = listFrame(UUID_A, [0, 0, 50, -10]);
    mrapOnRead(tf.textRange.characters[0], 'characterAttributes');
    const result = runToolJsx(loadToolJsx('read/get-effects.ts'), docWith(tf), { coordinate_system: 'artboard-web' });
    expect(result.success).toBe(false);
    expect(result.items[0].fill).toBeNull();
  });
});

describe('check_contrast (JSX)', () => {
  it('文字色を読めなかったテキストを判定から黙って外さず、部分失敗にする', () => {
    const tf = listFrame(UUID_A, [0, 0, 50, -10]);
    tf.textRange.characters[0].characterAttributes.fillColor = { typename: 'RGBColor', red: 0, green: 0, blue: 0 };
    mrapOnRead(tf.textRange.characters[0], 'characterAttributes');
    const layer = fakeLayer('L1', [tf]);
    tf.parent = layer;
    const doc = fakeDoc({ layers: [layer], pathItems: [], textFrames: [tf], rasterItems: [], placedItems: [] });
    const result = runToolJsx(loadToolJsx('read/check-contrast.ts'), doc, { auto_detect: true });
    expect(result.success).toBe(false);
    expect(result.colorItems).toEqual([]);
    expect(result.textReadFailures.items[0]).toMatchObject({ uuid: UUID_A, what: 'text color' });
  });
});

describe('check_text_consistency (handler)', () => {
  it('JSX の textReadFailures を最終結果まで通して isError にする', async () => {
    let handler: ((p: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>) | undefined;
    const server = { registerTool: (_n: string, _c: unknown, hd: typeof handler) => { handler = hd; } } as unknown as McpServer;
    registerCheckTextConsistency(server);
    const textReadFailures = { count: 1, items: [{ uuid: UUID_B, what: 'contents', message: 'MRAP' }], note: 'n' };
    vi.mocked(executeJsx).mockResolvedValue({
      totalFrames: 1,
      frames: [{ uuid: UUID_A, contents: 'Lorem ipsum', layerName: 'L1', artboardIndex: 0 }],
      success: false,
      textReadFailures,
    });
    const res = await handler!({});
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0].text);
    expect(body).toMatchObject({ totalFrames: 1, success: false, textReadFailures });
    expect(body.mechanicalChecks.dummyTexts.length).toBeGreaterThan(0);
  });
});
