/**
 * データ損失ガードのテスト。ツールが executeJsx に渡す JSX を捕捉し、
 * フェイク DOM 上で Node 実行して検証する。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn(),
  executeJsxHeavy: vi.fn(),
}));

vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return {
    ...actual,
    resolveCoordinateSystem: vi.fn().mockResolvedValue('document'),
    invalidateAutoDetectCache: vi.fn(),
  };
});

import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import { register as registerCloseDocument } from '../../src/tools/modify/close-document.js';
import { register as registerConvertToOutlines } from '../../src/tools/modify/convert-to-outlines.js';
import { register as registerDeleteObjects } from '../../src/tools/modify/delete-objects.js';
import { register as registerGroupObjects } from '../../src/tools/modify/group-objects.js';
import { register as registerAlignObjects } from '../../src/tools/modify/align-objects.js';
import { register as registerMoveToLayer } from '../../src/tools/modify/move-to-layer.js';
import { register as registerApplyGraphicStyle } from '../../src/tools/modify/apply-graphic-style.js';
import { register as registerManageLayers } from '../../src/tools/modify/manage-layers.js';
import { register as registerSaveDocument } from '../../src/tools/modify/save-document.js';
import { register as registerUndo } from '../../src/tools/modify/undo.js';
import { formatToolResult } from '../../src/tools/tool-executor.js';

type Handler = (params: Record<string, unknown>) => Promise<unknown>;
type ToolConfig = { inputSchema: Record<string, z.ZodTypeAny>; annotations?: Record<string, boolean> };

/** 登録されたツールを名前で取り出す（1 モジュールで複数ツールを登録する場合に対応） */
function captureTool(register: (server: McpServer) => void, name: string) {
  let handler: Handler | undefined;
  let config: ToolConfig | undefined;
  const server = {
    registerTool: vi.fn((toolName: string, cfg: ToolConfig, h: Handler) => {
      if (toolName === name) {
        handler = h;
        config = cfg;
      }
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler || !config) throw new Error(`Tool ${name} was not registered`);
  return { handler, config, schema: z.object(config.inputSchema) };
}

const mockExecuteJsx = vi.mocked(executeJsx);
const mockExecuteJsxHeavy = vi.mocked(executeJsxHeavy);

/** ツールのハンドラを呼び、executeJsx に渡った JSX コードと params を返す */
async function captureJsx(register: (server: McpServer) => void, name: string, rawParams: Record<string, unknown>) {
  const tool = captureTool(register, name);
  const params = tool.schema.parse(rawParams) as Record<string, unknown>;
  mockExecuteJsx.mockResolvedValue({});
  mockExecuteJsxHeavy.mockResolvedValue({});
  await tool.handler(params);
  const call = mockExecuteJsx.mock.calls.at(-1) ?? mockExecuteJsxHeavy.mock.calls.at(-1);
  if (!call) throw new Error('executeJsx was not called');
  return { code: call[0] as string, params: call[1] as Record<string, unknown> };
}

type Globals = Record<string, unknown>;

// executeJsx に渡る JSX には common.jsx が含まれないため、使うヘルパーは本物を読み込んで注入する
const COMMON_JSX = readFileSync(resolve(__dirname, '../../src/jsx/helpers/common.jsx'), 'utf-8');
// eslint-disable-next-line no-new-func -- test-only: evaluating repo-local ES3 helpers in Node.js
const commonLayerHelpers = new Function(
  `${COMMON_JSX}\nreturn { findTopLevelLayerIndices: findTopLevelLayerIndices, resolveTopLevelLayer: resolveTopLevelLayer, collectAllItems: collectAllItems };`,
)() as Globals; // NOSONAR

/** JSX コードをフェイクグローバルの上で実行し、writeResultFile に渡された結果を返す */
function runJsx(code: string, params: Record<string, unknown>, globals: Globals): Record<string, unknown> {
  let result: Record<string, unknown> | undefined;
  const base: Globals = {
    PARAMS_PATH: '/tmp/params.json',
    RESULT_PATH: '/tmp/result.json',
    readParamsFile: () => JSON.parse(JSON.stringify(params)),
    writeResultFile: (_p: string, r: Record<string, unknown>) => {
      result = r;
    },
    preflightChecks: () => null,
    checkIllustratorVersion: () => null,
    findItemByUUID: () => null,
    verifyItem: (item: { uuid?: string }) => ({ uuid: item.uuid }),
    ensureUUID: () => 'group-uuid',
    extractUUIDFromNote: (note: string) => (note && note.length >= 36 ? note.substring(0, 36) : ''),
    getParentLayerName: () => 'Layer 1',
    isItemEffectivelyLocked: (item: { locked?: boolean; parent?: unknown }) => {
      for (let o = item as { locked?: boolean; parent?: unknown; typename?: string } | undefined; o && o.typename !== 'Document'; o = o.parent as typeof o) {
        if (o.locked === true) return true;
      }
      return false;
    },
    getItemType: () => 'path',
    getActiveArtboardRect: () => null,
    getArtboardRectByIndex: () => [0, 0, 100, -100],
    _uuidIndex: null,
    SaveOptions: { SAVECHANGES: 'SAVE', DONOTSAVECHANGES: 'DONOTSAVE' },
    ElementPlacement: { PLACEATBEGINNING: 'BEGIN', PLACEATEND: 'END', PLACEBEFORE: 'BEFORE', PLACEAFTER: 'AFTER' },
    Folder: { desktop: { fsName: '/Users/test/Desktop' }, fs: 'Macintosh' },
    ...commonLayerHelpers,
    ...globals,
  };
  const names = Object.keys(base);
  // eslint-disable-next-line no-new-func -- test-only: executing embedded ES3 JSX against fakes
  const fn = new Function(...names, code); // NOSONAR
  fn(...names.map((n) => base[n]));
  if (!result) throw new Error('writeResultFile was not called');
  return result;
}

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe('close_document: 未保存の変更を黙って破棄しない', () => {
  function makeApp(saved: boolean) {
    const close = vi.fn();
    return { app: { documents: { length: 1 }, activeDocument: { name: 'work.ai', saved, close } }, close };
  }

  it('save を省略すると parse 後も undefined のまま（false に既定しない）', () => {
    const { schema } = captureTool(registerCloseDocument, 'close_document');
    expect((schema.parse({}) as { save?: boolean }).save).toBeUndefined();
    expect((schema.parse({ save: 'false' }) as { save?: boolean }).save).toBe(false);
  });

  it('未保存の変更があり save 省略ならエラーを返し、閉じない', async () => {
    const { code, params } = await captureJsx(registerCloseDocument, 'close_document', {});
    const { app, close } = makeApp(false);
    const result = runJsx(code, params, { app });
    expect(result.error).toBe(true);
    expect(result.unsavedChanges).toBe(true);
    expect(String(result.message)).toContain('save: true');
    expect(String(result.message)).toContain('save: false');
    expect(close).not.toHaveBeenCalled();
  });

  it('save: false を明示すれば意図的な破棄として閉じる', async () => {
    const { code, params } = await captureJsx(registerCloseDocument, 'close_document', { save: false });
    const { app, close } = makeApp(false);
    const result = runJsx(code, params, { app });
    expect(close).toHaveBeenCalledWith('DONOTSAVE');
    expect(result.success).toBe(true);
    expect(result.discardedChanges).toBe(true);
  });

  it('save: true なら保存して閉じる', async () => {
    const { code, params } = await captureJsx(registerCloseDocument, 'close_document', { save: true });
    const { app, close } = makeApp(false);
    const result = runJsx(code, params, { app });
    expect(close).toHaveBeenCalledWith('SAVE');
    expect(result.discardedChanges).toBe(false);
  });

  it('変更がなければ save 省略でも閉じる', async () => {
    const { code, params } = await captureJsx(registerCloseDocument, 'close_document', {});
    const { app, close } = makeApp(true);
    const result = runJsx(code, params, { app });
    expect(close).toHaveBeenCalledWith('DONOTSAVE');
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('convert_to_outlines: 失敗を隠さない', () => {
  it('変換できなかったテキストを UUID と理由つきで返し、success を false にする', async () => {
    const { code, params } = await captureJsx(registerConvertToOutlines, 'convert_to_outlines', { target: 'all' });
    const ok = { name: 'ok', note: UUID_A, createOutline: vi.fn() };
    const locked = {
      name: 'locked text',
      note: UUID_B + ' memo',
      createOutline: vi.fn(() => {
        throw new Error('Target layer cannot be modified');
      }),
    };
    const app = { activeDocument: { textFrames: [ok, locked] } };
    const result = runJsx(code, params, { app });
    expect(ok.createOutline).toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.convertedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failed).toEqual([
      { uuid: UUID_B, name: 'locked text', layer: 'Layer 1', reason: 'Target layer cannot be modified' },
    ]);
  });

  it('ロックされたテキスト（レイヤーのロックを含む）は createOutline が成功しうるので変換しない', async () => {
    const { code, params } = await captureJsx(registerConvertToOutlines, 'convert_to_outlines', { target: 'all' });
    const lockedLayer = { typename: 'Layer', name: 'L', locked: true, parent: { typename: 'Document' } };
    const self = { typename: 'TextFrame', name: 'self', note: UUID_A, locked: true, createOutline: vi.fn() };
    const inLocked = { typename: 'TextFrame', name: 'inLocked', note: UUID_B, parent: lockedLayer, createOutline: vi.fn() };
    const app = { activeDocument: { textFrames: [self, inLocked] } };
    const result = runJsx(code, params, { app });
    expect(self.createOutline).not.toHaveBeenCalled();
    expect(inLocked.createOutline).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(2);
  });

  it('同名レイヤーを target にすると最上位のテキストだけを変換し、警告を返す', async () => {
    const { code, params } = await captureJsx(registerConvertToOutlines, 'convert_to_outlines', { target: 'T' });
    const topTf = { typename: 'TextFrame', note: '', createOutline: vi.fn() };
    const lowerTf = { typename: 'TextFrame', note: '', createOutline: vi.fn() };
    const layers = [
      { name: 'T', pageItems: [topTf], layers: [] },
      { name: 'T', pageItems: [lowerTf], layers: [] },
    ];
    const result = runJsx(code, params, { app: { activeDocument: { layers } } });
    expect(topTf.createOutline).toHaveBeenCalled();
    expect(lowerTf.createOutline).not.toHaveBeenCalled();
    expect(result.convertedCount).toBe(1);
    expect((result.warnings as string[])[0]).toContain("2 top-level layers are named 'T'");
  });

  it('全件成功なら success: true', async () => {
    const { code, params } = await captureJsx(registerConvertToOutlines, 'convert_to_outlines', { target: 'all' });
    const app = { activeDocument: { textFrames: [{ note: '', createOutline: vi.fn() }] } };
    const result = runJsx(code, params, { app });
    expect(result.success).toBe(true);
    expect(result.failed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('delete_objects: notFound を success 判定に含める', () => {
  it('全 UUID が存在しなければ success: false', async () => {
    const { code, params } = await captureJsx(registerDeleteObjects, 'delete_objects', { uuids: [UUID_MISSING] });
    const result = runJsx(code, params, { app: { activeDocument: {} } });
    expect(result.success).toBe(false);
    expect(result.deletedCount).toBe(0);
    expect(result.notFound).toEqual([UUID_MISSING]);
  });

  it('description が undo による完全な復元を約束しない', () => {
    const { config } = captureTool(registerDeleteObjects, 'delete_objects');
    expect((config as unknown as { description: string }).description).not.toContain('Reversible with the undo tool');
  });
});

// ---------------------------------------------------------------------------

describe('複数 UUID 操作の欠落報告', () => {
  function itemsById(map: Record<string, unknown>) {
    return (uuid: string) => map[uuid] ?? null;
  }

  it('group_objects: 1 件でも欠けたら何もグループ化せずエラー', async () => {
    const { code, params } = await captureJsx(registerGroupObjects, 'group_objects', {
      uuids: [UUID_A, UUID_MISSING],
      clipped: true,
    });
    const add = vi.fn();
    const a = { uuid: UUID_A, layer: { groupItems: { add } }, move: vi.fn() };
    const result = runJsx(code, params, { app: { activeDocument: {} }, findItemByUUID: itemsById({ [UUID_A]: a }) });
    expect(result.error).toBe(true);
    expect(result.notFound).toEqual([UUID_MISSING]);
    expect(add).not.toHaveBeenCalled();
    expect(a.move).not.toHaveBeenCalled();
  });

  it('align_objects: 1 件でも欠けたら何も動かさずエラー', async () => {
    const { code, params } = await captureJsx(registerAlignObjects, 'align_objects', {
      uuids: [UUID_A, UUID_B, UUID_MISSING],
      alignment: 'left',
    });
    const mk = (uuid: string, left: number) => {
      const it: Record<string, unknown> = { uuid, geometricBounds: [left, 0, left + 10, -10] };
      let pos: unknown;
      Object.defineProperty(it, 'position', { get: () => pos, set: (v) => { pos = v; it.moved = true; } });
      return it;
    };
    const a = mk(UUID_A, 0);
    const b = mk(UUID_B, 50);
    const result = runJsx(code, params, {
      app: { activeDocument: {} },
      findItemByUUID: itemsById({ [UUID_A]: a, [UUID_B]: b }),
    });
    expect(result.error).toBe(true);
    expect(result.notFound).toEqual([UUID_MISSING]);
    expect(a.moved).toBeUndefined();
    expect(b.moved).toBeUndefined();
  });

  it('move_to_layer: 見つかったものは移動し、欠落と失敗を返す', async () => {
    const { code, params } = await captureJsx(registerMoveToLayer, 'move_to_layer', {
      uuids: [UUID_A, UUID_B, UUID_MISSING],
      target_layer: 'Dest',
    });
    const a = { uuid: UUID_A, move: vi.fn() };
    const b = { uuid: UUID_B, move: vi.fn(() => { throw new Error('locked'); }) };
    const dest = { name: 'Dest' };
    const app = { activeDocument: { layers: [{ name: 'Other' }, dest] } };
    const result = runJsx(code, params, { app, findItemByUUID: itemsById({ [UUID_A]: a, [UUID_B]: b }) });
    expect(a.move).toHaveBeenCalledWith(dest, 'BEGIN');
    expect(result.success).toBe(false);
    expect(result.movedCount).toBe(1);
    expect(result.notFound).toEqual([UUID_MISSING]);
    expect(result.errors).toEqual([{ uuid: UUID_B, message: 'locked' }]);
    expect(result.verified).toEqual([{ uuid: UUID_A }]);
    expect(result.warnings).toBeUndefined();
  });

  it('move_to_layer: 同名レイヤーが複数あれば最上位へ移動し、警告を返す', async () => {
    const { code, params } = await captureJsx(registerMoveToLayer, 'move_to_layer', {
      uuids: [UUID_A],
      target_layer: 'Dest',
    });
    const a = { uuid: UUID_A, move: vi.fn() };
    const top = { name: 'Dest' };
    const lower = { name: 'Dest' };
    const app = { activeDocument: { layers: [{ name: 'Other' }, top, lower] } };
    const result = runJsx(code, params, { app, findItemByUUID: itemsById({ [UUID_A]: a }) });
    expect(a.move).toHaveBeenCalledWith(top, 'BEGIN');
    expect(result.success).toBe(true);
    expect((result.warnings as string[])[0]).toContain("2 top-level layers are named 'Dest'");
  });

  it('move_to_layer: レイヤーがなければエラーで何も動かさない', async () => {
    const { code, params } = await captureJsx(registerMoveToLayer, 'move_to_layer', {
      uuids: [UUID_A],
      target_layer: 'Nope',
    });
    const a = { uuid: UUID_A, move: vi.fn() };
    const result = runJsx(code, params, { app: { activeDocument: { layers: [{ name: 'Dest' }] } }, findItemByUUID: itemsById({ [UUID_A]: a }) });
    expect(result.error).toBe(true);
    expect(a.move).not.toHaveBeenCalled();
  });

  it('apply_graphic_style: 見つかったものに適用し、欠落を返す', async () => {
    const { code, params } = await captureJsx(registerApplyGraphicStyle, 'apply_graphic_style', {
      style_name: 'S',
      uuids: [UUID_A, UUID_MISSING],
    });
    const style = { applyTo: vi.fn(), mergeTo: vi.fn() };
    const a = { uuid: UUID_A };
    const app = { activeDocument: { graphicStyles: { getByName: () => style } } };
    const result = runJsx(code, params, { app, findItemByUUID: itemsById({ [UUID_A]: a }) });
    expect(style.applyTo).toHaveBeenCalledWith(a);
    expect(result.success).toBe(false);
    expect(result.appliedCount).toBe(1);
    expect(result.notFound).toEqual([UUID_MISSING]);
  });
});

// ---------------------------------------------------------------------------

/**
 * group_objects 用のフェイク DOM。pageItems は前面→背面（index 0 が最前面）。
 * ElementPlacement: BEGIN=最前面 / END=最背面 / BEFORE=参照の前面 / AFTER=参照の背面
 */
type FakeNode = {
  typename: string;
  name: string;
  uuid?: string;
  parent: FakeNode | null;
  pageItems: FakeNode[];
  locked: boolean;
  visible: boolean;
  hidden: boolean;
  clipping?: boolean;
  clipped?: boolean;
  groupItems: { add: () => FakeNode };
  move: (ref: FakeNode, placement: string) => FakeNode;
  remove: () => void;
  /** 失敗注入: move の直前に呼ばれる（throw で move 失敗） */
  onMove?: (ref: FakeNode, placement: string) => void;
};

function makeGroupDom() {
  const created: FakeNode[] = [];
  const detach = (n: FakeNode) => {
    if (!n.parent) return;
    const arr = n.parent.pageItems;
    const i = arr.indexOf(n);
    if (i >= 0) arr.splice(i, 1);
    n.parent = null;
  };
  const node = (typename: string, name: string, parent: FakeNode | null, uuid?: string): FakeNode => {
    const n: FakeNode = {
      typename,
      name,
      uuid,
      parent: null,
      pageItems: [],
      locked: false,
      visible: true,
      hidden: false,
      groupItems: {
        add: () => {
          const g = node('GroupItem', '', null);
          g.clipped = false;
          g.parent = n;
          n.pageItems.unshift(g);
          created.push(g);
          return g;
        },
      },
      move(ref, placement) {
        this.onMove?.(ref, placement);
        detach(this);
        if (placement === 'END' || placement === 'BEGIN') {
          if (placement === 'END') ref.pageItems.push(this);
          else ref.pageItems.unshift(this);
          this.parent = ref;
        } else {
          const container = ref.parent as FakeNode;
          const i = container.pageItems.indexOf(ref);
          container.pageItems.splice(placement === 'BEFORE' ? i : i + 1, 0, this);
          this.parent = container;
        }
        return this;
      },
      remove() {
        detach(this);
      },
    };
    if (parent) {
      n.parent = parent;
      parent.pageItems.push(n);
    }
    return n;
  };
  const doc = node('Document', 'doc', null);
  const layer = (name: string) => node('Layer', name, doc);
  const item = (container: FakeNode, uuid: string, typename = 'PathItem') => {
    const n = node(typename, uuid.slice(0, 4), container, uuid);
    if (typename === 'PathItem') n.clipping = false;
    return n;
  };
  return { layer, item, node, created };
}

describe('group_objects: 変更前の検証と失敗時のロールバック', () => {
  const U = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
  const [UA, UB, UC, UX, UY, UZ] = ['a', 'b', 'c', 'd', 'e', 'f'].map(U);

  async function run(rawParams: Record<string, unknown>, nodes: FakeNode[], globals: Globals = {}) {
    const { code, params } = await captureJsx(registerGroupObjects, 'group_objects', rawParams);
    const byId = Object.fromEntries(nodes.map((n) => [n.uuid, n]));
    return runJsx(code, params, {
      app: { activeDocument: {} },
      findItemByUUID: (uuid: string) => byId[uuid] ?? null,
      ...globals,
    });
  }
  const ids = (arr: FakeNode[]) => arr.map((n) => n.uuid ?? n.typename);

  it('同じ親の中で、最前面の対象があった位置にグループを置く（末尾 UUID が最前面）', async () => {
    const { layer, item } = makeGroupDom();
    const L = layer('L1');
    const nodes = [UX, UA, UY, UB, UZ].map((u) => item(L, u));
    const result = await run({ uuids: [UA, UB], name: 'G' }, nodes);
    expect(result.success).toBe(true);
    expect(ids(L.pageItems)).toEqual([UX, 'GroupItem', UY, UZ]);
    const g = L.pageItems[1];
    expect(g.name).toBe('G');
    expect(ids(g.pageItems)).toEqual([UB, UA]);
  });

  it('最前面の対象が親の先頭ならグループも先頭に置く', async () => {
    const { layer, item } = makeGroupDom();
    const L = layer('L1');
    const nodes = [UA, UX, UB].map((u) => item(L, u));
    const result = await run({ uuids: [UB, UA] }, nodes);
    expect(result.success).toBe(true);
    expect(ids(L.pageItems)).toEqual(['GroupItem', UX]);
    expect(ids(L.pageItems[0].pageItems)).toEqual([UA, UB]);
  });

  it('親が違うアイテム（別レイヤー・別グループ）は何も変更せずエラー', async () => {
    const { layer, item, node, created } = makeGroupDom();
    const L1 = layer('L1');
    const L2 = layer('L2');
    const a = item(L1, UA);
    const b = item(L2, UB);
    const inner = node('GroupItem', 'inner', L1);
    const c = item(inner, UC);
    const result = await run({ uuids: [UA, UB, UC] }, [a, b, c]);
    expect(result.error).toBe(true);
    expect(result.expectedParent).toEqual({ parentType: 'Layer', parentName: 'L1' });
    expect(result.differentParents).toEqual([
      { uuid: UB, parentType: 'Layer', parentName: 'L2' },
      { uuid: UC, parentType: 'GroupItem', parentName: 'inner' },
    ]);
    expect(created).toHaveLength(0);
    expect(a.parent).toBe(L1);
    expect(b.parent).toBe(L2);
    expect(c.parent).toBe(inner);
  });

  it('ロック中・ロックされた親・非表示レイヤーのアイテムは何も変更せずエラー', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const a = dom.item(L, UA);
    const b = dom.item(L, UB);
    b.locked = true;
    let result = await run({ uuids: [UA, UB] }, [a, b]);
    expect(result.error).toBe(true);
    expect(result.locked).toEqual([UB]);

    b.locked = false;
    L.locked = true;
    result = await run({ uuids: [UA, UB] }, [a, b]);
    expect(result.locked).toEqual([UA, UB]);

    L.locked = false;
    L.visible = false;
    result = await run({ uuids: [UA, UB] }, [a, b]);
    expect(result.error).toBe(true);
    expect(result.hiddenLayer).toEqual([UA, UB]);
    expect(dom.created).toHaveLength(0);
    expect(ids(L.pageItems)).toEqual([UA, UB]);
  });

  it('同じアイテムの重複指定・既存クリップグループのクリップパスは拒否', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const a = dom.item(L, UA);
    let result = await run({ uuids: [UA, UA] }, [a]);
    expect(result.error).toBe(true);
    expect(String(result.message)).toContain('more than once');

    // pageItems[0] が最前面＝クリップパス
    const clipGroup = dom.node('GroupItem', 'clip', L);
    clipGroup.clipped = true;
    const mask = dom.item(clipGroup, UC);
    const content = dom.item(clipGroup, UB);
    mask.clipping = true;
    result = await run({ uuids: [UB, UC] }, [content, mask]);
    expect(result.error).toBe(true);
    expect(result.clippingPaths).toEqual([UC]);
    expect(dom.created).toHaveLength(0);

    // UI で作ったテキストのマスクは clipping を持たないので、最前面の位置で判定する
    const textClip = dom.node('GroupItem', 'textclip', L);
    textClip.clipped = true;
    const textMask = dom.item(textClip, UX, 'TextFrame');
    const textContent = dom.item(textClip, UY);
    result = await run({ uuids: [UY, UX] }, [textContent, textMask]);
    expect(result.error).toBe(true);
    expect(result.clippingPaths).toEqual([UX]);
    expect(dom.created).toHaveLength(0);
  });

  it('clipped: true は 2 件以上・末尾がパス/複合パス/テキストでなければ何も変更せずエラー', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const a = dom.item(L, UA);
    const g = dom.item(L, UB, 'GroupItem');
    let result = await run({ uuids: [UA], clipped: true }, [a]);
    expect(result.error).toBe(true);
    expect(String(result.message)).toContain('at least 2');

    result = await run({ uuids: [UA, UB], clipped: true }, [a, g]);
    expect(result.error).toBe(true);
    expect(String(result.message)).toContain('GroupItem');
    expect(dom.created).toHaveLength(0);
    expect(ids(L.pageItems)).toEqual([UA, UB]);
  });

  it('clipped: true でテキストをクリップパスにしようとしたら、アウトライン化を案内して何も変更しない', async () => {
    // スクリプトの group.clipped = true はテキストを受け付けない（2026 / macOS 実機で確認）
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const a = dom.item(L, UA);
    const t = dom.item(L, UB, 'TextFrame');
    const result = await run({ uuids: [UA, UB], clipped: true }, [a, t]);
    expect(result.error).toBe(true);
    expect(String(result.message)).toContain('convert_to_outlines');
    expect(dom.created).toHaveLength(0);
  });

  it('途中の move が失敗したら元の親・重ね順へ戻し、空グループを削除する（isError の JSON で返る）', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const nodes = [UA, UX, UB, UY, UC].map((u) => dom.item(L, u));
    nodes[4].onMove = () => {
      throw new Error('boom');
    };
    const result = await run({ uuids: [UA, UB, UC] }, nodes);
    expect(result.error).toBe(true);
    expect(String(result.message)).toContain('boom');
    expect(String(result.message)).toContain('rolled back');
    expect(result.rollback).toMatchObject({ complete: true, groupRemoved: true, failed: [], restored: [UA, UB] });
    expect(ids(L.pageItems)).toEqual([UA, UX, UB, UY, UC]);
    expect(dom.created[0].parent).toBeNull();

    const formatted = formatToolResult(result);
    expect(formatted.isError).toBe(true);
    expect(JSON.parse(formatted.content[0].text).rollback.complete).toBe(true);
  });

  it('グループ内のアイテム同士をグループ化でき、失敗時はそのグループ内の元の位置へ戻す', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const outer = dom.node('GroupItem', 'outer', L);
    const nodes = [UA, UB, UX].map((u) => dom.item(outer, u));
    const ok = await run({ uuids: [UB, UA] }, nodes);
    expect(ok.success).toBe(true);
    expect(ids(outer.pageItems)).toEqual(['GroupItem', UX]);

    const dom2 = makeGroupDom();
    const outer2 = dom2.node('GroupItem', 'outer', dom2.layer('L1'));
    const nodes2 = [UA, UB, UX].map((u) => dom2.item(outer2, u));
    const failed = await run({ uuids: [UB, UA] }, nodes2, {
      ensureUUID: () => {
        throw new Error('note write failed');
      },
    });
    expect(failed.error).toBe(true);
    expect(failed.rollback).toMatchObject({ complete: true });
    expect(ids(outer2.pageItems)).toEqual([UA, UB, UX]);
  });

  function clipFailsAfterStrippingPaint(L: FakeNode, mask: FakeNode) {
    const origAdd = L.groupItems.add;
    L.groupItems.add = () => {
      const g = origAdd();
      Object.defineProperty(g, 'clipped', {
        get: () => false,
        set: (v: boolean) => {
          if (v) {
            // 実機と同じく、クリップパスにした時点で塗り/線が消える
            mask.clipping = true;
            mask.filled = false;
            mask.stroked = false;
            throw new Error('clip failed');
          }
        },
        configurable: true,
      });
      return g;
    };
  }

  it('group.clipped = true が例外なら戻し、クリップパスの clipping と塗り/線も控えから戻す', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const content = dom.item(L, UA);
    const mask = dom.item(L, UB);
    const red = { typename: 'RGBColor', red: 255 };
    const black = { typename: 'RGBColor', red: 0 };
    Object.assign(mask, { filled: true, fillColor: red, stroked: true, strokeColor: black, strokeWidth: 3 });
    clipFailsAfterStrippingPaint(L, mask);
    const result = await run({ uuids: [UA, UB], clipped: true }, [content, mask]);
    expect(result.error).toBe(true);
    expect(result.rollback).toMatchObject({ complete: true, appearanceRestored: true });
    expect((result.rollback as { warning?: string }).warning).toBeUndefined();
    expect(mask).toMatchObject({ clipping: false, filled: true, fillColor: red, stroked: true, strokeColor: black, strokeWidth: 3 });
    expect(ids(L.pageItems)).toEqual([UA, UB]);
  });

  it('塗り/線を戻せなければ complete: false と警告を返す（元に戻ったとは言わない）', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const content = dom.item(L, UA);
    const mask = dom.item(L, UB);
    Object.assign(mask, { filled: true, fillColor: { typename: 'RGBColor' }, stroked: false });
    clipFailsAfterStrippingPaint(L, mask);
    const origFill = { value: mask.fillColor };
    Object.defineProperty(mask, 'fillColor', {
      get: () => origFill.value,
      set: () => { throw new Error('cannot set fillColor'); },
      configurable: true,
    });
    const result = await run({ uuids: [UA, UB], clipped: true }, [content, mask]);
    expect(result.error).toBe(true);
    expect(result.rollback).toMatchObject({ complete: false, appearanceRestored: false });
    expect(String((result.rollback as { warning?: string }).warning)).toContain('fill/stroke');
    expect(String(result.message)).toContain('incomplete');
    expect(ids(L.pageItems)).toEqual([UA, UB]);
  });

  it('成功の結果を組み立てる途中（verifyItem）で失敗したら、変更を確定せずに戻す', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const nodes = [UA, UB].map((u) => dom.item(L, u));
    const result = await run({ uuids: [UA, UB] }, nodes, {
      verifyItem: () => { throw new Error('bounds unavailable'); },
    });
    expect(result.error).toBe(true);
    expect(String(result.message)).toContain('bounds unavailable');
    expect(result.rollback).toMatchObject({ complete: true, groupRemoved: true });
    expect(ids(L.pageItems)).toEqual([UA, UB]);
  });

  it('group.clipped = true が黙って無視されたら成功扱いにせず戻す', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const content = dom.item(L, UA);
    const mask = dom.item(L, UB);
    const origAdd = L.groupItems.add;
    L.groupItems.add = () => {
      const g = origAdd();
      Object.defineProperty(g, 'clipped', { get: () => false, set: () => {}, configurable: true });
      return g;
    };
    const result = await run({ uuids: [UA, UB], clipped: true }, [content, mask]);
    expect(result.error).toBe(true);
    expect(String(result.message)).toContain('did not turn the group into a clipping group');
    expect(ids(L.pageItems)).toEqual([UA, UB]);
    expect(dom.created[0].parent).toBeNull();
  });

  it('戻す move も失敗したらグループを消さず、残ったグループと失敗を返す', async () => {
    const dom = makeGroupDom();
    const L = dom.layer('L1');
    const a = dom.item(L, UA);
    const b = dom.item(L, UB);
    const result = await run({ uuids: [UA, UB] }, [a, b], {
      ensureUUID: (item: FakeNode) => {
        if (item.typename === 'GroupItem' && !a.onMove) {
          a.onMove = () => {
            throw new Error('stuck');
          };
          throw new Error('note write failed');
        }
        return 'group-uuid';
      },
    });
    expect(result.error).toBe(true);
    expect(String(result.message)).toContain('Rollback was incomplete');
    const rb = result.rollback as Record<string, unknown>;
    expect(rb.complete).toBe(false);
    expect(rb.groupRemoved).toBe(false);
    expect(rb.failed).toEqual([{ uuid: UA, message: 'stuck' }]);
    expect(rb.restored).toEqual([UB]);
    expect(rb.remainingGroupUuid).toBe('group-uuid');
    expect(L.pageItems[0].typename).toBe('GroupItem');
    expect(ids(L.pageItems[0].pageItems)).toEqual([UA]);
  });
});

// ---------------------------------------------------------------------------

/** Illustrator の Layers コレクションを模したフェイク（move は配列内の並べ替えとして再現） */
function makeLayers(names: string[]) {
  type FakeLayer = {
    name: string;
    visible: boolean;
    locked: boolean;
    pageItems: unknown[];
    move: (ref: FakeLayer, placement: string) => void;
    remove: () => void;
  };
  const layers = [] as unknown as FakeLayer[] & {
    add: () => FakeLayer;
    getByName: (n: string) => FakeLayer;
  };
  const make = (name: string): FakeLayer => {
    const layer: FakeLayer = {
      name,
      visible: true,
      locked: false,
      pageItems: [],
      move(ref, placement) {
        layers.splice(layers.indexOf(layer), 1);
        const refIdx = layers.indexOf(ref);
        layers.splice(placement === 'AFTER' ? refIdx + 1 : refIdx, 0, layer);
      },
      remove() {
        layers.splice(layers.indexOf(layer), 1);
      },
    };
    return layer;
  };
  for (const n of names) layers.push(make(n));
  layers.add = () => {
    const l = make('Layer');
    layers.unshift(l);
    return l;
  };
  layers.getByName = (n: string) => {
    const found = layers.find((l) => l.name === n);
    if (!found) throw new Error('No such element');
    return found;
  };
  return layers;
}

describe('manage_layers', () => {
  async function run(params: Record<string, unknown>, names: string[]) {
    const captured = await captureJsx(registerManageLayers, 'manage_layers', params);
    const layers = makeLayers(names);
    const result = runJsx(captured.code, captured.params, { app: { activeDocument: { layers } } });
    return { result, order: layers.map((l) => l.name), layers };
  }

  it.each([
    ['A', 2, ['B', 'C', 'A', 'D']],
    ['A', 3, ['B', 'C', 'D', 'A']],
    ['A', 1, ['B', 'A', 'C', 'D']],
    ['D', 1, ['A', 'D', 'B', 'C']],
    ['D', 0, ['D', 'A', 'B', 'C']],
    ['B', 1, ['A', 'B', 'C', 'D']],
    ['A', 99, ['B', 'C', 'D', 'A']],
  ])('reorder %s → position %i', async (layer, position, expected) => {
    const { result, order } = await run({ action: 'reorder', layer_name: layer, position }, ['A', 'B', 'C', 'D']);
    expect(order).toEqual(expected);
    expect(result.success).toBe(true);
    expect(result.position).toBe(expected.indexOf(layer as string));
  });

  it('同名レイヤーの delete は曖昧としてエラーにし、何も消さない', async () => {
    const { result, order } = await run({ action: 'delete', layer_name: 'X' }, ['X', 'Y', 'X']);
    expect(result.error).toBe(true);
    expect(result.positions).toEqual([0, 2]);
    expect(order).toEqual(['X', 'Y', 'X']);
  });

  it('同名レイヤーの hide は最上位に作用し、警告を返す', async () => {
    const { result, layers } = await run({ action: 'hide', layer_name: 'X' }, ['Y', 'X', 'X']);
    expect(result.success).toBe(true);
    expect(layers[1].visible).toBe(false);
    expect(layers[2].visible).toBe(true);
    expect((result.warnings as string[])[0]).toContain('2 top-level layers');
  });

  it('既存名で add すると警告を返す', async () => {
    const { result, order } = await run({ action: 'add', layer_name: 'X' }, ['X']);
    expect(result.success).toBe(true);
    expect(order).toEqual(['X', 'X']);
    expect((result.warnings as string[]).length).toBe(1);
  });

  it('存在しないレイヤーはエラーと既存レイヤー一覧を返す', async () => {
    const { result } = await run({ action: 'lock', layer_name: 'Nope' }, ['A']);
    expect(result.error).toBe(true);
    expect(result.existing_layers).toEqual(['A']);
  });
});

// ---------------------------------------------------------------------------

describe('save_document', () => {
  function makeFile(existing: string[]) {
    return class FakeFile {
      fsName: string;
      exists: boolean;
      constructor(p: string) {
        this.fsName = p;
        this.exists = existing.includes(p);
      }
    };
  }

  it('パス省略時は非冪等なので idempotentHint を立てない', () => {
    const { config } = captureTool(registerSaveDocument, 'save_document');
    expect(config.annotations?.idempotentHint).toBe(false);
  });

  it('save_as の明示パスに既存ファイルがあれば保存せずエラー', async () => {
    const { code, params } = await captureJsx(registerSaveDocument, 'save_document', {
      mode: 'save_as',
      path: '/no-such-dir-for-test/existing.ai',
    });
    const saveAs = vi.fn();
    const app = { activeDocument: { saveAs } };
    const result = runJsx(code, params, { app, File: makeFile(['/no-such-dir-for-test/existing.ai']) });
    expect(result.error).toBe(true);
    expect(result.fileExists).toBe(true);
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('overwrite: true なら既存ファイルに保存する', async () => {
    const { code, params } = await captureJsx(registerSaveDocument, 'save_document', {
      mode: 'save_as',
      path: '/no-such-dir-for-test/existing.ai',
      overwrite: true,
    });
    const saveAs = vi.fn();
    const app = { activeDocument: { saveAs } };
    const result = runJsx(code, params, { app, File: makeFile(['/no-such-dir-for-test/existing.ai']) });
    expect(saveAs).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.overwritten).toBe(true);
  });

  it('save_as の相対パスは Illustrator を呼ばずにエラー', async () => {
    const tool = captureTool(registerSaveDocument, 'save_document');
    const res = (await tool.handler(tool.schema.parse({ mode: 'save_as', path: 'out.ai' }))) as {
      content: Array<{ text: string }>;
    };
    expect(res.content[0].text).toContain('path must be an absolute path');
    expect(mockExecuteJsx).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('undo', () => {
  it('途中で失敗しても実行済みステップ数を返す', async () => {
    const { code, params } = await captureJsx(registerUndo, 'undo', { count: 5 });
    let n = 0;
    const app = {
      undo: vi.fn(() => {
        n++;
        if (n === 3) throw new Error('Nothing to undo');
      }),
    };
    const result = runJsx(code, params, { app });
    expect(result.error).toBe(true);
    expect(result.count).toBe(2);
    expect(result.requestedCount).toBe(5);
  });

  it('全ステップ成功なら count は実行数', async () => {
    const { code, params } = await captureJsx(registerUndo, 'undo', { count: 2 });
    const result = runJsx(code, params, { app: { undo: vi.fn() } });
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
  });
});
