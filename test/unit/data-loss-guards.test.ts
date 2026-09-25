/**
 * 修正計画 T3（データ損失の停止）の回帰テスト
 *
 * 各ツールが executeJsx に渡す JSX コードを捕捉し、Illustrator DOM を模した
 * フェイクオブジェクトの上で Node.js で実行して結果を検証する。
 * （JSX はこのリポジトリのソースのみ。new Function はテスト専用）
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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
    getItemType: () => 'path',
    getActiveArtboardRect: () => null,
    getArtboardRectByIndex: () => [0, 0, 100, -100],
    _uuidIndex: null,
    SaveOptions: { SAVECHANGES: 'SAVE', DONOTSAVECHANGES: 'DONOTSAVE' },
    ElementPlacement: { PLACEATBEGINNING: 'BEGIN', PLACEATEND: 'END', PLACEBEFORE: 'BEFORE', PLACEAFTER: 'AFTER' },
    Folder: { desktop: { fsName: '/Users/test/Desktop' }, fs: 'Macintosh' },
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
    const app = { activeDocument: { layers: { getByName: () => dest } } };
    const result = runJsx(code, params, { app, findItemByUUID: itemsById({ [UUID_A]: a, [UUID_B]: b }) });
    expect(a.move).toHaveBeenCalledWith(dest, 'BEGIN');
    expect(result.success).toBe(false);
    expect(result.movedCount).toBe(1);
    expect(result.notFound).toEqual([UUID_MISSING]);
    expect(result.errors).toEqual([{ uuid: UUID_B, message: 'locked' }]);
    expect(result.verified).toEqual([{ uuid: UUID_A }]);
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
      path: '/tmp/existing.ai',
    });
    const saveAs = vi.fn();
    const app = { activeDocument: { saveAs } };
    const result = runJsx(code, params, { app, File: makeFile(['/tmp/existing.ai']) });
    expect(result.error).toBe(true);
    expect(result.fileExists).toBe(true);
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('overwrite: true なら既存ファイルに保存する', async () => {
    const { code, params } = await captureJsx(registerSaveDocument, 'save_document', {
      mode: 'save_as',
      path: '/tmp/existing.ai',
      overwrite: true,
    });
    const saveAs = vi.fn();
    const app = { activeDocument: { saveAs } };
    const result = runJsx(code, params, { app, File: makeFile(['/tmp/existing.ai']) });
    expect(saveAs).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.overwritten).toBe(true);
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
