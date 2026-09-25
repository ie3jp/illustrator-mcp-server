/**
 * 読み取り系ツール（修正計画 T9）の JSX ロジックを偽の Illustrator オブジェクトで検証する。
 * 実機の API 挙動そのもの（TextRange の parent 等）は検証できないため、ここでは
 * 「一次資料どおりのオブジェクトが来たときに正しく扱えるか」を確認する。
 */
import { describe, it, expect } from 'vitest';
import { loadToolJsx, runToolJsx, fakeDoc, fakeItem, fakeLayer } from './helpers/read-tool-jsx.js';

const UUID_A = '11111111-2222-4333-8444-555555555555';
const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function textFrame(bounds: number[], extra: Record<string, unknown> = {}): any {
  return fakeItem('TextFrame', bounds, {
    kind: 'POINTTEXT',
    contents: 'Hello',
    orientation: 'HORIZONTAL',
    textRanges: [
      {
        characterAttributes: { textFont: { family: 'Helvetica', style: 'Regular' }, size: 12 },
        paragraphStyles: [{ name: 'Body' }],
        characterStyles: [{ name: 'Emphasis' }],
      },
    ],
    ...extra,
  });
}

// ─── 1. get_selection ───────────────────────────────────────────────

describe('get_selection: text editing selection (TextRange)', () => {
  const jsx = loadToolJsx('read/get-selection.ts');

  it('returns the containing text frame when characters are selected (selection is a TextRange)', () => {
    const tf = textFrame([10, -10, 110, -40], { note: UUID_A + ' user memo' });
    const range = { typename: 'TextRange', contents: 'ell', length: 3, start: 1, parent: tf };
    const result = runToolJsx(jsx, fakeDoc({ selection: range }), { coordinate_system: 'artboard-web' });
    expect(result.error).toBeUndefined();
    expect(result.selectionCount).toBe(1);
    const item = result.items[0];
    expect(item.uuid).toBe(UUID_A); // メモ付き note からも UUID だけを取り出す
    expect(item.type).toBe('text');
    expect(item.contents).toBe('Hello');
    expect(item.bounds).toMatchObject({ x: 10, y: 10, width: 100, height: 30 });
    expect(item.textSelection).toEqual({ contents: 'ell', length: 3, start: 1, insertionPoint: false });
    expect(tf.note).toBe(UUID_A + ' user memo'); // note を壊さない
  });

  it('reports a bare text cursor (zero-length TextRange) as insertionPoint', () => {
    const tf = textFrame([10, -10, 110, -40], { note: UUID_A });
    const caret = { typename: 'TextRange', contents: '', length: 0, start: 2, parent: tf };
    const result = runToolJsx(jsx, fakeDoc({ selection: caret }), { coordinate_system: 'artboard-web' });
    expect(result.selectionCount).toBe(1);
    expect(result.items[0].uuid).toBe(UUID_A);
    expect(result.items[0].textSelection.insertionPoint).toBe(true);
  });

  it('falls back to story.textFrames when parent does not lead to the frame (threaded story)', () => {
    const tf1 = textFrame([0, 0, 100, -100], { note: UUID_A, textRange: { start: 0, end: 10 } });
    const tf2 = textFrame([200, 0, 300, -100], { note: UUID_B, textRange: { start: 11, end: 20 } });
    const range = {
      typename: 'TextRange', contents: 'x', length: 1, start: 15,
      parent: { typename: 'Story' },
      story: { textFrames: [tf1, tf2] },
    };
    const result = runToolJsx(jsx, fakeDoc({ selection: range }), { coordinate_system: 'artboard-web' });
    expect(result.items[0].uuid).toBe(UUID_B);
  });

  it('handles a TextRange inside a selection array alongside regular items', () => {
    const tf = textFrame([10, -10, 110, -40], { note: UUID_A });
    const rect = fakeItem('PathItem', [0, 0, 50, -50], { note: UUID_B, filled: false, stroked: false, closed: true });
    const range = { typename: 'TextRange', contents: 'H', length: 1, start: 0, parent: tf };
    const result = runToolJsx(jsx, fakeDoc({ selection: [rect, range] }), { coordinate_system: 'artboard-web' });
    expect(result.selectionCount).toBe(2);
    expect(result.items.map((i: any) => i.uuid)).toEqual([UUID_B, UUID_A]);
  });

  it('does not fail the whole selection when one item has no bounds', () => {
    const odd = { typename: 'PluginItem', note: UUID_A, name: 'odd' }; // geometricBounds なし
    const rect = fakeItem('PathItem', [0, 0, 50, -50], { note: UUID_B, filled: false, stroked: false });
    const result = runToolJsx(jsx, fakeDoc({ selection: [odd, rect] }), { coordinate_system: 'artboard-web' });
    expect(result.error).toBeUndefined();
    expect(result.selectionCount).toBe(2);
    expect(result.items[0].uuid).toBe(UUID_A);
    expect(result.items[0].bounds).toBeNull();
    expect(result.items[1].uuid).toBe(UUID_B);
  });
});

// ─── 2〜4. get_text_frame_detail ───────────────────────────────────

function detailFrame(extra: Record<string, unknown> = {}): any {
  const spot = (name: string) => ({
    typename: 'SpotColor', tint: 100,
    spot: { name, color: { typename: 'CMYKColor', cyan: 0, magenta: 100, yellow: 0, black: 0 } },
  });
  const charAttrs = (color: unknown) => ({
    textFont: { family: 'Hiragino', style: 'W3' }, size: 10, fillColor: color, tracking: 0,
    kerningMethod: 'AUTO', proportionalMetrics: false, akiLeft: -1, akiRight: -1, Tsume: 0,
    baselineShift: 0, horizontalScale: 100, verticalScale: 100, rotation: 0,
  });
  return fakeItem('TextFrame', [0, 0, 100, -20], {
    note: UUID_A,
    kind: 'AREATEXT',
    contents: 'AB',
    orientation: 'VERTICAL',
    nextFrame: fakeItem('TextFrame', [0, -30, 100, -50], { note: UUID_B }),
    previousFrame: null,
    paragraphs: [
      {
        contents: 'AB',
        // ParagraphAttributes には leading / autoLeading / paragraphStyle が無い（公式リファレンス）
        paragraphAttributes: { autoLeadingAmount: 175, justification: 'LEFT' },
        characterAttributes: { leading: 18, autoLeading: false },
        paragraphStyles: [{ name: 'Body' }],
      },
    ],
    characters: [
      { contents: 'A', characterAttributes: charAttrs(spot('DIC 1')) },
      { contents: 'B', characterAttributes: charAttrs(spot('DIC 2')) },
    ],
    ...extra,
  });
}

describe('get_text_frame_detail JSX', () => {
  const jsx = loadToolJsx('read/get-text-frame-detail.ts');

  it('reads leading/autoLeading from CharacterAttributes and the paragraph style from TextRange.paragraphStyles', () => {
    const tf = detailFrame();
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [tf] }), { uuid: UUID_A, coordinate_system: 'artboard-web' });
    expect(result.error).toBeUndefined();
    const para = result.paragraphAttributes[0];
    expect(para.leading).toBe(18);
    expect(para.autoLeading).toBe(false);
    expect(para.autoLeadingAmount).toBe(175);
    expect(para.paragraphStyle).toBe('Body');
  });

  it('does not merge characters with different spot colors into one run', () => {
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [detailFrame()] }), { uuid: UUID_A, coordinate_system: 'artboard-web' });
    expect(result.characterRuns).toHaveLength(2);
    expect(result.characterRuns[0].color.name).toBe('DIC 1');
    expect(result.characterRuns[1].color.name).toBe('DIC 2');
  });

  it('returns orientation and threaded-frame links', () => {
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [detailFrame()] }), { uuid: UUID_A, coordinate_system: 'artboard-web' });
    expect(result.orientation).toBe('vertical');
    expect(result.nextFrameUUID).toBe(UUID_B);
    expect(result.previousFrameUUID).toBeNull();
  });
});

// ─── 2, 4, 7. list_text_frames ─────────────────────────────────────

describe('list_text_frames JSX', () => {
  const jsx = loadToolJsx('read/list-text-frames.ts');

  it('reads style names from TextRange.paragraphStyles / characterStyles and returns orientation', () => {
    const tf = textFrame([10, -10, 110, -40], { note: UUID_A });
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [tf] }), { coordinate_system: 'artboard-web' });
    const f = result.textFrames[0];
    expect(f.paragraphStyle).toBe('Body');
    expect(f.characterStyle).toBe('Emphasis');
    expect(f.orientation).toBe('horizontal');
    expect(f.nextFrameUUID).toBeNull();
  });

  it('reading-order reads vertical columns right to left, then top to bottom', () => {
    const v = (id: string, l: number, t: number) =>
      textFrame([l, t, l + 20, t - 200], { note: id, contents: id.substring(0, 1), orientation: 'VERTICAL' });
    const right = v('r0000000-0000-4000-8000-000000000000', 400, -10);
    const middle = v('m0000000-0000-4000-8000-000000000000', 300, -10);
    const middleLower = v('n0000000-0000-4000-8000-000000000000', 300, -250);
    const left = v('l0000000-0000-4000-8000-000000000000', 100, -10);
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [left, middleLower, right, middle] }), {
      coordinate_system: 'artboard-web', sort: 'reading-order', contents_only: true,
    });
    expect(result.textFrames.map((f: any) => f.contents)).toEqual(['r', 'm', 'n', 'l']);
    // ソート用の内部キーは結果に残さない
    expect(Object.keys(result.textFrames[0]).sort()).toEqual(['artboardIndex', 'contents', 'uuid']);
  });

  it('reading-order keeps horizontal ordering (rows top to bottom, then left to right)', () => {
    const h = (c: string, l: number, t: number) => textFrame([l, t, l + 50, t - 20], { contents: c });
    const result = runToolJsx(jsx, fakeDoc({ textFrames: [h('d', 10, -100), h('b', 200, -10), h('a', 10, -12)] }), {
      coordinate_system: 'artboard-web', sort: 'reading-order',
    });
    expect(result.textFrames.map((f: any) => f.contents)).toEqual(['a', 'b', 'd']);
    expect(result.textFrames[0]._sortX).toBeUndefined();
  });

  it('layer_name includes text frames inside groups and sublayers', () => {
    const top = textFrame([0, 0, 10, -10], { contents: 'top' });
    const inGroup = textFrame([0, 0, 10, -10], { contents: 'grouped' });
    const inSub = textFrame([0, 0, 10, -10], { contents: 'sub' });
    const group = fakeItem('GroupItem', [0, 0, 10, -10], { pageItems: [inGroup] });
    const layer = fakeLayer('Text', [top, group], {
      textFrames: [top], // Layer.textFrames はグループ内を含まない
      layers: [fakeLayer('Sub', [inSub])],
    });
    const result = runToolJsx(jsx, fakeDoc({ layers: [layer] }), { layer_name: 'Text', contents_only: true });
    expect(result.textFrames.map((f: any) => f.contents).sort()).toEqual(['grouped', 'sub', 'top']);
  });
});

// ─── 5, 6. get_images ──────────────────────────────────────────────

function raster(matrix: Record<string, number>, bounds: number[], extra: Record<string, unknown> = {}): any {
  return fakeItem('RasterItem', bounds, { embedded: true, imageColorSpace: 'RGB', matrix, ...extra });
}

describe('get_images JSX', () => {
  const jsx = loadToolJsx('read/get-images.ts');
  const doc = (extra: Record<string, unknown>) =>
    fakeDoc({ documentColorSpace: 'CMYK', placedItems: [], rasterItems: [], ...extra });

  it('computes pixel size of a rotated embedded raster from the unrotated size, not the bounding box', () => {
    // 1000x500px・300ppi（1px = 0.24pt）を 90° 回転 → 外接矩形は 120pt x 240pt
    const s = 72 / 300;
    const r = raster({ mValueA: 0, mValueB: s, mValueC: -s, mValueD: 0 }, [0, 0, 120, -240]);
    const result = runToolJsx(jsx, doc({ rasterItems: [r] }), { coordinate_system: 'artboard-web' });
    const img = result.images[0];
    expect(img.pixelWidth).toBe(1000);
    expect(img.pixelHeight).toBe(500);
    expect(img.resolution).toBe(300);
  });

  it('computes pixel size of a 30° rotated raster', () => {
    const s = 72 / 300;
    const rad = (30 * Math.PI) / 180;
    const a = s * Math.cos(rad), b = s * Math.sin(rad), c = -s * Math.sin(rad), d = s * Math.cos(rad);
    const w = 1000 * Math.abs(a) + 500 * Math.abs(c);
    const h = 1000 * Math.abs(b) + 500 * Math.abs(d);
    const r = raster({ mValueA: a, mValueB: b, mValueC: c, mValueD: d }, [0, 0, w, -h]);
    const img = runToolJsx(jsx, doc({ rasterItems: [r] }), { coordinate_system: 'artboard-web' }).images[0];
    expect(img.pixelWidth).toBe(1000);
    expect(img.pixelHeight).toBe(500);
  });

  it('does not report the misleading scaleFactor; reports per-axis resolution instead', () => {
    // 300ppi 画像を 100% 配置（旧実装は scaleFactor: 24 と誤表示していた）
    const s = 72 / 300;
    const r = raster({ mValueA: s, mValueB: 0, mValueC: 0, mValueD: -s }, [0, 0, 240, -120]);
    const img = runToolJsx(jsx, doc({ rasterItems: [r] }), {
      coordinate_system: 'artboard-web', include_print_info: true,
    }).images[0];
    expect(img.scaleFactor).toBeUndefined();
    expect(img.resolutionH).toBe(300);
    expect(img.resolutionV).toBe(300);
    expect(img.colorSpaceMismatch).toBe(true);
  });

  it('flags a linked PlacedItem whose file no longer exists as linkBroken (keeping its path)', () => {
    const p = fakeItem('PlacedItem', [0, 0, 100, -100], {
      file: { fsName: '/missing/photo.jpg', exists: false },
      matrix: { mValueA: 1, mValueB: 0, mValueC: 0, mValueD: 1 },
    });
    const img = runToolJsx(jsx, doc({ placedItems: [p] }), { coordinate_system: 'artboard-web' }).images[0];
    expect(img.linkBroken).toBe(true);
    expect(img.filePath).toBe('/missing/photo.jpg');
  });

  it('keeps linkBroken false for an existing linked file', () => {
    const p = fakeItem('PlacedItem', [0, 0, 100, -100], { file: { fsName: '/ok/photo.jpg', exists: true } });
    const img = runToolJsx(jsx, doc({ placedItems: [p] }), { coordinate_system: 'artboard-web' }).images[0];
    expect(img.linkBroken).toBe(false);
    expect(img.filePath).toBe('/ok/photo.jpg');
  });

  it('checks the file of a non-embedded RasterItem', () => {
    const s = 1;
    const broken = raster({ mValueA: s, mValueB: 0, mValueC: 0, mValueD: -s }, [0, 0, 10, -10], {
      embedded: false, file: { fsName: '/gone.tif', exists: false },
    });
    const img = runToolJsx(jsx, doc({ rasterItems: [broken] }), { coordinate_system: 'artboard-web' }).images[0];
    expect(img.type).toBe('linked');
    expect(img.filePath).toBe('/gone.tif');
    expect(img.linkBroken).toBe(true);
  });
});

// ─── 7. get_path_items / get_guidelines / get_groups ───────────────

function path(bounds: number[], extra: Record<string, unknown> = {}): any {
  return fakeItem('PathItem', bounds, { filled: false, stroked: false, closed: true, guides: false, clipping: false, ...extra });
}

describe('get_path_items JSX', () => {
  const jsx = loadToolJsx('read/get-path-items.ts');

  it('layer_name includes paths inside groups, compound paths and sublayers, and marks clipping paths', () => {
    const top = path([0, 0, 10, -10], { name: 'top' });
    const clip = path([0, 0, 10, -10], { name: 'clip', clipping: true });
    const inGroup = path([0, 0, 10, -10], { name: 'grouped' });
    const cpInner = path([0, 0, 10, -10], { name: 'cp-inner' });
    const cp = fakeItem('CompoundPathItem', [0, 0, 10, -10], { pathItems: [cpInner] });
    const group = fakeItem('GroupItem', [0, 0, 10, -10], { clipped: true, pageItems: [clip, inGroup, cp] });
    const guide = path([0, 0, 10, -10], { name: 'guide', guides: true });
    const sub = fakeLayer('Sub', [path([0, 0, 10, -10], { name: 'sub' })]);
    const layer = fakeLayer('Art', [top, group, guide], { pathItems: [top, guide], layers: [sub] });
    const result = runToolJsx(jsx, fakeDoc({ layers: [layer] }), { layer_name: 'Art', coordinate_system: 'artboard-web' });
    expect(result.error).toBeUndefined();
    expect(result.pathItems.map((p: any) => p.name).sort()).toEqual(['clip', 'cp-inner', 'grouped', 'sub', 'top']);
    const clipInfo = result.pathItems.find((p: any) => p.name === 'clip');
    expect(clipInfo.clipping).toBe(true);
    expect(result.pathItems.find((p: any) => p.name === 'top').clipping).toBeUndefined();
  });

  it('selection_only does not fail while editing text (selection is a TextRange)', () => {
    const range = { typename: 'TextRange', contents: 'abc', length: 3 };
    const result = runToolJsx(jsx, fakeDoc({ selection: range }), { selection_only: true, coordinate_system: 'artboard-web' });
    expect(result.error).toBeUndefined();
    expect(result.count).toBe(0);
  });
});

describe('get_guidelines JSX', () => {
  const jsx = loadToolJsx('read/get-guidelines.ts');

  it('finds guides inside groups', () => {
    const pts = (coords: number[][]) => coords.map((c) => ({ anchor: c }));
    const hGuide = path([0, -100, 500, -100], { guides: true, pathPoints: pts([[0, -100], [500, -100]]) });
    const vGuide = path([50, 0, 50, -500], { guides: true, pathPoints: pts([[50, 0], [50, -500]]) });
    const group = fakeItem('GroupItem', [0, 0, 500, -500], { pageItems: [hGuide] });
    const layer = fakeLayer('L', [group, vGuide], { pathItems: [vGuide] });
    const result = runToolJsx(jsx, fakeDoc({ layers: [layer] }), { coordinate_system: 'artboard-web' });
    expect(result.error).toBeUndefined();
    expect(result.horizontal).toEqual([{ position: 100, locked: false }]);
    expect(result.vertical).toEqual([{ position: 50, locked: false }]);
  });
});

describe('get_groups JSX', () => {
  const jsx = loadToolJsx('read/get-groups.ts');

  function buildDoc() {
    const clip = path([0, 0, 10, -10], { name: 'mask', clipping: true });
    const cpInner1 = path([0, 0, 10, -10], { name: 'hole-1' });
    const cpInner2 = path([0, 0, 10, -10], { name: 'hole-2' });
    const cp = fakeItem('CompoundPathItem', [0, 0, 10, -10], { name: 'cp', pathItems: [cpInner1, cpInner2] });
    const inner = fakeItem('GroupItem', [0, 0, 10, -10], { name: 'inner', pageItems: [path([0, 0, 1, -1])] });
    const outer = fakeItem('GroupItem', [0, 0, 10, -10], { name: 'outer', clipped: true, pageItems: [clip, cp, inner] });
    const layer = fakeLayer('L', [outer], { groupItems: [outer], compoundPathItems: [] });
    return fakeDoc({ layers: [layer], groupItems: [outer, inner], compoundPathItems: [cp] });
  }

  it('lists compound-path children via pathItems (CompoundPathItem has no pageItems)', () => {
    const result = runToolJsx(jsx, buildDoc(), { coordinate_system: 'artboard-web', depth: 10 });
    const outer = result.groups.find((g: any) => g.name === 'outer');
    const cpChild = outer.children.find((c: any) => c.name === 'cp');
    expect(cpChild.children.map((c: any) => c.name)).toEqual(['hole-1', 'hole-2']);
  });

  it('marks the mask path of a clipping group with clipping: true', () => {
    const result = runToolJsx(jsx, buildDoc(), { coordinate_system: 'artboard-web', depth: 10 });
    const outer = result.groups.find((g: any) => g.name === 'outer');
    expect(outer.type).toBe('clipping-mask');
    expect(outer.children.find((c: any) => c.name === 'mask').clipping).toBe(true);
    expect(outer.children.find((c: any) => c.name === 'cp').clipping).toBeUndefined();
  });

  it('distinguishes depth truncation from having no children', () => {
    const result = runToolJsx(jsx, buildDoc(), { coordinate_system: 'artboard-web', depth: 1 });
    const outer = result.groups.find((g: any) => g.name === 'outer');
    expect(outer.childrenTruncated).toBeUndefined();
    const innerChild = outer.children.find((c: any) => c.name === 'inner');
    expect(innerChild.children).toEqual([]);
    expect(innerChild.childrenTruncated).toBe(true);
    expect(innerChild.childCount).toBe(1);
    const cpTop = result.groups.find((g: any) => g.type === 'compound-path');
    expect(cpTop.children).toHaveLength(2);
  });

  it('layer_name collects nested groups too (Layer.groupItems holds only top-level ones)', () => {
    const result = runToolJsx(jsx, buildDoc(), { coordinate_system: 'artboard-web', layer_name: 'L' });
    expect(result.groups.map((g: any) => g.name).sort()).toEqual(['cp', 'inner', 'outer']);
  });
});

// ─── 8. get_document_structure ─────────────────────────────────────

describe('get_document_structure JSX', () => {
  const jsx = loadToolJsx('read/get-document-structure.ts');

  function buildDoc() {
    const group = fakeItem('GroupItem', [0, 0, 10, -10], { name: 'g', pageItems: [path([0, 0, 1, -1])] });
    const emptyGroup = fakeItem('GroupItem', [0, 0, 10, -10], { name: 'empty', pageItems: [] });
    const sub = fakeLayer('Sub', [path([0, 0, 1, -1])]);
    return fakeDoc({ layers: [fakeLayer('L', [group, emptyGroup], { layers: [sub] })] });
  }

  it('flags groups and layers cut off by depth with childrenTruncated/childCount', () => {
    const result = runToolJsx(jsx, buildDoc(), { coordinate_system: 'artboard-web', depth: 1 });
    const layer = result.layers[0];
    const g = layer.children.find((c: any) => c.name === 'g');
    expect(g.children).toEqual([]);
    expect(g.childrenTruncated).toBe(true);
    expect(g.childCount).toBe(1);
    const empty = layer.children.find((c: any) => c.name === 'empty');
    expect(empty.childrenTruncated).toBeUndefined(); // 本当に子がない
    const sub = layer.children.find((c: any) => c.name === 'Sub');
    expect(sub.childrenTruncated).toBe(true);
    expect(sub.childCount).toBe(1);
  });

  it('does not flag anything when depth is not reached', () => {
    const result = runToolJsx(jsx, buildDoc(), { coordinate_system: 'artboard-web' });
    const g = result.layers[0].children.find((c: any) => c.name === 'g');
    expect(g.children).toHaveLength(1);
    expect(g.childrenTruncated).toBeUndefined();
  });
});

// ─── get_document_info ─────────────────────────────────────────────

describe('get_document_info JSX', () => {
  it('reports Q (級) ruler units instead of "unknown"', () => {
    const jsx = loadToolJsx('read/get-document-info.ts');
    const rulerEnum =
      'var RulerUnits = { Pixels: "RU_PX", Points: "RU_PT", Millimeters: "RU_MM", Centimeters: "RU_CM", Inches: "RU_IN", Picas: "RU_PICA", Qs: "RU_Q" };\n';
    const doc = fakeDoc({
      name: 'a.ai',
      fullName: { fsName: '/tmp/a.ai' },
      width: 500,
      height: 500,
      documentColorSpace: 'CMYK',
      rulerUnits: 'RU_Q',
      rasterEffectSettings: { resolution: 300 },
    });
    const result = runToolJsx(rulerEnum + jsx, doc, { coordinate_system: 'document' });
    expect(result.error).toBeUndefined();
    expect(result.rulerUnits).toBe('Q');
  });
});
