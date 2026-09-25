/**
 * create_crop_marks / export_pdf のトンボ transaction をフェイク DOM 上で検証する。
 * doc.groupItems は上のレイヤーが先に列挙される（実機確認）ため、ユーザーの既存グループを
 * index 0 に置き、トンボはその後ろに生成する。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn().mockResolvedValue({ success: true }),
  executeJsxHeavy: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return { ...actual, resolveCoordinateSystem: vi.fn().mockResolvedValue('artboard-web') };
});

import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import { resolveCoordinateSystem } from '../../src/tools/session.js';
import { register as registerCropMarks } from '../../src/tools/modify/create-crop-marks.js';
import { register as registerExportPdf } from '../../src/tools/export/export-pdf.js';

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

function captureHandler(register: (server: McpServer) => void): Handler {
  let handler: Handler | undefined;
  const server = {
    registerTool: vi.fn((_n: string, _c: unknown, h: Handler) => {
      handler = h;
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('not registered');
  return handler;
}

// ─── Illustrator DOM のフェイク ───────────────────────────────────────────

type Rect = [number, number, number, number];

interface FakeItem {
  typename: string;
  uuid: string;
  name?: string;
  parent: unknown;
  geometricBounds: Rect;
  removed: boolean;
  filled?: boolean;
  stroked?: boolean;
  selected: boolean;
  remove(): void;
}

let uuidSeq = 0;

function createFakeEnv(opts: { artboards?: Rect[]; cropMarkStylePref?: boolean; presets?: string[] } = {}) {
  const layer = { typename: 'Layer', name: 'Layer 1' };
  const groups: FakeItem[] = [];
  const paths: FakeItem[] = [];
  let selection: FakeItem[] = [];
  const prefs: Record<string, boolean> = { cropMarkStyle: opts.cropMarkStylePref ?? false };
  const artboardRects: Rect[] = (opts.artboards ?? [[0, 842, 595, 0]]).map((r) => [...r] as Rect);
  let activeArtboard = 0;

  function makeItem(typename: string, bounds: Rect, parent: unknown): FakeItem {
    const item: FakeItem = {
      typename,
      uuid: String(++uuidSeq),
      parent,
      geometricBounds: bounds,
      removed: false,
      get selected() {
        return selection.includes(item);
      },
      set selected(v: boolean) {
        if (v && !selection.includes(item)) selection.push(item);
        if (!v) selection = selection.filter((s) => s !== item);
      },
      remove() {
        if (item.removed) throw new Error('already removed');
        item.removed = true;
        selection = selection.filter((s) => s !== item);
        // 子グループも一緒に消える
        for (const g of groups) if (g.parent === item) g.removed = true;
      },
    };
    return item;
  }

  const artboards = {
    get length() {
      return artboardRects.length;
    },
    getActiveArtboardIndex: () => activeArtboard,
    setActiveArtboardIndex: (i: number) => {
      activeArtboard = i;
    },
  } as Record<string | number, unknown>;
  artboardRects.forEach((_r, i) => {
    Object.defineProperty(artboards, i, {
      get: () => ({
        name: 'Artboard ' + (i + 1),
        get artboardRect() {
          return [...artboardRects[i]];
        },
        set artboardRect(r: Rect) {
          artboardRects[i] = [...r] as Rect;
        },
      }),
    });
  });

  const doc = {
    name: 'test.ai',
    path: { fsName: '/tmp' },
    get groupItems() {
      return groups.filter((g) => !g.removed);
    },
    pathItems: {
      rectangle(top: number, left: number, width: number, height: number) {
        const p = makeItem('PathItem', [left, top, left + width, top - height], layer);
        paths.push(p);
        return p;
      },
    },
    get selection() {
      return [...selection];
    },
    set selection(v: FakeItem[] | null) {
      selection = v ? [...v] : [];
    },
    artboards,
    saveAs: vi.fn(),
  };

  // ユーザーの既存グループ（上のレイヤー＝ groupItems の先頭）
  const userGroup = makeItem('GroupItem', [100, 700, 200, 600], { typename: 'Layer', name: 'Top' });
  groups.push(userGroup);
  // ユーザーの選択中オブジェクト
  const userPath = makeItem('PathItem', [10, 800, 50, 760], layer);
  paths.push(userPath);
  selection = [userPath];

  const trimCalls: Array<{ cropMarkStyle: boolean; selection: FakeItem[] }> = [];
  let trimBehavior: 'ok' | 'throw' | 'throwAfterCreate' | 'none' = 'ok';

  /** TrimMark: 選択の外接矩形から 30pt 外側にトンボ（親グループ＋入れ子グループ）を生成する */
  function trimMark() {
    trimCalls.push({ cropMarkStyle: prefs.cropMarkStyle, selection: [...selection] });
    if (trimBehavior === 'throw') throw new Error('Menu command "TrimMark v25" failed');
    if (trimBehavior === 'none') return;
    const b = selection[0].geometricBounds;
    const outer: Rect = [b[0] - 30, b[1] + 30, b[2] + 30, b[3] - 30];
    const parent = makeItem('GroupItem', outer, layer);
    const child = makeItem('GroupItem', [b[0] - 30, b[1] + 30, b[0], b[1]], parent);
    groups.push(parent, child);
    if (trimBehavior === 'throwAfterCreate') throw new Error('boom after create');
  }

  const app = {
    activeDocument: doc,
    locale: 'en_US',
    PDFPresetsList: opts.presets ?? ['[High Quality Print]', '[PDF/X-4:2008]'],
    preferences: {
      getBooleanPreference: (k: string) => prefs[k] ?? false,
      setBooleanPreference: (k: string, v: boolean) => {
        prefs[k] = v;
      },
    },
  };

  return {
    app,
    doc,
    groups,
    paths,
    prefs,
    artboardRects,
    userGroup,
    userPath,
    trimCalls,
    trimMark,
    setTrimBehavior(b: typeof trimBehavior) {
      trimBehavior = b;
    },
    get activeArtboard() {
      return activeArtboard;
    },
    set activeArtboard(i: number) {
      activeArtboard = i;
    },
    get selection() {
      return selection;
    },
  };
}

type Env = ReturnType<typeof createFakeEnv>;

function runJsx(script: string, params: unknown, env: Env): Record<string, unknown> {
  const out: { result?: Record<string, unknown> } = {};
  class FakeFile {
    constructor(public path: string) {}
    get exists() {
      return this.path.endsWith('.pdf') ? env.doc.saveAs.mock.calls.length > 0 : true;
    }
    get parent() {
      return { exists: !this.path.startsWith('/missing/'), fsName: '/missing' };
    }
  }
  const globals = {
    app: env.app,
    File: FakeFile,
    Folder: { fs: 'Macintosh', desktop: { fsName: '/tmp' } },
    PDFSaveOptions: function PDFSaveOptions() {},
    PDFCompatibility: { ACROBAT7: 'ACROBAT7' },
    PageMarksTypes: { Roman: 'Roman', Japanese: 'Japanese' },
    PDFTrimMarkWeight: { TRIMMARKWEIGHT0125: 0.125, TRIMMARKWEIGHT025: 0.25, TRIMMARKWEIGHT05: 0.5 },
    DownsampleMethod: { BICUBICDOWNSAMPLE: 'bicubic', NODOWNSAMPLE: 'none' },
    __params: params,
    __out: out,
    __trim: env.trimMark,
  };
  const names = Object.keys(globals);
  const body = `
    var PARAMS_PATH = "params.json";
    var RESULT_PATH = "result.json";
    function preflightChecks() { return null; }
    function readParamsFile() { return __params; }
    function writeResultFile(p, r) { __out.result = r; }
    function executeTrimMark() { __trim(); }
    ${script}
  `;
  // eslint-disable-next-line no-new-func -- test-only: ES3 JSX をフェイク DOM 上で実行する
  new Function(...names, body)(...names.map((n) => (globals as Record<string, unknown>)[n])); // NOSONAR
  if (!out.result) throw new Error('JSX wrote no result');
  return out.result;
}

const cropMarks = captureHandler(registerCropMarks);
const exportPdf = captureHandler(registerExportPdf);

async function cropMarksScript(params: Record<string, unknown>) {
  vi.mocked(executeJsx).mockClear();
  await cropMarks(params);
  const call = vi.mocked(executeJsx).mock.calls[0];
  return { script: call[0] as string, params: call[1] };
}

async function exportPdfScript(params: Record<string, unknown>) {
  vi.mocked(executeJsxHeavy).mockClear();
  await exportPdf(params);
  const call = vi.mocked(executeJsxHeavy).mock.calls[0];
  return { script: call[0] as string, params: call[1] };
}

beforeEach(() => {
  vi.mocked(resolveCoordinateSystem).mockResolvedValue('artboard-web');
});

// ─── create_crop_marks ───────────────────────────────────────────────────

describe('create_crop_marks transaction', () => {
  it('ユーザーの既存グループではなく新規生成されたトンボでアートボードを拡張する', async () => {
    const env = createFakeEnv();
    const { script, params } = await cropMarksScript({ style: 'japanese' });
    const r = runJsx(script, params, env);

    expect(r.success).toBe(true);
    // 入れ子の子グループは数えない（最上位のトンボグループのみ）
    expect(r.mark_groups_created).toBe(1);
    // トンボ外接矩形（アートボード ±30）+ 1pt。index 0 のユーザーグループ [100,700,200,600] ではない
    expect(env.artboardRects[0]).toEqual([-31, 873, 626, -31]);
    expect(env.userGroup.removed).toBe(false);
  });

  it('仕上がり線を原点込みで返し、bleed 指示は拡張後アートボードを仕上がり線扱いしない', async () => {
    const env = createFakeEnv();
    const { script, params } = await cropMarksScript({ style: 'japanese' });
    const r = runJsx(script, params, env);

    // artboard-web: 拡張後アートボード左上からの相対
    expect(r.original_artboard_rect).toEqual({ x: 31, y: 31, width: 595, height: 842 });
    expect(r.bleed_required).toContain('original_artboard_rect');
    expect(r.bleed_required).not.toMatch(/get_artboards to get the current artboard bounds/);
  });

  it('document 座標系では元アートボードの左上をドキュメント座標で返す', async () => {
    vi.mocked(resolveCoordinateSystem).mockResolvedValue('document');
    const env = createFakeEnv();
    const { script, params } = await cropMarksScript({ style: 'western' });
    const r = runJsx(script, params, env);
    expect(r.original_artboard_rect).toEqual({ x: 0, y: 842, width: 595, height: 842 });
  });

  it('環境設定・選択・アクティブアートボードを成功時も復元し、一時矩形を残さない', async () => {
    const env = createFakeEnv({ artboards: [[0, 842, 595, 0], [700, 842, 1295, 0]], cropMarkStylePref: false });
    env.activeArtboard = 0;
    const { script, params } = await cropMarksScript({ style: 'japanese', artboard_index: 1 });
    const r = runJsx(script, params, env);

    expect(r.success).toBe(true);
    expect(env.trimCalls[0].cropMarkStyle).toBe(true); // 実行中は日本式
    expect(env.prefs.cropMarkStyle).toBe(false); // 実行後は元に戻る
    expect(env.activeArtboard).toBe(0);
    expect(env.selection).toEqual([env.userPath]);
    // 作成された PathItem（一時矩形）は削除済み
    expect(env.paths.filter((p) => p !== env.userPath && !p.removed)).toHaveLength(0);
  });

  it('TrimMark が例外を投げても一時矩形を残さず、環境設定を復元する', async () => {
    const env = createFakeEnv({ cropMarkStylePref: false });
    env.setTrimBehavior('throw');
    const { script, params } = await cropMarksScript({ style: 'japanese' });
    const r = runJsx(script, params, env);

    expect(r.error).toBe(true);
    expect(env.paths.filter((p) => p !== env.userPath && !p.removed)).toHaveLength(0);
    expect(env.prefs.cropMarkStyle).toBe(false);
    expect(env.artboardRects[0]).toEqual([0, 842, 595, 0]);
    expect(env.selection).toEqual([env.userPath]);
  });

  it('生成後に失敗したら生成済みトンボを取り除き、ユーザーのグループは残す', async () => {
    const env = createFakeEnv();
    env.setTrimBehavior('throwAfterCreate');
    const { script, params } = await cropMarksScript({ style: 'japanese' });
    const r = runJsx(script, params, env);

    expect(r.error).toBe(true);
    expect(env.doc.groupItems).toEqual([env.userGroup]);
    expect(env.artboardRects[0]).toEqual([0, 842, 595, 0]);
  });

  it('選択モードでもユーザーのグループを数えず、選択を復元する', async () => {
    const env = createFakeEnv();
    const { script, params } = await cropMarksScript({ style: 'western', use_selection: true });
    const r = runJsx(script, params, env);

    expect(r.success).toBe(true);
    expect(r.mark_groups_created).toBe(1);
    expect(env.trimCalls[0].selection).toEqual([env.userPath]);
    expect(env.selection).toEqual([env.userPath]);
    expect(env.userGroup.removed).toBe(false);
  });
});

// ─── export_pdf ──────────────────────────────────────────────────────────

describe('export_pdf japanese trim marks transaction', () => {
  const japanese = { output_path: '/out/test.pdf', options: { marks_style: 'japanese', trim_marks: true } };

  it('書き出し後の cleanup で生成したトンボだけを削除し、ユーザーのグループは残す', async () => {
    const env = createFakeEnv({ cropMarkStylePref: false });
    let stateAtSave: { rect: Rect; groups: number; trimMarks: unknown } | undefined;
    env.doc.saveAs.mockImplementation((_f: unknown, opts: { trimMarks?: unknown }) => {
      stateAtSave = { rect: [...env.artboardRects[0]] as Rect, groups: env.doc.groupItems.length, trimMarks: opts.trimMarks };
    });
    const { script, params } = await exportPdfScript(japanese);
    const r = runJsx(script, params, env);

    expect(r.success).toBe(true);
    expect(r.japanese_marks_method).toBe('document_trimmark');
    expect(stateAtSave).toEqual({ rect: [-31, 873, 626, -31], groups: 3, trimMarks: false });
    // 書き出し後: トンボは消え、ユーザーのグループは残る
    expect(env.doc.groupItems).toEqual([env.userGroup]);
    expect(env.artboardRects[0]).toEqual([0, 842, 595, 0]);
    expect(env.prefs.cropMarkStyle).toBe(false);
    expect(env.selection).toEqual([env.userPath]);
    expect(env.paths.filter((p) => p !== env.userPath && !p.removed)).toHaveLength(0);
  });

  it('saveAs が失敗しても同じく元に戻す', async () => {
    const env = createFakeEnv();
    env.doc.saveAs.mockImplementation(() => {
      throw new Error('disk full');
    });
    const { script, params } = await exportPdfScript(japanese);
    const r = runJsx(script, params, env);

    expect(r.error).toBe(true);
    expect(env.doc.groupItems).toEqual([env.userGroup]);
    expect(env.artboardRects[0]).toEqual([0, 842, 595, 0]);
  });

  it('複数アートボードの文書ではドキュメントに触れずエラーを返す', async () => {
    const env = createFakeEnv({ artboards: [[0, 842, 595, 0], [700, 842, 1295, 0]] });
    const { script, params } = await exportPdfScript(japanese);
    const r = runJsx(script, params, env);

    expect(r.error).toBe(true);
    expect(String(r.message)).toMatch(/multiple artboards/);
    expect(env.trimCalls).toHaveLength(0);
    expect(env.doc.saveAs).not.toHaveBeenCalled();
  });

  it('TrimMark 失敗時は PDF 側の日本式トンボにフォールバックし、その旨を返す', async () => {
    const env = createFakeEnv({ cropMarkStylePref: false });
    env.setTrimBehavior('throw');
    const { script, params } = await exportPdfScript(japanese);
    const r = runJsx(script, params, env);

    expect(r.success).toBe(true);
    expect(r.japanese_marks_method).toBe('pdf_page_marks');
    const opts = env.doc.saveAs.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.pageMarksType).toBe('Japanese');
    expect(opts.trimMarks).toBe(true);
    expect(env.prefs.cropMarkStyle).toBe(false);
  });
});

describe('export_pdf preset handling', () => {
  it('preset のみ指定したときはトンボ設定を上書きしない', async () => {
    const env = createFakeEnv();
    const { script, params } = await exportPdfScript({ output_path: '/out/test.pdf', preset: '[PDF/X-4:2008]' });
    const r = runJsx(script, params, env);

    expect(r.success).toBe(true);
    const opts = env.doc.saveAs.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.pDFPreset).toBe('[PDF/X-4:2008]');
    expect('trimMarks' in opts).toBe(false);
    expect('trimMarkWeight' in opts).toBe(false);
  });

  it('preset 未指定なら従来どおり trimMarks=false を明示する', async () => {
    const env = createFakeEnv();
    const { script, params } = await exportPdfScript({ output_path: '/out/test.pdf' });
    runJsx(script, params, env);
    const opts = env.doc.saveAs.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.trimMarks).toBe(false);
  });

  it('存在しない preset はエラーにして利用可能な preset を示す', async () => {
    const env = createFakeEnv();
    const { script, params } = await exportPdfScript({ output_path: '/out/test.pdf', preset: '[Nope]' });
    const r = runJsx(script, params, env);

    expect(r.error).toBe(true);
    expect(String(r.message)).toContain('[PDF/X-4:2008]');
    expect(env.doc.saveAs).not.toHaveBeenCalled();
  });
});

describe('export_pdf overwrite guard', () => {
  it('既存ファイルは overwrite: true のときだけ置き換え、それ以外は文書に触れずエラーを返す', async () => {
    const { mkdtempSync, writeFileSync, realpathSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'export-pdf-')));
    const existing = join(dir, 'out.pdf');
    writeFileSync(existing, 'old');

    vi.mocked(executeJsxHeavy).mockClear();
    const refused = (await exportPdf({ output_path: existing })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.content[0].text)).toMatchObject({ error: true, existing_files: [existing] });
    expect(executeJsxHeavy).not.toHaveBeenCalled();

    const { params } = await exportPdfScript({ output_path: existing, overwrite: true });
    expect((params as { output_path: string }).output_path).toBe(existing);
  });
});
