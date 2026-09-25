import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// common.jsx を読み込んでテスト用にロードする
// ExtendScript (ES3) の関数を Node.js 環境でテストするため、
// テストコード内でのみ動的評価を使用（プロダクションコードではない）
const jsxPath = path.resolve(__dirname, '../../src/jsx/helpers/common.jsx');
const jsxCode = fs.readFileSync(jsxPath, 'utf-8');

function loadHelpers(appVersion = '28.0') {
  // ExtendScript のグローバルオブジェクトをモック
  const wrappedCode = `
  // Mock ExtendScript globals
  var TextType = { POINTTEXT: 1, AREATEXT: 2, PATHTEXT: 3 };
  var app = { version: ${JSON.stringify(appVersion)} };
  var writtenFiles = {};

  function File(filePath) {
    this.encoding = '';
    this.open = function() { return true; };
    this.write = function(content) { writtenFiles[filePath] = content; };
    this.close = function() {};
  }

  ${jsxCode}

  return {
    resolveTargetLayer: resolveTargetLayer,
    webToAiPoint: webToAiPoint,
    getParentLayerName: getParentLayerName,
    getTextKind: getTextKind,
    iterateAllItems: iterateAllItems,
    checkIllustratorVersion: checkIllustratorVersion,
    writeResultFile: writeResultFile,
    readWrittenResult: function(filePath) {
      return jsonParse(writtenFiles[filePath]);
    },
    // test-only: expose the internal UUID index builder directly (bypassing
    // app.activeDocument) so we can hand it a fake container tree and assert
    // on the resulting uuid -> item map.
    buildUUIDIndexFor: function (container) {
      _resetUUIDIndex();
      _indexContainer(container);
      return _uuidIndex;
    },
    setActiveDocument: function (doc) {
      app.activeDocument = doc;
      _uuidIndex = null;
    },
    ensureUUID: ensureUUID,
    reassignUUID: reassignUUID,
    extractUUIDFromNote: extractUUIDFromNote,
    getNoteMeta: getNoteMeta,
    setNoteMeta: setNoteMeta,
    getZIndex: getZIndex,
    findItemByUUID: findItemByUUID,
    getUUIDDuplicates: getUUIDDuplicates,
    colorToObject: colorToObject,
    getBounds: getBounds,
    checkArtboardBounds: checkArtboardBounds,
    verifyItem: verifyItem,
  };
`;

  // eslint-disable-next-line no-new-func -- test-only: evaluating ES3 ExtendScript helpers in Node.js (same pattern as json-stringify.test.ts)
  const factory = new Function(wrappedCode); // NOSONAR
  return factory() as {
    resolveTargetLayer: (doc: unknown, layerName: string | null) => unknown;
    webToAiPoint: (x: number, y: number, coordSystem: string, artboardRect: number[] | null) => number[];
    getParentLayerName: (item: unknown) => string;
    getTextKind: (tf: unknown) => string;
    iterateAllItems: (container: unknown, callback: (item: unknown) => void) => void;
    checkIllustratorVersion: () => { error: boolean; message: string } | null;
    writeResultFile: (filePath: string, result: unknown) => void;
    readWrittenResult: (filePath: string) => unknown;
    buildUUIDIndexFor: (container: unknown) => Record<string, { name: string }>;
  } & ExtraHelpers;
}

type Note = { note?: string };
type ExtraHelpers = {
  setActiveDocument: (doc: unknown) => void;
  ensureUUID: (item: Note) => string;
  reassignUUID: (item: Note) => string;
  extractUUIDFromNote: (note: string) => string;
  getNoteMeta: (note: string, key: string) => string | null;
  setNoteMeta: (item: Note, key: string, value: string) => void;
  getZIndex: (item: unknown) => number;
  findItemByUUID: (uuid: string) => { name: string } | null;
  getUUIDDuplicates: () => Array<{ uuid: string; count: number }>;
  colorToObject: (color: unknown) => Record<string, unknown>;
  getBounds: (item: unknown, coordSystem: string, artboardRect: number[] | null) => Record<string, unknown>;
  checkArtboardBounds: (item: unknown, artboardRect: number[] | null) => string | null;
  verifyItem: (item: unknown, coordSystem?: string, artboardRect?: number[] | null) => Record<string, unknown>;
};

const helpers = loadHelpers() as {
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

describe('checkIllustratorVersion', () => {
  it.each(['28.0', '29.1'])('v28 以上 (%s) は警告しない', (version) => {
    const versionHelpers = loadHelpers(version);

    expect(versionHelpers.checkIllustratorVersion()).toBeNull();
    versionHelpers.writeResultFile('/result.json', { success: true });
    expect(versionHelpers.readWrittenResult('/result.json')).toEqual({ success: true });
  });

  it.each(['24.0', '25.4', '26.0', '27.9'])('v24〜v27 (%s) は警告を1件付与する', (version) => {
    const versionHelpers = loadHelpers(version);

    expect(versionHelpers.checkIllustratorVersion()).toBeNull();
    versionHelpers.writeResultFile('/result.json', { success: true });
    const result = versionHelpers.readWrittenResult('/result.json') as { warnings: string[] };
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('below the verified baseline');
  });

  it('v24 未満はエラーを返す', () => {
    const versionHelpers = loadHelpers('23.9');

    const result = versionHelpers.checkIllustratorVersion();
    expect(result).toMatchObject({ error: true });
    expect(result?.message).toContain('v24');
  });

  it('数値として解釈できないバージョンはエラーを返す', () => {
    const versionHelpers = loadHelpers('unknown');

    expect(versionHelpers.checkIllustratorVersion()).toMatchObject({ error: true });
  });
});

describe('writeResultFile version warning', () => {
  it('既存 warnings に追記し、上書きしない', () => {
    const versionHelpers = loadHelpers('27.0');
    versionHelpers.checkIllustratorVersion();

    versionHelpers.writeResultFile('/result.json', { warnings: ['existing warning'] });

    const result = versionHelpers.readWrittenResult('/result.json') as { warnings: string[] };
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toBe('existing warning');
    expect(result.warnings[1]).toContain('below the verified baseline');
  });

  it('配列の結果には警告を付与しない', () => {
    const versionHelpers = loadHelpers('27.0');
    versionHelpers.checkIllustratorVersion();

    versionHelpers.writeResultFile('/result.json', [{ success: true }]);

    expect(versionHelpers.readWrittenResult('/result.json')).toEqual([{ success: true }]);
  });

  it('error: true の結果にも警告を付与する', () => {
    const versionHelpers = loadHelpers('27.0');
    versionHelpers.checkIllustratorVersion();

    versionHelpers.writeResultFile('/result.json', { error: true, message: 'failed' });

    const result = versionHelpers.readWrittenResult('/result.json') as {
      error: boolean;
      warnings: string[];
    };
    expect(result.error).toBe(true);
    expect(result.warnings).toHaveLength(1);
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ensureUUID (note を破壊しない)', () => {
  it('空の note には UUID のみを書く', () => {
    const h = loadHelpers();
    const item: Note = { note: '' };
    const uuid = h.ensureUUID(item);
    expect(uuid).toMatch(UUID_RE);
    expect(item.note).toBe(uuid);
  });

  it('ユーザーのメモを温存し、先頭に UUID を付加する', () => {
    const h = loadHelpers();
    const item: Note = { note: 'designer note: 2025 spring campaign' };
    const uuid = h.ensureUUID(item);
    expect(item.note).toBe(uuid + ' designer note: 2025 spring campaign');
    // 2回目は同じ UUID を返し、note も変わらない
    expect(h.ensureUUID(item)).toBe(uuid);
    expect(item.note).toBe(uuid + ' designer note: 2025 spring campaign');
    expect(h.extractUUIDFromNote(item.note!)).toBe(uuid);
  });

  it('旧フォーマット（先頭が素の UUID）はそのまま使う', () => {
    const h = loadHelpers();
    const legacy = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee::rot=90';
    const item: Note = { note: legacy };
    expect(h.ensureUUID(item)).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(item.note).toBe(legacy);
  });

  it('note 書き込みが例外でも UUID を返す', () => {
    const h = loadHelpers();
    const item = {
      get note() {
        return '';
      },
      set note(_v: string) {
        throw new Error('locked');
      },
    };
    expect(h.ensureUUID(item)).toMatch(UUID_RE);
  });

  it('付加後の note も UUID インデックスで解決できる', () => {
    const h = loadHelpers();
    const item = { typename: 'PathItem', name: 'memo', note: 'my memo' };
    const uuid = h.ensureUUID(item);
    const index = h.buildUUIDIndexFor({ pageItems: { length: 1, 0: item } });
    expect(index[uuid]).toBe(item);
  });
});

describe('reassignUUID', () => {
  it('UUID だけ差し替え、メモとメタデータを温存する', () => {
    const h = loadHelpers();
    const item: Note = { note: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee memo::ai-mcp:rot=45' };
    const uuid = h.reassignUUID(item);
    expect(uuid).not.toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(item.note).toBe(uuid + ' memo::ai-mcp:rot=45');
  });

  it('UUID のない note には付加する', () => {
    const h = loadHelpers();
    const item: Note = { note: 'memo' };
    const uuid = h.reassignUUID(item);
    expect(item.note).toBe(uuid + ' memo');
  });
});

describe('note メタデータ（名前空間付き）', () => {
  const U = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('名前空間付きキーで書き込む', () => {
    const h = loadHelpers();
    const item: Note = { note: U };
    h.setNoteMeta(item, 'rot', '30');
    expect(item.note).toBe(U + '::ai-mcp:rot=30');
    expect(h.getNoteMeta(item.note!, 'rot')).toBe('30');
    h.setNoteMeta(item, 'rot', '60');
    expect(item.note).toBe(U + '::ai-mcp:rot=60');
  });

  it('旧フォーマット ::rot= を読み、書き込み時に名前空間付きへ移行する', () => {
    const h = loadHelpers();
    const item: Note = { note: U + '::rot=90::foo=bar' };
    expect(h.getNoteMeta(item.note!, 'rot')).toBe('90');
    h.setNoteMeta(item, 'rot', '120');
    expect(item.note).toBe(U + '::ai-mcp:rot=120::foo=bar');
    expect(h.getNoteMeta(item.note!, 'rot')).toBe('120');
  });

  it('ユーザーのメモ内の ::rot= はメタデータとして扱わず、壊さない', () => {
    const h = loadHelpers();
    const item: Note = { note: U + ' see ::rot=5 in spec' };
    expect(h.getNoteMeta(item.note!, 'rot')).toBeNull();
    h.setNoteMeta(item, 'rot', '15');
    expect(item.note).toBe(U + ' see ::rot=5 in spec::ai-mcp:rot=15');
    expect(h.getNoteMeta(item.note!, 'rot')).toBe('15');
  });
});

describe('getZIndex', () => {
  it('zOrderPosition (1 始まり) を 0 始まりに変換する', () => {
    const h = loadHelpers();
    expect(h.getZIndex({ zOrderPosition: 1 })).toBe(0);
    expect(h.getZIndex({ zOrderPosition: 5 })).toBe(4);
  });

  it('zOrderPosition が取れない場合は 0', () => {
    const h = loadHelpers();
    expect(h.getZIndex({})).toBe(0);
    const throwing = {
      get zOrderPosition() {
        throw new Error('n/a');
      },
    };
    expect(h.getZIndex(throwing)).toBe(0);
  });

  it('zOrderPosition が投げる場合（作成直後）は親 pageItems の位置から算出する', () => {
    const h = loadHelpers();
    const item: Record<string, unknown> = {
      get zOrderPosition() {
        throw new Error('No such element');
      },
    };
    const front = {};
    const back = {};
    // pageItems は前面→背面の順
    item.parent = { pageItems: { length: 3, 0: front, 1: item, 2: back } };
    expect(h.getZIndex(item)).toBe(1);
  });

  it('itemIndex には依存しない（実機に存在しない）', () => {
    const h = loadHelpers();
    expect(h.getZIndex({ itemIndex: 3, zOrderPosition: 2 })).toBe(1);
  });
});

describe('複合パス内部の走査', () => {
  const compound = () => ({
    typename: 'CompoundPathItem',
    name: 'cp',
    note: '',
    pageItems: { length: 0 },
    pathItems: {
      length: 2,
      0: { typename: 'PathItem', name: 'cp-inner-1', note: 'dddddddd-eeee-4fff-8000-111111111111' },
      1: { typename: 'PathItem', name: 'cp-inner-2', note: '' },
    },
  });

  it('_indexContainer が複合パス内部の PathItem を索引する', () => {
    const layer = {
      pageItems: {
        length: 1,
        0: { typename: 'GroupItem', name: 'g', note: '', pageItems: { length: 1, 0: compound() } },
      },
      layers: { length: 0 },
    };
    const index = helpers.buildUUIDIndexFor(layer);
    expect(index['dddddddd-eeee-4fff-8000-111111111111'].name).toBe('cp-inner-1');
  });

  it('iterateAllItems が複合パス内部とサブレイヤーを辿る', () => {
    const names: string[] = [];
    const layer = {
      pageItems: { length: 2, 0: { typename: 'PathItem', name: 'top' }, 1: compound() },
      layers: {
        length: 1,
        0: { pageItems: { length: 1, 0: { typename: 'TextFrame', name: 'in-sublayer' } }, layers: { length: 0 } },
      },
    };
    helpers.iterateAllItems(layer, (item: unknown) => {
      names.push((item as { name: string }).name);
    });
    expect(names).toEqual(['top', 'cp', 'cp-inner-1', 'cp-inner-2', 'in-sublayer']);
  });
});

describe('UUID 重複検出', () => {
  const DUP = 'eeeeeeee-ffff-4000-8111-222222222222';
  const doc = () => ({
    layers: {
      length: 2,
      0: {
        pageItems: { length: 1, 0: { typename: 'PathItem', name: 'original', note: DUP } },
        layers: { length: 0 },
      },
      1: {
        pageItems: {
          length: 2,
          0: { typename: 'PathItem', name: 'copy', note: DUP + '::ai-mcp:rot=10' },
          1: { typename: 'PathItem', name: 'unique', note: 'ffffffff-0000-4111-8222-333333333333' },
        },
        layers: { length: 0 },
      },
    },
  });

  it('getUUIDDuplicates が重複 UUID と出現数を返す', () => {
    const h = loadHelpers();
    h.setActiveDocument(doc());
    expect(h.getUUIDDuplicates()).toEqual([{ uuid: DUP, count: 2 }]);
  });

  it('findItemByUUID は先勝ちで返し、結果に警告を載せる', () => {
    const h = loadHelpers();
    h.setActiveDocument(doc());
    expect(h.findItemByUUID(DUP)?.name).toBe('original');
    h.findItemByUUID(DUP); // 同じ警告は1回だけ
    h.writeResultFile('/r.json', { success: true });
    const r = h.readWrittenResult('/r.json') as { warnings: string[] };
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(DUP);
    expect(r.warnings[0]).toContain('shared by 2 objects');
  });

  it('重複していない UUID では警告しない', () => {
    const h = loadHelpers();
    h.setActiveDocument(doc());
    expect(h.findItemByUUID('ffffffff-0000-4111-8222-333333333333')?.name).toBe('unique');
    h.writeResultFile('/r.json', { success: true });
    expect(h.readWrittenResult('/r.json')).toEqual({ success: true });
  });
});

describe('colorToObject', () => {
  it('LabColor を lab として返す', () => {
    const h = loadHelpers();
    expect(h.colorToObject({ typename: 'LabColor', l: 50, a: -20, b: 30 })).toEqual({
      type: 'lab',
      l: 50,
      a: -20,
      b: 30,
    });
  });

  it('Lab ベースのスポットカラーの中身も lab になる', () => {
    const h = loadHelpers();
    const spot = {
      typename: 'SpotColor',
      tint: 100,
      spot: { name: 'PANTONE X', color: { typename: 'LabColor', l: 1, a: 2, b: 3 } },
    };
    expect(h.colorToObject(spot)).toEqual({
      type: 'spot',
      name: 'PANTONE X',
      tint: 100,
      color: { type: 'lab', l: 1, a: 2, b: 3 },
    });
  });
});

describe('verifyItem', () => {
  const AB = [0, 100, 100, 0];
  const path = (overrides: Record<string, unknown> = {}) => ({
    typename: 'PathItem',
    name: 'p',
    geometricBounds: [10, 90, 20, 80],
    filled: false,
    stroked: false,
    hidden: false,
    parent: { typename: 'Layer', name: 'L1', visible: true, parent: { typename: 'Document' } },
    ...overrides,
  });

  it('非表示レイヤー上のオブジェクトは visible: false', () => {
    const h = loadHelpers();
    const item = path({ parent: { typename: 'Layer', name: 'Hidden', visible: false, parent: { typename: 'Document' } } });
    expect(h.verifyItem(item, 'artboard-web', AB).visible).toBe(false);
  });

  it('非表示グループ内のオブジェクトは visible: false', () => {
    const h = loadHelpers();
    const item = path({
      parent: {
        typename: 'GroupItem',
        hidden: true,
        parent: { typename: 'Layer', name: 'L1', visible: true, parent: { typename: 'Document' } },
      },
    });
    expect(h.verifyItem(item, 'artboard-web', AB).visible).toBe(false);
  });

  it('親がすべて表示なら visible: true', () => {
    const h = loadHelpers();
    expect(h.verifyItem(path(), 'artboard-web', AB).visible).toBe(true);
  });

  it('TextFrame は文字の塗り色を fill として返す', () => {
    const h = loadHelpers();
    const tf = {
      typename: 'TextFrame',
      name: 't',
      contents: 'Hello',
      kind: 1,
      geometricBounds: [10, 90, 20, 80],
      textRange: {
        characterAttributes: { size: 12, tracking: 0, fillColor: { typename: 'RGBColor', red: 255, green: 0, blue: 0 } },
      },
      parent: { typename: 'Layer', name: 'L1', visible: true, parent: { typename: 'Document' } },
    };
    expect(h.verifyItem(tf, 'artboard-web', AB).fill).toEqual({ type: 'rgb', r: 255, g: 0, b: 0 });
  });

  it('アートボードがない場合は bounds に非アートボード相対であることを明示する', () => {
    const h = loadHelpers();
    const snap = h.verifyItem(path(), 'artboard-web', null);
    expect(snap.bounds).toMatchObject({ x: 10, y: -90, artboardRelative: false });
    expect((snap.bounds as { coordinateNote: string }).coordinateNote).toContain('Not artboard-relative');
    // アートボードありの場合は従来どおり
    expect(h.verifyItem(path(), 'artboard-web', AB).bounds).toEqual({ x: 10, y: 10, width: 10, height: 10 });
  });
});

describe('checkArtboardBounds', () => {
  const AB = [0, 100, 100, 0];

  it('太いストロークでアートボードに掛かっていれば completely outside と言わない', () => {
    const h = loadHelpers();
    // パス自体はアートボード右外（x=102..110）だが、ストロークが x=98 まで掛かる
    const item = { geometricBounds: [102, 60, 110, 40], visibleBounds: [98, 64, 114, 36] };
    const w = h.checkArtboardBounds(item, AB);
    expect(w).toContain('extends beyond');
  });

  it('visibleBounds でも外なら completely outside', () => {
    const h = loadHelpers();
    const item = { geometricBounds: [120, 60, 130, 40], visibleBounds: [118, 62, 132, 38] };
    expect(h.checkArtboardBounds(item, AB)).toContain('completely outside');
  });

  it('visibleBounds が取れなければ geometricBounds で判定する', () => {
    const h = loadHelpers();
    expect(h.checkArtboardBounds({ geometricBounds: [10, 90, 20, 80] }, AB)).toBeNull();
  });
});
