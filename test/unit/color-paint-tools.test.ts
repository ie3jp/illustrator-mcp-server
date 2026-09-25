/**
 * modify_object（グループへの塗り/線・段落設定）・get_colors・select_objects の JSX をフェイク DOM 上で検証する。
 * フェイクは GroupItem への fill 代入が素通りして偽成功する実機の構図を再現する。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn().mockResolvedValue({}),
  executeJsxHeavy: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return { ...actual, resolveCoordinateSystem: vi.fn().mockResolvedValue('document') };
});

import { executeJsx } from '../../src/executor/jsx-runner.js';
import { register as registerModifyObject } from '../../src/tools/modify/modify-object.js';
import { register as registerReplaceColor } from '../../src/tools/modify/replace-color.js';
import { register as registerManageSwatches } from '../../src/tools/modify/manage-swatches.js';
import { register as registerSelectObjects } from '../../src/tools/modify/select-objects.js';
import { register as registerGetColors } from '../../src/tools/read/get-colors.js';
import { captureInputSchema } from './helpers/tool-schema.js';

type Handler = (params: Record<string, unknown>) => Promise<unknown>;
type Result = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const commonJsx = fs.readFileSync(path.resolve(__dirname, '../../src/jsx/helpers/common.jsx'), 'utf-8');
const mockExecuteJsx = vi.mocked(executeJsx);

function captureHandler(register: (server: McpServer) => void): Handler {
  let handler: Handler | undefined;
  const server = {
    registerTool: vi.fn((_n: string, _c: unknown, h: Handler) => {
      handler = h;
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('not registered');
  return handler;
}

/** ツールハンドラを呼んで executeJsx に渡された JSX を取り出し、フェイク DOM 上で実行する */
async function runTool(
  register: (server: McpServer) => void,
  params: Record<string, unknown>,
  env: { doc?: unknown; findItem?: (uuid: string) => unknown; textFonts?: unknown },
): Promise<Result> {
  mockExecuteJsx.mockClear();
  await captureHandler(register)(params);
  const toolJsx = mockExecuteJsx.mock.calls[0][0] as string;
  const sentParams = mockExecuteJsx.mock.calls[0][1];
  const code = `
    var TextType = { POINTTEXT: 1, AREATEXT: 2, PATHTEXT: 3 };
    var Justification = { LEFT: "J_LEFT", CENTER: "J_CENTER", RIGHT: "J_RIGHT" };
    var DocumentColorSpace = { CMYK: "DCS_CMYK", RGB: "DCS_RGB" };
    function CMYKColor() { this.typename = "CMYKColor"; }
    function RGBColor() { this.typename = "RGBColor"; }
    function GrayColor() { this.typename = "GrayColor"; }
    function NoColor() { this.typename = "NoColor"; }
    var app = { version: "30.0", documents: { length: 1 } };
    var __written = null;
    function File(p) {
      this.open = function() { return true; };
      this.write = function(c) { __written = c; };
      this.close = function() {};
    }
    ${commonJsx}
    var PARAMS_PATH = "params.json";
    var RESULT_PATH = "result.json";
    readParamsFile = function() { return __params; };
    if (__env.findItem) { findItemByUUID = __env.findItem; }
    app.activeDocument = __env.doc || {};
    if (__env.textFonts) { app.textFonts = __env.textFonts; }
    ${toolJsx}
    return jsonParse(__written);
  `;
  // eslint-disable-next-line no-new-func -- test-only: evaluating ES3 ExtendScript in Node (same pattern as common-helpers.test.ts)
  return new Function('__env', '__params', code)(env, sentParams) as Result; // NOSONAR
}

function cmyk(c: number, m: number, y: number, k: number) {
  return { typename: 'CMYKColor', cyan: c, magenta: m, yellow: y, black: k };
}
function rgb(r: number, g: number, b: number) {
  return { typename: 'RGBColor', red: r, green: g, blue: b };
}

const layer = { typename: 'Layer', name: 'Layer 1', visible: true, parent: { typename: 'Document' } };

function makePath(fill: unknown, extra: Record<string, unknown> = {}) {
  return {
    typename: 'PathItem',
    name: '',
    note: '',
    filled: !!fill,
    fillColor: fill,
    stroked: false,
    strokeColor: undefined as unknown,
    strokeWidth: 1,
    guides: false,
    clipping: false,
    hidden: false,
    parent: layer,
    geometricBounds: [0, 10, 10, 0],
    ...extra,
  };
}

function makeText(fill: unknown) {
  const ca: Record<string, unknown> = { fillColor: fill, strokeWeight: 0, size: 12, tracking: 0, autoLeading: true, leading: 14.4 };
  const range = { characterAttributes: ca, paragraphAttributes: { justification: 'J_LEFT' } };
  return {
    typename: 'TextFrame',
    name: '',
    note: '',
    contents: 'SYNC',
    kind: 1,
    hidden: false,
    parent: layer,
    geometricBounds: [0, 10, 10, 0],
    textRange: range,
    textRanges: [range],
    characters: [range],
  };
}

function makeGroup(children: unknown[], typename = 'GroupItem') {
  const g: Record<string, unknown> = {
    typename,
    name: 'poster-bg',
    note: '',
    hidden: false,
    parent: layer,
    geometricBounds: [0, 10, 10, 0],
  };
  if (typename === 'CompoundPathItem') g.pathItems = children;
  else g.pageItems = children;
  return g;
}

const CMYK_RED = { type: 'cmyk', c: 0, m: 100, y: 100, k: 0 };

beforeEach(() => {
  mockExecuteJsx.mockClear();
});

describe('modify_object fill/stroke on containers', () => {
  it('paints every descendant path/text of a group instead of the group itself', async () => {
    const p1 = makePath(rgb(10, 20, 30));
    const p2 = makePath(rgb(10, 20, 30));
    const inner = makePath(rgb(1, 2, 3));
    const compound = makeGroup([inner], 'CompoundPathItem');
    const text = makeText(rgb(0, 0, 0));
    const nested = makeGroup([p2, compound, text]);
    const clip = makePath(null, { clipping: true });
    const placed = { typename: 'PlacedItem', parent: layer };
    const group = makeGroup([clip, p1, nested, placed]);

    const r = await runTool(
      registerModifyObject,
      { uuid: 'g', properties: { fill: CMYK_RED }, coordinate_system: 'document' },
      { findItem: () => group },
    );

    expect(r.success).toBe(true);
    expect(r.painted.fill).toEqual({ targets: 4, changed: 4 });
    for (const p of [p1, p2, inner]) {
      expect(p.fillColor).toMatchObject({ typename: 'CMYKColor', cyan: 0, magenta: 100, yellow: 100, black: 0 });
      expect(p.filled).toBe(true);
    }
    expect(text.textRange.characterAttributes.fillColor).toMatchObject({ typename: 'CMYKColor', magenta: 100 });
    // クリッピングパスは塗らない・グループ自身にも代入しない
    expect(clip.filled).toBe(false);
    expect(group.fillColor).toBeUndefined();
    // 検証値はグループ自身の（存在しない）fill ではなく子の実際の色
    expect(r.verified.fill).toBeUndefined();
    expect(r.verified.descendantCount).toBe(4);
    expect(r.verified.descendantFills).toEqual([{ type: 'cmyk', c: 0, m: 100, y: 100, k: 0, count: 4 }]);
    expect(r.warnings.join(' ')).toMatch(/skipped 1 clipping path, 1 PlacedItem/);
  });

  it('reports failure when a descendant silently ignores the new color', async () => {
    const ok = makePath(rgb(10, 20, 30));
    const stuck = makePath(rgb(10, 20, 30));
    Object.defineProperty(stuck, 'fillColor', { get: () => rgb(10, 20, 30), set: () => {} });
    const group = makeGroup([ok, stuck]);

    const r = await runTool(
      registerModifyObject,
      { uuid: 'g', properties: { fill: CMYK_RED }, coordinate_system: 'document' },
      { findItem: () => group },
    );

    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/fill: 1 of 2 objects did not take the requested value/);
    expect(r.painted.fill.changed).toBe(1);
    expect(r.verified.descendantFills).toHaveLength(2);
  });

  it('reports failure when painting a descendant throws (e.g. locked)', async () => {
    const locked = makePath(rgb(10, 20, 30));
    Object.defineProperty(locked, 'fillColor', {
      get: () => rgb(10, 20, 30),
      set: () => {
        throw new Error('Target layer cannot be modified');
      },
    });
    const r = await runTool(
      registerModifyObject,
      { uuid: 'g', properties: { fill: CMYK_RED }, coordinate_system: 'document' },
      { findItem: () => makeGroup([locked]) },
    );
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/fill: failed on 1 of 1 objects \(e\.g\. Target layer cannot be modified\)/);
  });

  it('applies stroke recursively to group descendants', async () => {
    const p1 = makePath(null);
    const group = makeGroup([p1, makeGroup([makePath(null)])]);
    const r = await runTool(
      registerModifyObject,
      { uuid: 'g', properties: { stroke: { color: CMYK_RED, width: 2 } }, coordinate_system: 'document' },
      { findItem: () => group },
    );
    expect(r.success).toBe(true);
    expect(r.painted.stroke).toEqual({ targets: 2, changed: 2 });
    expect(p1.stroked).toBe(true);
    expect(p1.strokeWidth).toBe(2);
    expect(r.verified.descendantStrokes).toEqual([{ type: 'cmyk', c: 0, m: 100, y: 100, k: 0, count: 2 }]);
  });

  it('fails instead of faking success when the object cannot take a fill', async () => {
    const placed = { typename: 'PlacedItem', name: '', parent: layer, geometricBounds: [0, 10, 10, 0] };
    const r = await runTool(
      registerModifyObject,
      { uuid: 'p', properties: { fill: CMYK_RED }, coordinate_system: 'document' },
      { findItem: () => placed },
    );
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/no path or text object to paint/);
    expect((placed as Record<string, unknown>).fillColor).toBeUndefined();
  });

  it('paints a text frame via its character attributes', async () => {
    const text = makeText(rgb(0, 0, 0));
    const r = await runTool(
      registerModifyObject,
      { uuid: 't', properties: { fill: CMYK_RED }, coordinate_system: 'document' },
      { findItem: () => text },
    );
    expect(r.success).toBe(true);
    expect(text.textRange.characterAttributes.fillColor).toMatchObject({ typename: 'CMYKColor', magenta: 100 });
    expect(r.verified.fill).toEqual({ type: 'cmyk', c: 0, m: 100, y: 100, k: 0 });
  });
});

describe('modify_object paragraph controls', () => {
  it('sets justification and fixed leading and reports them read back', async () => {
    const text = makeText(rgb(0, 0, 0));
    const r = await runTool(
      registerModifyObject,
      { uuid: 't', properties: { justification: 'center', leading: 24 }, coordinate_system: 'document' },
      { findItem: () => text },
    );
    expect(r.success).toBe(true);
    expect(text.textRange.paragraphAttributes.justification).toBe('J_CENTER');
    expect(text.textRange.characterAttributes.autoLeading).toBe(false);
    expect(text.textRange.characterAttributes.leading).toBe(24);
    expect(r.verified).toMatchObject({ justification: 'center', autoLeading: false, leading: 24 });
  });

  it('switches back to auto leading', async () => {
    const text = makeText(rgb(0, 0, 0));
    text.textRange.characterAttributes.autoLeading = false;
    const r = await runTool(
      registerModifyObject,
      { uuid: 't', properties: { leading: 'auto' }, coordinate_system: 'document' },
      { findItem: () => text },
    );
    expect(r.success).toBe(true);
    expect(text.textRange.characterAttributes.autoLeading).toBe(true);
  });

  it('validates justification and leading in the schema', () => {
    const schema = captureInputSchema(registerModifyObject);
    const ok = (properties: Record<string, unknown>) => schema.safeParse({ uuid: 'u', properties }).success;
    expect(ok({ justification: 'right', leading: 18 })).toBe(true);
    expect(ok({ leading: 'auto' })).toBe(true);
    expect(ok({ justification: 'justify' })).toBe(false);
    expect(ok({ leading: 0 })).toBe(false);
    expect(ok({ leading: 'tight' })).toBe(false);
  });
});

describe('modify_object font_name (exact name only)', () => {
  const fonts = Object.assign([{ name: 'HelveticaNeue-Bold', family: 'Helvetica Neue' }], {
    getByName(n: string) {
      const f = this.find((x: { name: string }) => x.name === n);
      if (!f) throw new Error('No such element');
      return f;
    },
  });

  it('modifies nothing and returns font_candidates when the font is not an exact name', async () => {
    const text = makeText(rgb(0, 0, 0));
    const r = await runTool(
      registerModifyObject,
      { uuid: 't', properties: { font_name: 'Helvetica', font_size: 30 }, coordinate_system: 'document' },
      { findItem: () => text, textFonts: fonts },
    );
    expect(r.error).toBe(true);
    expect(r.message).toContain('Nothing was modified');
    expect(r.font_candidates).toEqual([{ name: 'HelveticaNeue-Bold', family: 'Helvetica Neue' }]);
    expect(text.textRange.characterAttributes.size).toBe(12);
  });

  it('applies an exact font name', async () => {
    const text = makeText(rgb(0, 0, 0));
    const r = await runTool(
      registerModifyObject,
      { uuid: 't', properties: { font_name: 'HelveticaNeue-Bold' }, coordinate_system: 'document' },
      { findItem: () => text, textFonts: fonts },
    );
    expect(r.success).toBe(true);
    expect((text.textRange.characterAttributes.textFont as { name: string }).name).toBe('HelveticaNeue-Bold');
  });
});

describe('color-mode mismatch warnings on modify tools', () => {
  it('modify_object warns when an RGB fill is given in a CMYK document', async () => {
    const p = makePath(cmyk(0, 0, 0, 100));
    const r = await runTool(
      registerModifyObject,
      { uuid: 'p', properties: { fill: { type: 'rgb', r: 0, g: 0, b: 0 } }, coordinate_system: 'document' },
      { findItem: () => p, doc: { documentColorSpace: 'DCS_CMYK' } },
    );
    const w = (r.warnings as string[]).find((x) => x.includes('Color mode mismatch'));
    expect(w).toContain('rgb(0,0,0)');
    expect(w).toContain('verified.fill');
  });

  it('manage_swatches warns on add in a mismatched document', async () => {
    const doc = {
      documentColorSpace: 'DCS_CMYK',
      swatches: Object.assign([] as unknown[], {
        add() {
          const sw = { name: '', color: null };
          (this as unknown[]).push(sw);
          return sw;
        },
      }),
    };
    const r = await runTool(
      registerManageSwatches,
      { action: 'add', name: 'Brand', color: { type: 'rgb', r: 255, g: 0, b: 0 } },
      { doc },
    );
    expect(r.success).toBe(true);
    expect(r.warnings[0]).toContain('rgb(255,0,0)');
    expect(r.warnings[0]).not.toContain('verified.fill');
  });
});

describe('replace_color', () => {
  function textWithRanges(fills: unknown[], strokes: Array<{ color: unknown; weight: number }> = []) {
    const ranges = fills.map((f, i) => ({
      characterAttributes: {
        fillColor: f,
        strokeColor: strokes[i]?.color ?? { typename: 'NoColor' },
        strokeWeight: strokes[i]?.weight ?? 0,
      },
    }));
    return { typename: 'TextFrame', textRanges: ranges };
  }

  it('replaces matching character colors in text, range by range, and counts frames', async () => {
    const tf = textWithRanges([cmyk(0, 100, 100, 0), cmyk(0, 0, 0, 100)]);
    const untouched = textWithRanges([cmyk(0, 0, 0, 100)]);
    const path = makePath(cmyk(0, 100, 100, 0));
    const doc = { documentColorSpace: 'DCS_CMYK', pathItems: [path], textFrames: [tf, untouched] };
    const r = await runTool(
      registerReplaceColor,
      { from_color: CMYK_RED, to_color: { type: 'cmyk', c: 0, m: 0, y: 0, k: 50 } },
      { doc },
    );
    expect(r.success).toBe(true);
    expect(r.replacedCount).toBe(1);
    expect(r.textFramesChanged).toBe(1);
    expect(tf.textRanges[0].characterAttributes.fillColor).toMatchObject({ typename: 'CMYKColor', black: 50 });
    expect(tf.textRanges[1].characterAttributes.fillColor).toMatchObject({ black: 100 });
    expect(r.warnings).toBeUndefined();
  });

  it('survives ranges merging as colors change (textRanges is a live collection)', async () => {
    // 実機では色を変えた範囲が同色の隣と結合し、前から回すと存在しない範囲に触れて MRAP になる
    const ranges: Array<{ characterAttributes: Record<string, unknown> }> = [];
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    // 結合で消えた範囲のオブジェクトに触ると例外（実機の MRAP 相当）
    const dead = new Set<unknown>();
    const kill = (i: number) => dead.add(ranges.splice(i, 1)[0].characterAttributes);
    const makeRange = (fill: unknown) => {
      const attrs: Record<string, unknown> = { strokeColor: { typename: 'NoColor' }, strokeWeight: 0 };
      let value = fill;
      Object.defineProperty(attrs, 'fillColor', {
        get: () => {
          if (dead.has(attrs)) throw new Error("an Illustrator error occurred: 1346458189 ('MRAP')");
          return value;
        },
        set: (v) => {
          value = v;
          const i = ranges.findIndex((r) => r.characterAttributes === attrs);
          if (ranges[i + 1] && same(ranges[i + 1].characterAttributes.fillColor, v)) kill(i + 1);
          if (i > 0 && same(ranges[i - 1].characterAttributes.fillColor, v)) kill(i);
        },
      });
      return { characterAttributes: attrs };
    };
    // 赤・黒・赤 → 黒 50% にすると 3 範囲が段階的に結合する
    ranges.push(makeRange(cmyk(0, 100, 100, 0)), makeRange(cmyk(0, 0, 0, 50)), makeRange(cmyk(0, 100, 100, 0)));
    const tf = { typename: 'TextFrame', textRanges: ranges };
    const doc = { documentColorSpace: 'DCS_CMYK', pathItems: [], textFrames: [tf] };
    const r = await runTool(
      registerReplaceColor,
      { from_color: CMYK_RED, to_color: { type: 'cmyk', c: 0, m: 0, y: 0, k: 50 } },
      { doc },
    );
    expect(r.success).toBe(true);
    expect(r.textFramesChanged).toBe(1);
    expect(ranges).toHaveLength(1);
  });

  it('ignores text strokes with zero weight and respects target', async () => {
    const tf = textWithRanges(
      [cmyk(0, 100, 100, 0), cmyk(0, 0, 0, 100)],
      [{ color: cmyk(0, 100, 100, 0), weight: 0 }, { color: cmyk(0, 100, 100, 0), weight: 1 }],
    );
    const doc = { documentColorSpace: 'DCS_CMYK', pathItems: [], textFrames: [tf] };
    const r = await runTool(
      registerReplaceColor,
      { from_color: CMYK_RED, to_color: { type: 'cmyk', c: 0, m: 0, y: 0, k: 50 }, target: 'stroke' },
      { doc },
    );
    expect(r.textFramesChanged).toBe(1);
    expect(tf.textRanges[0].characterAttributes.fillColor).toMatchObject({ magenta: 100 });
    expect(tf.textRanges[0].characterAttributes.strokeColor).toMatchObject({ magenta: 100 });
    expect(tf.textRanges[1].characterAttributes.strokeColor).toMatchObject({ black: 50 });
  });

  it('warns when to_color does not match the document color mode', async () => {
    const doc = { documentColorSpace: 'DCS_CMYK', pathItems: [makePath(cmyk(0, 100, 100, 0))], textFrames: [] };
    const r = await runTool(
      registerReplaceColor,
      { from_color: CMYK_RED, to_color: { type: 'rgb', r: 0, g: 0, b: 0 } },
      { doc },
    );
    expect(r.replacedCount).toBe(1);
    expect(r.warnings[0]).toContain('rgb(0,0,0)');
  });
});

describe('get_colors used colors', () => {
  it('deduplicates used colors and counts usages', async () => {
    const pathItems = [
      makePath(rgb(10, 20, 30)),
      makePath(rgb(10, 20, 30)),
      makePath(rgb(10, 20, 30)),
      makePath(cmyk(0, 0, 0, 100)),
    ];
    const doc = {
      documentColorSpace: 'DCS_CMYK',
      swatches: [],
      gradients: [],
      patterns: [],
      spots: [],
      pathItems,
      textFrames: [makeText(cmyk(0, 0, 0, 100))],
      meshItems: [],
    };
    const r = await runTool(registerGetColors, { include_swatches: false }, { doc });
    expect(r.usedFillColors).toEqual([
      { type: 'rgb', r: 10, g: 20, b: 30, count: 3 },
      { type: 'cmyk', c: 0, m: 0, y: 0, k: 100, count: 2 },
    ]);
    expect(r.usedStrokeColors).toEqual([]);
  });
});

describe('select_objects', () => {
  it('returns the UUID, not the raw note with memo/meta', async () => {
    const uuid = '12345678-1234-4234-8234-123456789abc';
    const item = makePath(null, { note: uuid + ' logo mark::ai-mcp:rot=15', name: 'logo' });
    const doc: Record<string, unknown> = { selection: [] };
    const r = await runTool(registerSelectObjects, { uuids: [uuid] }, { doc, findItem: () => item });
    expect(r.verified.selection).toEqual([{ uuid, name: 'logo', type: 'path' }]);
  });
});
