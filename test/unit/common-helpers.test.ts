import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// common.jsx を読み込んでテスト用にロードする
// ExtendScript (ES3) の関数を Node.js 環境でテストするため、
// テストコード内でのみ動的評価を使用（プロダクションコードではない）
const jsxPath = path.resolve(__dirname, '../../src/jsx/helpers/common.jsx');
const jsxCode = fs.readFileSync(jsxPath, 'utf-8');

// ExtendScript のグローバルオブジェクトをモック（InDesign 版）
const wrappedCode = `
  // Mock InDesign ExtendScript globals
  var ColorSpace = { CMYK: 'cmyk', RGB: 'rgb', LAB: 'lab' };

  ${jsxCode}

  return {
    resolveTargetLayer: resolveTargetLayer,
    getParentLayerName: getParentLayerName,
    getBounds: getBounds,
    getBoundsOnPage: getBoundsOnPage,
    getItemType: getItemType,
    iterateAllItems: iterateAllItems,
    resolveTargetPage: resolveTargetPage,
  };
`;

// eslint-disable-next-line no-new-func -- test-only: evaluating ES3 ExtendScript helpers in Node.js
const factory = new Function(wrappedCode); // NOSONAR
const helpers = factory() as {
  resolveTargetLayer: (doc: unknown, layerName: string | null) => unknown;
  getParentLayerName: (item: unknown) => string;
  getBounds: (item: unknown) => { x: number; y: number; width: number; height: number };
  getBoundsOnPage: (item: unknown, page: unknown) => { x: number; y: number; width: number; height: number };
  getItemType: (item: unknown) => string;
  iterateAllItems: (container: unknown, callback: (item: unknown) => void) => void;
  resolveTargetPage: (doc: unknown, pageIndex: number | undefined) => unknown;
};

describe('getBounds (InDesign)', () => {
  it('converts geometricBounds [top, left, bottom, right] to x, y, width, height', () => {
    const item = { geometricBounds: [10, 20, 110, 220] }; // top=10, left=20, bottom=110, right=220
    const result = helpers.getBounds(item);
    expect(result).toEqual({ x: 20, y: 10, width: 200, height: 100 });
  });

  it('handles zero-origin bounds', () => {
    const item = { geometricBounds: [0, 0, 50, 100] };
    const result = helpers.getBounds(item);
    expect(result).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});

describe('getBoundsOnPage', () => {
  it('returns page-relative coordinates', () => {
    const item = { geometricBounds: [110, 120, 210, 320] };
    const page = { bounds: [100, 100, 900, 700] }; // page starts at [100, 100]
    const result = helpers.getBoundsOnPage(item, page);
    expect(result).toEqual({ x: 20, y: 10, width: 200, height: 100 });
  });
});

describe('getParentLayerName (InDesign)', () => {
  it('returns itemLayer name', () => {
    const item = { itemLayer: { name: 'Background' } };
    expect(helpers.getParentLayerName(item)).toBe('Background');
  });

  it('returns empty string when no itemLayer', () => {
    const item = {};
    expect(helpers.getParentLayerName(item)).toBe('');
  });
});

describe('getItemType (InDesign)', () => {
  it('returns "text" for TextFrame', () => {
    const item = { constructor: { name: 'TextFrame' } };
    expect(helpers.getItemType(item)).toBe('text');
  });

  it('returns "rectangle" for Rectangle', () => {
    const item = { constructor: { name: 'Rectangle' } };
    expect(helpers.getItemType(item)).toBe('rectangle');
  });

  it('returns "oval" for Oval', () => {
    const item = { constructor: { name: 'Oval' } };
    expect(helpers.getItemType(item)).toBe('oval');
  });

  it('returns "line" for GraphicLine', () => {
    const item = { constructor: { name: 'GraphicLine' } };
    expect(helpers.getItemType(item)).toBe('line');
  });

  it('returns "group" for Group', () => {
    const item = { constructor: { name: 'Group' } };
    expect(helpers.getItemType(item)).toBe('group');
  });

  it('returns "table" for Table', () => {
    const item = { constructor: { name: 'Table' } };
    expect(helpers.getItemType(item)).toBe('table');
  });

  it('returns "other" for unknown type', () => {
    const item = { constructor: { name: 'SomeUnknownType' } };
    expect(helpers.getItemType(item)).toBe('other');
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
        itemByName: (name: string) => {
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
        itemByName: () => {
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

describe('resolveTargetPage', () => {
  it('returns page by index', () => {
    const page0 = { name: '1' };
    const page1 = { name: '2' };
    const doc = { pages: { length: 2, 0: page0, 1: page1 } };
    expect(helpers.resolveTargetPage(doc, 1)).toBe(page1);
  });

  it('returns first page when index is undefined and no app context', () => {
    const page0 = { name: '1' };
    const doc = { pages: { length: 1, 0: page0 } };
    // No global app, so it falls back to doc.pages[0]
    expect(helpers.resolveTargetPage(doc, undefined)).toBe(page0);
  });
});

describe('iterateAllItems (InDesign)', () => {
  it('iterates allPageItems when available', () => {
    const items: string[] = [];
    const container = {
      allPageItems: [
        { name: 'a' },
        { name: 'b' },
        { name: 'c' },
      ],
    };
    helpers.iterateAllItems(container, (item: unknown) => {
      items.push((item as { name: string }).name);
    });
    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('falls back to pageItems', () => {
    const items: string[] = [];
    const container = {
      pageItems: [
        { name: 'x' },
        { name: 'y' },
      ],
    };
    helpers.iterateAllItems(container, (item: unknown) => {
      items.push((item as { name: string }).name);
    });
    expect(items).toEqual(['x', 'y']);
  });
});
