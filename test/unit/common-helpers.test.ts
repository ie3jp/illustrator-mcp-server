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
    // test-only: expose the internal UUID index builder directly (bypassing
    // app.activeDocument) so we can hand it a fake container tree and assert
    // on the resulting uuid -> item map.
    buildUUIDIndexFor: function (container) {
      _uuidIndex = {};
      _indexContainer(container);
      return _uuidIndex;
    },
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
  buildUUIDIndexFor: (container: unknown) => Record<string, { name: string }>;
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

describe('UUID index (findItemByUUID support)', () => {
  // Regression test for a bug where modify_object / move_to_layer / select_objects
  // (all of which resolve a uuid via findItemByUUID) failed with "No object found
  // matching UUID" for any item placed inside a named sublayer — even though
  // read-only tools (list_text_frames, get_images, get_document_structure) could
  // see the same item fine, because they use doc.textFrames / doc.placedItems
  // (which recurse into sublayers natively) instead of a hand-rolled walk.
  it('finds an item nested one level inside a sublayer', () => {
    const topLayer = {
      pageItems: { length: 0 },
      layers: {
        length: 1,
        0: {
          pageItems: {
            length: 1,
            0: { typename: 'TextFrame', name: 'nested-in-sublayer', note: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
          },
          layers: { length: 0 },
        },
      },
    };
    const index = helpers.buildUUIDIndexFor(topLayer);
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(index[uuid]).toBeDefined();
    expect(index[uuid].name).toBe('nested-in-sublayer');
  });

  it('finds an item nested two levels inside stacked sublayers', () => {
    const topLayer = {
      pageItems: { length: 0 },
      layers: {
        length: 1,
        0: {
          pageItems: { length: 0 },
          layers: {
            length: 1,
            0: {
              pageItems: {
                length: 1,
                0: { typename: 'PlacedItem', name: 'deeply-nested', note: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' },
              },
              layers: { length: 0 },
            },
          },
        },
      },
    };
    const index = helpers.buildUUIDIndexFor(topLayer);
    const uuid = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    expect(index[uuid]).toBeDefined();
    expect(index[uuid].name).toBe('deeply-nested');
  });

  it('still finds flat items directly in the layer (no regression)', () => {
    const topLayer = {
      pageItems: {
        length: 1,
        0: { typename: 'TextFrame', name: 'flat', note: 'cccccccc-dddd-4eee-8fff-000000000000' },
      },
      layers: { length: 0 },
    };
    const index = helpers.buildUUIDIndexFor(topLayer);
    const uuid = 'cccccccc-dddd-4eee-8fff-000000000000';
    expect(index[uuid]).toBeDefined();
    expect(index[uuid].name).toBe('flat');
  });
});
