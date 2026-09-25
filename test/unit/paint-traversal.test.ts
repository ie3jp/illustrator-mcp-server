/**
 * common.jsx の共通走査（全アイテム / 塗れる末端）を使うツールの JSX をフェイク DOM 上で検証する。
 * GroupItem・CompoundPathItem 自身の fillColor は実機では子に伝わらないため、フェイクでも代入を無視させる。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn().mockResolvedValue({}),
  executeJsxHeavy: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return { ...actual, resolveCoordinateSystem: vi.fn(async (explicit?: string) => explicit ?? 'document') };
});

import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import { register as registerCreateGradient } from '../../src/tools/modify/create-gradient.js';
import { register as registerReplaceColor } from '../../src/tools/modify/replace-color.js';
import { register as registerConvertToOutlines } from '../../src/tools/modify/convert-to-outlines.js';
import { register as registerFindObjects } from '../../src/tools/read/find-objects.js';
import { runJsxCode } from './helpers/run-tool-jsx.js';
import { ignoreWrites, rejectWrites } from './helpers/fake-illustrator.js';

const TOOLS: Record<string, (server: McpServer) => void> = {
  'create_gradient': registerCreateGradient,
  'replace_color': registerReplaceColor,
  'convert_to_outlines': registerConvertToOutlines,
  'find_objects': registerFindObjects,
};

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const cmyk = (c: number, m: number, y: number, k: number) => ({ typename: 'CMYKColor', cyan: c, magenta: m, yellow: y, black: k });
const noColor = () => ({ typename: 'NoColor' });

const GLOBALS = {
  DocumentColorSpace: { CMYK: 'DCS_CMYK', RGB: 'DCS_RGB' },
  TextType: { POINTTEXT: 1, AREATEXT: 2, PATHTEXT: 3 },
  GradientType: { LINEAR: 'LINEAR', RADIAL: 'RADIAL' },
  CMYKColor: function CMYKColor(this: Obj) { this.typename = 'CMYKColor'; },
  RGBColor: function RGBColor(this: Obj) { this.typename = 'RGBColor'; },
  GrayColor: function GrayColor(this: Obj) { this.typename = 'GrayColor'; },
  NoColor: function NoColor(this: Obj) { this.typename = 'NoColor'; },
  GradientColor: function GradientColor(this: Obj) { this.typename = 'GradientColor'; },
};

function path(extra: Obj = {}): Obj {
  return {
    typename: 'PathItem', name: '', note: '', hidden: false, locked: false, guides: false, clipping: false,
    filled: true, fillColor: cmyk(0, 0, 0, 100), stroked: false, strokeColor: noColor(), strokeWidth: 1,
    geometricBounds: [0, 10, 10, 0], ...extra,
  };
}

function text(fill: Obj, extra: Obj = {}): Obj {
  const ca = { fillColor: fill, strokeColor: noColor(), strokeWeight: 0 };
  const range = { characterAttributes: ca };
  return {
    typename: 'TextFrame', name: '', note: '', hidden: false, contents: 'A', kind: 1,
    geometricBounds: [0, 10, 10, 0], textRange: range, textRanges: [range], characters: [range], ...extra,
  };
}

/** GroupItem / CompoundPathItem。自身の fillColor 等への代入は実機同様に無視する */
function container(typename: 'GroupItem' | 'CompoundPathItem', children: Obj[], extra: Obj = {}): Obj {
  const c: Obj = { typename, name: '', note: '', hidden: false, geometricBounds: [0, 10, 10, 0], filled: false, fillColor: undefined, ...extra };
  if (typename === 'CompoundPathItem') {
    c.pathItems = children;
    c.pageItems = [];
  } else {
    c.pageItems = children;
  }
  for (const ch of children) ch.parent = c;
  ignoreWrites(c, 'filled');
  ignoreWrites(c, 'fillColor');
  return c;
}

function layer(name: string, items: Obj[], sub: Obj[] = [], extra: Obj = {}): Obj {
  const l: Obj = { typename: 'Layer', name, visible: true, locked: false, pageItems: items, layers: sub, ...extra };
  for (const it of items) it.parent = l;
  for (const s of sub) s.parent = l;
  return l;
}

function doc(layers: Obj[], extra: Obj = {}): Obj {
  const d: Obj = {
    typename: 'Document',
    documentColorSpace: 'DCS_CMYK',
    layers,
    artboards: Object.assign([{ artboardRect: [0, 100, 100, 0] }], { getActiveArtboardIndex: () => 0 }),
    gradients: {
      add: () => {
        const stops: Obj[] = [{}, {}];
        (stops as Obj).add = () => { const s = {}; stops.push(s); return s; };
        return { name: '', type: 'LINEAR', gradientStops: stops };
      },
    },
    ...extra,
  };
  for (const l of layers) l.parent = d;
  return d;
}

/** ハンドラを呼んで executeJsx に渡った JSX と params を取り出し、フェイク DOM 上で実行する */
async function run(tool: string, d: Obj, params: Obj): Promise<Obj> {
  vi.mocked(executeJsx).mockClear();
  vi.mocked(executeJsxHeavy).mockClear();
  let handler: ((p: Obj) => Promise<unknown>) | undefined;
  TOOLS[tool]({ registerTool: (_n: string, _c: unknown, h: typeof handler) => { handler = h; } } as unknown as McpServer);
  await handler!(params);
  const call = vi.mocked(executeJsx).mock.calls[0] ?? vi.mocked(executeJsxHeavy).mock.calls[0];
  return runJsxCode(call[0] as string, { ...GLOBALS, app: { version: '30.0', documents: { length: 1 }, activeDocument: d } }, call[1] as Obj);
}

const UUID_G = '11111111-1111-4111-8111-111111111111';
const STOPS = [
  { color: { type: 'cmyk', c: 0, m: 100, y: 0, k: 0 }, position: 0 },
  { color: { type: 'cmyk', c: 0, m: 0, y: 100, k: 0 }, position: 100 },
];

describe('create_gradient: グループ・複合パスは末端に塗って末端を検証する', () => {
  it('グループ自身ではなく配下のパス・複合パス内部・テキストに適用する', async () => {
    const p1 = path();
    const inner = path();
    const compound = container('CompoundPathItem', [inner]);
    const tf = text(cmyk(0, 0, 0, 100));
    const g = container('GroupItem', [p1, compound, tf], { note: UUID_G });
    const d = doc([layer('L', [g])]);

    const r = await run('create_gradient', d, { name: 'sunset', stops: STOPS, apply_to_uuids: [UUID_G], coordinate_system: 'document' });

    expect(r.success).toBe(true);
    expect(r.appliedCount).toBe(1);
    for (const leaf of [p1, inner]) expect(leaf.fillColor.typename).toBe('GradientColor');
    expect(tf.textRange.characterAttributes.fillColor.typename).toBe('GradientColor');
    expect(g.fillColor).toBeUndefined();
    const v = r.verified[0];
    expect(v.fill).toBeUndefined();
    expect(v.descendantCount).toBe(3);
    expect(v.descendantFills).toEqual([expect.objectContaining({ type: 'gradient', name: 'sunset', count: 3 })]);
  });

  it('末端に塗れなかった・読み返すと変わっていなかったら success: false', async () => {
    const locked = rejectWrites(path({ name: 'locked' }), 'fillColor');
    const stuck = ignoreWrites(path({ name: 'stuck' }), 'fillColor');
    const g = container('GroupItem', [path(), locked, stuck], { note: UUID_G });
    const r = await run('create_gradient', doc([layer('L', [g])]), {
      name: 'g', stops: STOPS, apply_to_uuids: [UUID_G], coordinate_system: 'document',
    });
    expect(r.success).toBe(false);
    expect(r.appliedCount).toBe(0);
    expect(r.errors.join(' ')).toMatch(/failed on 1 of 3/);
    expect(r.errors.join(' ')).toMatch(/1 of 3 objects did not take the gradient/);
  });
});

describe('find_objects: 複合パスの色は内部パスで判定し、複合パスを返す', () => {
  it('黒い内部パスを持つ複合パスを塗り色で見つける', async () => {
    const compound = container('CompoundPathItem', [path(), path()], { name: 'logo' });
    const other = path({ name: 'red', fillColor: cmyk(0, 100, 100, 0) });
    const d = doc([layer('L', [compound, other])]);
    const r = await run('find_objects', d, { fill_color: { type: 'cmyk', c: 0, m: 0, y: 0, k: 100 }, coordinate_system: 'document' });
    expect(r.objects.map((o: Obj) => [o.name, o.type])).toEqual([['logo', 'compound-path']]);
  });

  it('線の色も内部パスで判定する', async () => {
    const compound = container('CompoundPathItem', [path({ stroked: true, strokeColor: cmyk(100, 0, 0, 0) })], { name: 'outlined' });
    const r = await run('find_objects', doc([layer('L', [compound])]), {
      stroke_color: { type: 'cmyk', c: 100, m: 0, y: 0, k: 0 }, coordinate_system: 'document',
    });
    expect(r.count).toBe(1);
  });
});

const RED = { type: 'cmyk', c: 0, m: 100, y: 100, k: 0 };
const GRAY50 = { type: 'cmyk', c: 0, m: 0, y: 0, k: 50 };

describe('replace_color: レイヤー指定はグループ・サブレイヤーまで辿る', () => {
  it('グループ内・サブレイヤー内のパスとテキストも置換する', async () => {
    const inGroup = path({ fillColor: cmyk(0, 100, 100, 0) });
    const tf = text(cmyk(0, 100, 100, 0));
    const inSub = path({ fillColor: cmyk(0, 100, 100, 0) });
    // 実機の Layer.pathItems / textFrames は直下しか含まない
    const target = layer('Target', [container('GroupItem', [inGroup, tf])], [layer('Sub', [inSub])], { pathItems: [], textFrames: [] });
    const r = await run('replace_color', doc([target]), { from_color: RED, to_color: GRAY50, scope: 'Target' });
    expect(r.success).toBe(true);
    expect(r.replacedCount).toBe(2);
    expect(r.textFramesChanged).toBe(1);
    for (const p of [inGroup, inSub]) expect(p.fillColor).toMatchObject({ typename: 'CMYKColor', black: 50 });
    expect(tf.textRange.characterAttributes.fillColor).toMatchObject({ black: 50 });
  });
});

describe('replace_color: 置換の失敗を隠さない', () => {
  it('文字色の書き込みが例外なら失敗として数え、対象を返す', async () => {
    const tf = text(cmyk(0, 100, 100, 0), { name: 'headline' });
    rejectWrites(tf.textRanges[0].characterAttributes, 'fillColor');
    const d = doc([layer('L', [tf])], { pathItems: [], textFrames: [tf] });
    tf.parent = d.layers[0];
    const r = await run('replace_color', d, { from_color: RED, to_color: GRAY50 });
    expect(r.success).toBe(false);
    expect(r.textFramesChanged).toBe(0);
    expect(r.failedCount).toBe(1);
    expect(r.failed[0]).toMatchObject({ type: 'text', name: 'headline', layer: 'L', attribute: 'text_fill' });
  });

  it('読み返して反映されていなければ失敗（verified は読み返した件数）', async () => {
    const ok = path({ fillColor: cmyk(0, 100, 100, 0) });
    const stuck = ignoreWrites(path({ name: 'stuck', fillColor: cmyk(0, 100, 100, 0) }), 'fillColor');
    const d = doc([layer('L', [ok, stuck])], { pathItems: [ok, stuck], textFrames: [] });
    const r = await run('replace_color', d, { from_color: RED, to_color: GRAY50 });
    expect(r.success).toBe(false);
    expect(r.verified.replacedCount).toBe(1);
    expect(r.failed[0]).toMatchObject({ name: 'stuck', attribute: 'fill' });
  });
});

describe('convert_to_outlines: レイヤー指定はグループ・サブレイヤーまで辿る', () => {
  it('グループ内・サブレイヤー内のテキストも変換する（変換で構造が変わっても取りこぼさない）', async () => {
    const outline = function (this: Obj) {
      const siblings = this.parent.pageItems as Obj[];
      siblings.splice(siblings.indexOf(this), 1, { typename: 'GroupItem', pageItems: [], parent: this.parent });
    };
    const t1 = text(cmyk(0, 0, 0, 100), { createOutline: vi.fn(outline) });
    const t2 = text(cmyk(0, 0, 0, 100), { createOutline: vi.fn(outline) });
    const t3 = text(cmyk(0, 0, 0, 100), { createOutline: vi.fn(outline) });
    const g = container('GroupItem', [t1, t2]);
    const target = layer('Copy', [g], [layer('Sub', [t3])], { textFrames: [] });
    const r = await run('convert_to_outlines', doc([target]), { target: 'Copy' });
    expect(r.success).toBe(true);
    expect(r.convertedCount).toBe(3);
    for (const t of [t1, t2, t3]) expect(t.createOutline).toHaveBeenCalledTimes(1);
  });
});
