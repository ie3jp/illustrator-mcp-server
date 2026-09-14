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
  };
}

const helpers = loadHelpers() as {
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
