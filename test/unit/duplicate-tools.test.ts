/**
 * 複製系ツール（manage_datasets の import_csv / resize_for_variation）の JSX ロジックテスト
 *
 * ツールが executeJsx に渡す JSX 文字列を取り出し、common.jsx と一緒に Node 上で
 * 偽の Illustrator オブジェクトに対して実行する（common-helpers.test.ts と同じ手法）。
 * 実機の挙動（duplicate() の配置・Layer.pageItems の範囲等）は再現していない。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn().mockResolvedValue({ success: true }),
  executeJsxHeavy: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return {
    ...actual,
    resolveCoordinateSystem: vi.fn().mockResolvedValue('artboard-web'),
  };
});

import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import { register as registerManageDatasets } from '../../src/tools/modify/manage-datasets.js';
import { register as registerResizeForVariation } from '../../src/tools/modify/resize-for-variation.js';

type Handler = (params: Record<string, unknown>) => Promise<unknown>;
type ToolConfig = { description: string; annotations: Record<string, boolean> };

function captureTool(register: (server: McpServer) => void): { config: ToolConfig; handler: Handler } {
  let config: ToolConfig | undefined;
  let handler: Handler | undefined;
  const server = {
    registerTool: vi.fn((_name: string, c: ToolConfig, h: Handler) => {
      config = c;
      handler = h;
    }),
  } as unknown as McpServer;
  register(server);
  if (!config || !handler) throw new Error('Tool was not registered');
  return { config, handler };
}

async function captureJsx(register: (server: McpServer) => void, heavy: boolean): Promise<string> {
  const { handler } = captureTool(register);
  const mock = vi.mocked(heavy ? executeJsxHeavy : executeJsx);
  mock.mockClear();
  await handler({});
  return mock.mock.calls[0][0] as string;
}

const commonJsx = fs.readFileSync(path.resolve(__dirname, '../../src/jsx/helpers/common.jsx'), 'utf-8');

type Result = Record<string, any>;

/** common.jsx + ツールの JSX を偽の app/doc で実行し、結果オブジェクトを返す */
function runJsx(toolJsx: string, doc: unknown, params: unknown, files: Record<string, string> = {}): Result {
  const code = `
    var app = { version: "30.0", activeDocument: __doc, documents: { length: 1 } };
    function File(p) {
      this.exists = __files.hasOwnProperty(p);
      this.encoding = "";
      this.open = function() { return true; };
      this.read = function() { return __files[p]; };
      this.close = function() {};
    }
    ${commonJsx}
    // 実行基盤の差し替え（common.jsx の同名関数より後に宣言して上書き）
    function preflightChecks() { return null; }
    function readParamsFile() { return __params; }
    function writeResultFile(p, r) { __out.result = r; }
    var PARAMS_PATH = "params.json";
    var RESULT_PATH = "result.json";
    ${toolJsx}
  `;
  const out: { result?: Result } = {};
  // eslint-disable-next-line no-new-func -- test-only: ES3 JSX を Node で評価する
  new Function('__doc', '__params', '__files', '__out', code)(doc, params, files, out); // NOSONAR
  if (!out.result) throw new Error('JSX did not write a result');
  return out.result;
}

// --- 偽の Illustrator オブジェクト ---

type Bounds = [number, number, number, number];
type FakeItem = {
  typename: string;
  name: string;
  note: string;
  contents?: string;
  hidden: boolean;
  geometricBounds: Bounds;
  visibleBounds: Bounds;
  position: [number, number];
  pageItems?: FakeItem[];
  pathItems?: FakeItem[];
  parent: any;
  failDuplicate?: boolean;
  duplicate: () => FakeItem;
  translate: (dx: number, dy: number) => void;
  resize: () => void;
};

function makeItem(typename: string, name: string, bounds: Bounds, extra: Partial<FakeItem> = {}): FakeItem {
  const item: FakeItem = {
    typename,
    name,
    note: '',
    hidden: false,
    geometricBounds: [...bounds] as Bounds,
    visibleBounds: [...bounds] as Bounds,
    position: [bounds[0], bounds[1]],
    parent: null,
    ...extra,
    duplicate() {
      if (item.failDuplicate) throw new Error('duplicate failed');
      const copy = cloneItem(item);
      copy.parent = item.parent;
      item.parent.pageItems.unshift(copy);
      return copy;
    },
    translate(dx: number, dy: number) {
      shift(item, dx, dy);
    },
    resize() {},
  };
  if (item.pageItems) for (const c of item.pageItems) c.parent = item;
  return item;
}

function cloneItem(src: FakeItem): FakeItem {
  const children = src.pageItems ? src.pageItems.map(cloneItem) : undefined;
  return makeItem(src.typename, src.name, src.geometricBounds, {
    note: src.note,
    contents: src.contents,
    pageItems: children,
  });
}

function shift(item: FakeItem, dx: number, dy: number) {
  for (const b of [item.geometricBounds, item.visibleBounds]) {
    b[0] += dx; b[2] += dx; b[1] += dy; b[3] += dy;
  }
  item.position = [item.geometricBounds[0], item.geometricBounds[1]];
  for (const c of item.pageItems ?? []) shift(c, dx, dy);
}

function allItems(items: FakeItem[]): FakeItem[] {
  const out: FakeItem[] = [];
  for (const it of items) {
    out.push(it);
    if (it.pageItems) out.push(...allItems(it.pageItems));
  }
  return out;
}

function makeDoc(artboardRects: Bounds[], items: FakeItem[]) {
  const layer: any = { typename: 'Layer', name: 'Layer 1', visible: true, pageItems: items, layers: [] };
  for (const it of items) it.parent = layer;
  let active = 0;
  const artboards: any = artboardRects.map((r, i) => ({ name: 'AB' + i, artboardRect: [...r] }));
  artboards.add = (rect: Bounds) => {
    const ab = { name: '', artboardRect: [...rect] };
    artboards.push(ab);
    return ab;
  };
  artboards.getActiveArtboardIndex = () => active;
  artboards.setActiveArtboardIndex = (i: number) => { active = i; };
  const doc: any = {
    layers: [layer],
    artboards,
    selection: [] as FakeItem[],
    variables: [],
    dataSets: [],
    selectObjectsOnActiveArtboard() {
      const r = artboards[active].artboardRect;
      doc.selection = layer.pageItems.filter((it: FakeItem) => {
        const b = it.visibleBounds;
        return b[2] >= r[0] && b[0] <= r[2] && b[3] <= r[1] && b[1] >= r[3];
      });
    },
  };
  // doc.pageItems はグループの子も含む全アイテム
  Object.defineProperty(doc, 'pageItems', { get: () => allItems(layer.pageItems) });
  return { doc, layer, getActive: () => active };
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

function uuidsOf(items: FakeItem[]): string[] {
  return items.map((it) => it.note.substring(0, 36)).filter((u) => /^[0-9a-f-]{36}$/.test(u));
}

describe('manage_datasets import_csv', () => {
  function setup() {
    // AB0 = テンプレート、AB1 = 無関係な別アートボード
    const nameFrame = makeItem('TextFrame', 'name', [10, 90, 50, 70], { note: UUID_A + ' user memo', contents: 'TEMPLATE' });
    const title = makeItem('TextFrame', 'title', [10, 60, 50, 40], { note: UUID_B, contents: 'TITLE' });
    const group = makeItem('GroupItem', 'card', [10, 60, 50, 40], { pageItems: [title] });
    const other = makeItem('PathItem', 'other', [210, 90, 250, 70], { note: UUID_C });
    const { doc, layer } = makeDoc([[0, 100, 100, 0], [200, 100, 300, 0]], [nameFrame, group, other]);
    return { doc, layer, nameFrame, title };
  }

  it('テンプレートを書き換えず、行ごとに新しいアートボードへ複製する', async () => {
    const jsx = await captureJsx(registerManageDatasets, false);
    const { doc, nameFrame, title } = setup();
    const result = runJsx(jsx, doc, { action: 'import_csv', file_path: '/data.csv' }, {
      '/data.csv': 'name,title\nAlice,T1\nBob,T2\n',
    });

    expect(result.success).toBe(true);
    // 原本は不変
    expect(nameFrame.contents).toBe('TEMPLATE');
    expect(title.contents).toBe('TITLE');
    expect(doc.artboards[0].name).toBe('AB0');
    // 2 行 → 2 アートボード追加、結果は追加分のみ
    expect(doc.artboards.length).toBe(4);
    expect(result.artboards.map((a: Result) => a.artboard)).toEqual(['Alice', 'Bob']);
    // 既存アートボード（右端 300）と重ならない
    for (const ab of doc.artboards.slice(2)) {
      expect(ab.artboardRect[0]).toBeGreaterThan(300);
    }
  });

  it('アートボード 0 のアイテムだけを複製し、グループ内のテキストにも差し込む', async () => {
    const jsx = await captureJsx(registerManageDatasets, false);
    const { doc } = setup();
    runJsx(jsx, doc, { action: 'import_csv', file_path: '/data.csv' }, {
      '/data.csv': 'name,title\nAlice,T1\nBob,T2\n',
    });

    const items: FakeItem[] = doc.pageItems;
    // 他アートボードの "other" は複製されない
    expect(items.filter((i) => i.name === 'other')).toHaveLength(1);
    // グループの子を二重に複製しない（テンプレート 1 + 行 2）
    expect(items.filter((i) => i.name === 'title')).toHaveLength(3);
    expect(items.filter((i) => i.name === 'title').map((i) => i.contents).sort()).toEqual(['T1', 'T2', 'TITLE']);
    expect(items.filter((i) => i.name === 'name').map((i) => i.contents).sort()).toEqual(['Alice', 'Bob', 'TEMPLATE']);
  });

  it('複製（グループの子を含む）の UUID を振り直し、ユーザーのメモは残す', async () => {
    const jsx = await captureJsx(registerManageDatasets, false);
    const { doc } = setup();
    runJsx(jsx, doc, { action: 'import_csv', file_path: '/data.csv' }, {
      '/data.csv': 'name,title\nAlice,T1\nBob,T2\n',
    });

    const items: FakeItem[] = doc.pageItems;
    const uuids = uuidsOf(items);
    expect(uuids).toHaveLength(7); // name×3, title×3, other×1
    expect(new Set(uuids).size).toBe(uuids.length);
    // 原本は元の UUID のまま
    expect(uuids).toContain(UUID_A);
    expect(uuids).toContain(UUID_B);
    for (const n of items.filter((i) => i.name === 'name')) {
      expect(n.note.endsWith(' user memo')).toBe(true);
    }
  });

  it('XML import は既存の変数・データセットを全置換するため destructive annotation を持つ', () => {
    const { config } = captureTool(registerManageDatasets);
    expect(config.annotations.destructiveHint).toBe(true);
    expect(config.annotations.readOnlyHint).toBe(false);
    // 実装にない自動バインドを説明に書かない
    expect(config.description).not.toMatch(/auto-bound/);
  });
});

describe('resize_for_variation', () => {
  function setup() {
    const child = makeItem('PathItem', 'child', [10, 90, 50, 50], { note: UUID_A + '::ai-mcp:rot=0' });
    const group = makeItem('GroupItem', 'grp', [10, 90, 50, 50], { note: UUID_B, pageItems: [child] });
    const onAb1 = makeItem('PathItem', 'onAb1', [510, 90, 550, 50], { note: UUID_C });
    // コレクション末尾（AB2）は空間的な右端ではない
    const ctx = makeDoc([[0, 100, 100, 0], [500, 100, 600, 0], [200, 100, 300, 0]], [group, onAb1]);
    ctx.doc.artboards.setActiveArtboardIndex(2);
    ctx.doc.selection = [onAb1];
    return { ...ctx, group, onAb1 };
  }

  it('新規アートボードを全アートボードの右端より右に置く', async () => {
    const jsx = await captureJsx(registerResizeForVariation, true);
    const { doc } = setup();
    const result = runJsx(jsx, doc, {
      source_artboard_index: 0,
      target_sizes: [{ width: 200, height: 200 }, { width: 50, height: 50 }],
    });

    expect(result.success).toBe(true);
    const created = doc.artboards.slice(3);
    expect(created).toHaveLength(2);
    expect(created[0].artboardRect[0]).toBeGreaterThanOrEqual(650);
    expect(created[1].artboardRect[0]).toBeGreaterThan(created[0].artboardRect[2]);
  });

  it('複製（グループの子を含む）の UUID を振り直す', async () => {
    const jsx = await captureJsx(registerResizeForVariation, true);
    const { doc } = setup();
    runJsx(jsx, doc, { source_artboard_index: 0, target_sizes: [{ width: 200, height: 200 }] });

    const items: FakeItem[] = doc.pageItems;
    const uuids = uuidsOf(items);
    expect(uuids).toHaveLength(5); // grp×2, child×2, onAb1×1
    expect(new Set(uuids).size).toBe(uuids.length);
    const dupChild = items.filter((i) => i.name === 'child').find((i) => !i.note.startsWith(UUID_A));
    expect(dupChild?.note.endsWith('::ai-mcp:rot=0')).toBe(true);
  });

  it('アクティブアートボードと選択を元に戻す', async () => {
    const jsx = await captureJsx(registerResizeForVariation, true);
    const { doc, getActive, onAb1 } = setup();
    runJsx(jsx, doc, { source_artboard_index: 0, target_sizes: [{ width: 200, height: 200 }] });

    expect(getActive()).toBe(2);
    expect(doc.selection).toEqual([onAb1]);
  });

  it('途中で失敗してもアクティブアートボードと選択を元に戻す', async () => {
    const jsx = await captureJsx(registerResizeForVariation, true);
    const { doc, getActive, onAb1, group } = setup();
    group.failDuplicate = true;
    const result = runJsx(jsx, doc, { source_artboard_index: 0, target_sizes: [{ width: 200, height: 200 }] });

    expect(result.error).toBe(true);
    expect(getActive()).toBe(2);
    expect(doc.selection).toEqual([onAb1]);
  });
});
