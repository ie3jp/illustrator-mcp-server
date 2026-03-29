import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// common.jsx を読み込んでテスト用にロードする
// ExtendScript (ES3) の関数を Node.js 環境でテストするため、
// テストコード内でのみ動的評価を使用（プロダクションコードではない）
const jsxPath = path.resolve(__dirname, '../../src/jsx/helpers/common.jsx');
const jsxCode = fs.readFileSync(jsxPath, 'utf-8');

// ExtendScript のグローバルオブジェクトをモック
const wrappedCode = `
  // Mock ExtendScript globals
  var TextType = { POINTTEXT: 1, AREATEXT: 2, PATHTEXT: 3 };

  ${jsxCode}

  return {
    resolveTargetLayer: resolveTargetLayer,
    webToAiPoint: webToAiPoint,
    getParentLayerName: getParentLayerName,
    getTextKind: getTextKind,
    iterateAllItems: iterateAllItems,
  };
`;

// eslint-disable-next-line no-new-func -- test-only: evaluating ES3 ExtendScript helpers in Node.js (same pattern as json-stringify.test.ts)
const factory = new Function(wrappedCode); // NOSONAR
const helpers = factory() as {
  resolveTargetLayer: (doc: unknown, layerName: string | null) => unknown;
  webToAiPoint: (x: number, y: number, coordSystem: string, artboardRect: number[] | null) => number[];
  getParentLayerName: (item: unknown) => string;
  getTextKind: (tf: unknown) => string;
  iterateAllItems: (container: unknown, callback: (item: unknown) => void) => void;
};

describe('webToAiPoint', () => {
  it('returns original coords for document coordinate system', () => {
    const result = helpers.webToAiPoint(100, 200, 'document', null);
    expect(result).toEqual([100, 200]);
  });

  it('converts artboard-web coords with artboard rect', () => {
    const abRect = [50, 800, 650, 0]; // [left, top, right, bottom]
    const result = helpers.webToAiPoint(10, 20, 'artboard-web', abRect);
    expect(result).toEqual([60, 780]); // [50+10, 800+(-20)]
  });

  it('returns original coords when artboard-web but no rect', () => {
    const result = helpers.webToAiPoint(100, 200, 'artboard-web', null);
    expect(result).toEqual([100, 200]);
  });
});

describe('getParentLayerName', () => {
  it('returns layer name when parent is a Layer', () => {
    const item = { parent: { typename: 'Layer', name: 'Background' } };
    expect(helpers.getParentLayerName(item)).toBe('Background');
  });

  it('walks up to find Layer through groups', () => {
    const item = {
      parent: {
        typename: 'GroupItem',
        parent: { typename: 'Layer', name: 'Icons' },
      },
    };
    expect(helpers.getParentLayerName(item)).toBe('Icons');
  });

  it('returns empty string when no Layer found', () => {
    const item = { parent: null };
    expect(helpers.getParentLayerName(item)).toBe('');
  });
});

describe('getTextKind', () => {
  it('returns "point" for POINTTEXT', () => {
    expect(helpers.getTextKind({ kind: 1 })).toBe('point');
  });

  it('returns "area" for AREATEXT', () => {
    expect(helpers.getTextKind({ kind: 2 })).toBe('area');
  });

  it('returns "path" for PATHTEXT', () => {
    expect(helpers.getTextKind({ kind: 3 })).toBe('path');
  });

  it('returns "unknown" for unrecognized kind', () => {
    expect(helpers.getTextKind({ kind: 99 })).toBe('unknown');
  });

  it('returns "unknown" when kind throws', () => {
    const tf = {
      get kind() {
        throw new Error('no kind');
      },
    };
    expect(helpers.getTextKind(tf)).toBe('unknown');
  });
});

describe('resolveTargetLayer', () => {
  it('returns activeLayer when layerName is falsy', () => {
    const doc = { activeLayer: { name: 'Layer 1' } };
    expect(helpers.resolveTargetLayer(doc, null)).toBe(doc.activeLayer);
  });

  it('returns existing layer by name', () => {
    const existingLayer = { name: 'Icons' };
    const doc = {
      activeLayer: { name: 'Layer 1' },
      layers: {
        getByName: (name: string) => {
          if (name === 'Icons') return existingLayer;
          throw new Error('not found');
        },
      },
    };
    expect(helpers.resolveTargetLayer(doc, 'Icons')).toBe(existingLayer);
  });

  it('creates new layer when name not found', () => {
    const newLayer = { name: '' };
    const doc = {
      activeLayer: { name: 'Layer 1' },
      layers: {
        getByName: () => {
          throw new Error('not found');
        },
        add: () => newLayer,
      },
    };
    const result = helpers.resolveTargetLayer(doc, 'NewLayer') as { name: string };
    expect(result).toBe(newLayer);
    expect(result.name).toBe('NewLayer');
  });
});

describe('iterateAllItems', () => {
  it('iterates flat items', () => {
    const items: string[] = [];
    const container = {
      pageItems: {
        length: 3,
        0: { typename: 'PathItem', name: 'a' },
        1: { typename: 'PathItem', name: 'b' },
        2: { typename: 'PathItem', name: 'c' },
      },
    };
    helpers.iterateAllItems(container, (item: unknown) => {
      items.push((item as { name: string }).name);
    });
    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('recurses into GroupItems', () => {
    const items: string[] = [];
    const container = {
      pageItems: {
        length: 2,
        0: { typename: 'PathItem', name: 'top' },
        1: {
          typename: 'GroupItem',
          name: 'group',
          pageItems: {
            length: 1,
            0: { typename: 'PathItem', name: 'nested' },
          },
        },
      },
    };
    helpers.iterateAllItems(container, (item: unknown) => {
      items.push((item as { name: string }).name);
    });
    expect(items).toEqual(['top', 'group', 'nested']);
  });
});
