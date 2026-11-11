/**
 * Document.pageItems は再帰的（グループの子・複合パス内部を含む）なので、
 * レイヤー直下だけが要る処理は collectTopLevelPageItems を使う（issue #52）
 */
import { describe, expect, it } from 'vitest';
import { type Fake, makeApp, makeDoc, makeGroup, makeItem, makeLayer, runToolJsx } from './helpers/fake-illustrator.js';
import { extractJsxCode } from './helpers/run-tool-jsx.js';

/** 実機ではグループの子・複合パス内部も .layer を持つ（フェイクの addItem は直下にしか付けない） */
function setLayerDeep(item: Fake, layer: Fake) {
  item.layer = layer;
  for (const c of item.pageItems ?? []) setLayerDeep(c, layer);
  for (const c of item.pathItems ?? []) setLayerDeep(c, layer);
}

function compoundPath(bounds: number[], holeBounds: number[]): Fake {
  const outer = makeItem('PathItem', { geometricBounds: bounds });
  const hole = makeItem('PathItem', { geometricBounds: holeBounds });
  const cp = makeItem('CompoundPathItem', { pathItems: [outer, hole], geometricBounds: bounds });
  outer.parent = cp;
  hole.parent = cp;
  return cp;
}

/** Art レイヤー: 複合パス 1・グループ（子 2）1・パス 1。サブレイヤー Sub: パス 1 */
function layeredDoc() {
  const art = makeLayer('Art');
  const sub = makeLayer('Sub');
  sub.parent = art;
  art.layers.push(sub);
  const doc = makeDoc({ layers: [art] });
  const cp = art.addItem(compoundPath([0, 100, 40, 60], [10, 90, 30, 70]));
  const group = art.addItem(makeGroup([
    makeItem('PathItem', { geometricBounds: [60, 100, 70, 60] }),
    makeItem('PathItem', { geometricBounds: [80, 100, 100, 60] }),
  ]));
  const rect = art.addItem(makeItem('PathItem', { geometricBounds: [120, 100, 160, 60] }));
  const subRect = sub.addItem(makeItem('PathItem', { geometricBounds: [180, 100, 220, 60] }));
  for (const it of [cp, group, rect]) setLayerDeep(it, art);
  setLayerDeep(subRect, sub);
  return { doc, cp, group, rect, subRect };
}

describe('collectTopLevelPageItems', () => {
  it('returns layer and sublayer children only, in layer order', () => {
    const { doc, cp, group, rect, subRect } = layeredDoc();
    // 前提: doc.pageItems は子まで含む（4 + 複合パス内部 2 + グループの子 2）
    expect(doc.pageItems).toHaveLength(8);

    const jsx = `
      var items = collectTopLevelPageItems(app.activeDocument);
      var names = [];
      for (var i = 0; i < items.length; i++) names.push(items[i].name);
      writeResultFile(RESULT_PATH, { names: names });
    `;
    cp.name = 'cp';
    group.name = 'group';
    rect.name = 'rect';
    subRect.name = 'sub';
    const r = runToolJsx(jsx, {}, makeApp(doc));
    expect(r.names).toEqual(['cp', 'group', 'rect', 'sub']);
  });
});

describe('extract_design_tokens spacing bounds (#52)', () => {
  it('tags bounds with a scope: top-level items share one scope across layers, group children get their own, compound paths are one shape', () => {
    const { doc } = layeredDoc();
    const r = runToolJsx(extractJsxCode('read/extract-design-tokens.ts'), {}, makeApp(doc));
    expect(r.error).toBeUndefined();
    expect(r.objectBounds).toEqual([
      { left: 0, top: 100, right: 40, bottom: 60, scope: 0 }, // 複合パス（内部のパスは拾わない）
      { left: 60, top: 100, right: 100, bottom: 60, scope: 0 }, // グループ
      { left: 60, top: 100, right: 70, bottom: 60, scope: 1 }, // グループの子
      { left: 80, top: 100, right: 100, bottom: 60, scope: 1 },
      { left: 120, top: 100, right: 160, bottom: 60, scope: 0 },
      { left: 180, top: 100, right: 220, bottom: 60, scope: 0 }, // サブレイヤー: トップレベル同士は比較する
    ]);
  });

  // レイヤーごとに scope を分けると、「文字」「図形」「背景」のようにレイヤーを分けた文書で
  // 間隔が一切取れなくなる。#52 の修正で一度そうなったので、同じ退行を検出する
  it('compares spacing across layers: items on different layers land in the same scope', () => {
    const { doc } = layeredDoc();
    const r = runToolJsx(extractJsxCode('read/extract-design-tokens.ts'), {}, makeApp(doc));
    expect(r.error).toBeUndefined();
    // left:120 は Art レイヤー直下の rect、left:180 は Sub レイヤー直下の subRect。
    // 別レイヤーでも同じ scope でなければ、両者の間隔は一度も比較されない
    const bounds = r.objectBounds as Array<{ left: number; scope: number }>;
    const artScope = bounds.find((b) => b.left === 120)?.scope;
    const subScope = bounds.find((b) => b.left === 180)?.scope;
    expect(artScope).toBeDefined();
    expect(subScope).toBeDefined();
    expect(subScope).toBe(artScope);
  });
});
