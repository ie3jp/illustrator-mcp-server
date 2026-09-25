import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn(),
  executeJsxHeavy: vi.fn(),
}));

import { executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import {
  register as registerExport,
  exportPathHelpersJsx,
  validateExportParams,
  MAX_INLINE_IMAGE_BYTES,
} from '../../src/tools/export/export.js';
import { captureInputSchema } from './helpers/tool-schema.js';

type ToolResponse = { content: Array<{ type: string; text?: string; data?: string }> };
type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResponse>;

function captureToolHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const server = {
    registerTool: vi.fn((_name: string, _config: unknown, registeredHandler: ToolHandler) => {
      handler = registeredHandler;
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('Tool handler was not registered');
  return handler;
}

const mockExecuteJsxHeavy = vi.mocked(executeJsxHeavy);
const exportTool = captureToolHandler(registerExport);

// ---------------------------------------------------------------------------
// ExtendScript の最小フェイク
// ---------------------------------------------------------------------------

/** 仮想ファイルシステム: path → 更新時刻(ms) */
type FakeFs = Map<string, number>;

function makeFileClass(fs: FakeFs) {
  class FakeFile {
    fsName: string;
    constructor(path: string) { this.fsName = path; }
    get exists() { return fs.has(this.fsName); }
    get modified() { return fs.has(this.fsName) ? new Date(fs.get(this.fsName)!) : null; }
    get parent() {
      const dir = this.fsName.substring(0, this.fsName.lastIndexOf('/'));
      return {
        exists: true,
        fsName: dir,
        getFiles: () => [...fs.keys()]
          .filter((p) => p.substring(0, p.lastIndexOf('/')) === dir)
          .map((p) => new FakeFile(p)),
      };
    }
  }
  return FakeFile;
}

type Bounds = [number, number, number, number];

class FakeItem {
  visibleBounds: Bounds;
  label: string;
  locked = false;
  constructor(label: string, bounds: Bounds) { this.label = label; this.visibleBounds = bounds; }
  duplicate(layer: FakeLayer) {
    const dup = new FakeItem(this.label, [...this.visibleBounds] as Bounds);
    dup.locked = this.locked;
    layer.items.push(dup);
    return dup;
  }
  translate(dx: number, dy: number) {
    if (this.locked) throw new Error('locked');
    const b = this.visibleBounds;
    this.visibleBounds = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
  }
}

class FakeLayer { items: FakeItem[] = []; }

class FakeDoc {
  name: string;
  path = '';
  documentColorSpace = 'RGB';
  layers = [new FakeLayer()];
  selection: unknown = [];
  closed = false;
  exports: Array<{ path: string; type: string; opts: Record<string, unknown> }> = [];
  artboards: Array<{ name: string; artboardRect: number[] }> & {
    getActiveArtboardIndex: () => number;
    setActiveArtboardIndex: (i: number) => void;
  };
  private activeAb = 0;
  private fs: FakeFs;

  constructor(name: string, fs: FakeFs, artboardNames: string[] = ['Artboard 1']) {
    this.name = name;
    this.fs = fs;
    const abs = artboardNames.map((n) => ({ name: n, artboardRect: [0, 600, 800, 0] })) as FakeDoc['artboards'];
    abs.getActiveArtboardIndex = () => this.activeAb;
    abs.setActiveArtboardIndex = (i: number) => { this.activeAb = i; };
    this.artboards = abs;
  }

  get visibleBounds(): Bounds | null {
    const items = this.layers[0].items;
    if (items.length === 0) return null;
    const b = [...items[0].visibleBounds] as Bounds;
    for (const it of items) {
      b[0] = Math.min(b[0], it.visibleBounds[0]);
      b[1] = Math.max(b[1], it.visibleBounds[1]);
      b[2] = Math.max(b[2], it.visibleBounds[2]);
      b[3] = Math.min(b[3], it.visibleBounds[3]);
    }
    return b;
  }

  exportFile(file: { fsName: string }, type: string, opts: Record<string, unknown>) {
    this.exports.push({ path: file.fsName, type, opts });
    this.fs.set(file.fsName, Date.now());
  }

  close() { this.closed = true; }
}

interface RunResult {
  result: Record<string, unknown>;
  app: { activeDocument: FakeDoc };
  tempDocs: FakeDoc[];
}

function runExportJsx(
  code: string,
  opts: {
    params: Record<string, unknown>;
    doc: FakeDoc;
    fs: FakeFs;
    uuidMap?: Record<string, FakeItem>;
  },
): RunResult {
  let result: Record<string, unknown> = {};
  const tempDocs: FakeDoc[] = [];
  const app = {
    activeDocument: opts.doc,
    documents: {
      add: (_cs: string, w: number, h: number) => {
        const d = new FakeDoc('temp', opts.fs);
        d.artboards[0].artboardRect = [0, h, w, 0];
        tempDocs.push(d);
        app.activeDocument = d;
        return d;
      },
    },
  };
  const globals: Record<string, unknown> = {
    app,
    File: makeFileClass(opts.fs),
    Folder: { fs: 'Macintosh', desktop: { fsName: '/Users/test/Desktop' } },
    PARAMS_PATH: 'params',
    RESULT_PATH: 'result',
    preflightChecks: () => null,
    readParamsFile: () => opts.params,
    writeResultFile: (_p: string, r: Record<string, unknown>) => { result = r; },
    findItemByUUID: (uuid: string) => opts.uuidMap?.[uuid] ?? null,
    ExportOptionsSVG: function ExportOptionsSVG() {},
    ExportOptionsPNG24: function ExportOptionsPNG24() {},
    ExportOptionsJPEG: function ExportOptionsJPEG() {},
    SVGFontSubsetting: { None: 'None' },
    SVGFontType: { OUTLINEFONT: 'OUTLINEFONT' },
    SVGCSSPropertyLocation: { STYLEELEMENTS: 'STYLEELEMENTS', PRESENTATIONATTRIBUTES: 'PRESENTATIONATTRIBUTES' },
    SVGIdType: { SVGIDMINIMAL: 'MIN', SVGIDUNIQUE: 'UNIQUE', SVGIDREGULAR: 'REGULAR' },
    ExportType: { SVG: 'SVG', PNG24: 'PNG24', JPEG: 'JPEG' },
    SaveOptions: { DONOTSAVECHANGES: 'DONOTSAVECHANGES' },
    ElementPlacement: { PLACEATEND: 'PLACEATEND' },
  };
  const names = Object.keys(globals);
  // テスト専用: ES3 JSX を Node で評価する（common-helpers.test.ts と同じパターン）
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, code); // NOSONAR
  fn(...names.map((n) => globals[n]));
  return { result, app, tempDocs };
}

async function captureJsxCode(): Promise<string> {
  mockExecuteJsxHeavy.mockResolvedValue({ success: false });
  await exportTool({ target: 'artboard:0', format: 'svg' });
  return mockExecuteJsxHeavy.mock.calls[0][0] as string;
}

// ---------------------------------------------------------------------------

describe('export schema', () => {
  const schema = captureInputSchema(registerExport);

  it('overwrite は既定で false', () => {
    const parsed = schema.parse({ target: 'artboard:0', format: 'png' }) as { overwrite: boolean };
    expect(parsed.overwrite).toBe(false);
    expect((schema.parse({ target: 'artboard:0', format: 'png', overwrite: 'true' }) as { overwrite: boolean }).overwrite).toBe(true);
  });

  it('scale / dpi は正の数のみ', () => {
    expect(schema.safeParse({ target: 'artboard:0', format: 'png', scale: 0 }).success).toBe(false);
    expect(schema.safeParse({ target: 'artboard:0', format: 'png', raster_options: { dpi: -72 } }).success).toBe(false);
    expect(schema.safeParse({ target: 'artboard:0', format: 'png', scale: 2, raster_options: { dpi: 144 } }).success).toBe(true);
  });
});

describe('validateExportParams', () => {
  it('相対パスを拒否する', () => {
    expect(validateExportParams({ format: 'png', output_path: 'out.png' })).toMatch(/absolute/);
    expect(validateExportParams({ format: 'png', output_path: '/tmp/out.png' })).toBeNull();
  });

  it('SVG の明示パスで非 ASCII ファイル名を拒否する（PNG は許可）', () => {
    expect(validateExportParams({ format: 'svg', output_path: '/tmp/ロゴ.svg' })).toMatch(/non-ASCII/);
    expect(validateExportParams({ format: 'png', output_path: '/tmp/ロゴ.png' })).toBeNull();
  });

  it('dpi × scale の上限を超えたら拒否する', () => {
    expect(validateExportParams({ format: 'png', scale: 10, raster_options: { dpi: 300 } })).toMatch(/exceeds/);
    expect(validateExportParams({ format: 'jpg', scale: 2, raster_options: { dpi: 300 } })).toBeNull();
    // SVG は scale を使わない
    expect(validateExportParams({ format: 'svg', scale: 100 })).toBeNull();
  });
});

describe('export handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('検証エラーは Illustrator を呼ばずに返す', async () => {
    const res = await exportTool({ target: 'artboard:0', format: 'png', output_path: 'relative.png' });
    expect(mockExecuteJsxHeavy).not.toHaveBeenCalled();
    expect(JSON.parse(res.content[0].text!).error).toBe(true);
  });

  it('上限を超える画像は base64 で返さず image_omitted を付ける', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'export-test-'));
    try {
      const big = join(dir, 'big.png');
      writeFileSync(big, Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1));
      mockExecuteJsxHeavy.mockResolvedValue({ success: true, output_path: big, format: 'png' });
      const res = await exportTool({ target: 'artboard:0', format: 'png' });
      expect(res.content.some((c) => c.type === 'image')).toBe(false);
      expect(JSON.parse(res.content[0].text!).image_omitted).toMatch(/inline limit/);

      const small = join(dir, 'small.png');
      writeFileSync(small, Buffer.from([1, 2, 3]));
      mockExecuteJsxHeavy.mockResolvedValue({ success: true, output_path: small, format: 'png' });
      const res2 = await exportTool({ target: 'artboard:0', format: 'png' });
      expect(res2.content.some((c) => c.type === 'image')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('export path helpers (JSX)', () => {
  function loadHelpers(fs: FakeFs) {
    // eslint-disable-next-line no-new-func
    const factory = new Function('File', `${exportPathHelpersJsx}
      return { sanitizeArtboardLabel: sanitizeArtboardLabel, batchOutputPath: batchOutputPath,
               findExistingOutputs: findExistingOutputs, buildBatchResult: buildBatchResult };`); // NOSONAR
    return factory(makeFileClass(fs)) as {
      sanitizeArtboardLabel: (name: string, format: string) => string;
      batchOutputPath: (base: string, ai: number, abName: string, format: string) => string;
      findExistingOutputs: (p: string, format: string, target: string, abs: Array<{ name: string }>) => string[];
      buildBatchResult: (files: string[], failed: Array<{ message: string }>, total: number, format: string) => Record<string, unknown>;
    };
  }

  it('アートボード名から Windows 禁止文字・制御文字も除去する', () => {
    const h = loadHelpers(new Map());
    expect(h.sanitizeArtboardLabel('a/b\\c:d"e<f>g|h?i*j k\u0001', 'png')).toBe('a-b-c-d-e-f-g-h-i-j-k-');
    expect(h.sanitizeArtboardLabel('表紙', 'svg')).toBe('artboard');
    expect(h.sanitizeArtboardLabel('表紙', 'png')).toBe('表紙');
  });

  it('batch のファイル名を組み立てる', () => {
    const h = loadHelpers(new Map());
    expect(h.batchOutputPath('/out/card.png', 1, 'Back Side', 'png')).toBe('/out/card_2-Back-Side.png');
    expect(h.batchOutputPath('C:\\out\\card.jpg', 0, 'A', 'jpg')).toBe('C:\\out\\card_1-A.jpg');
  });

  it('既存ファイル・batch の派生ファイル・SVG のリネーム後ファイルを衝突として検出する', () => {
    const fs: FakeFs = new Map([
      ['/out/a.png', 1],
      ['/out/all_2-B.png', 1],
      ['/out/logo_Artboard-1.svg', 1],
    ]);
    const h = loadHelpers(fs);
    const abs = [{ name: 'A' }, { name: 'B' }];
    expect(h.findExistingOutputs('/out/a.png', 'png', 'uuid', abs)).toEqual(['/out/a.png']);
    expect(h.findExistingOutputs('/out/b.png', 'png', 'uuid', abs)).toEqual([]);
    expect(h.findExistingOutputs('/out/all.png', 'png', 'artboard:all', abs)).toEqual(['/out/all_2-B.png']);
    expect(h.findExistingOutputs('/out/logo.svg', 'svg', 'artboard:0', abs)).toEqual(['/out/logo_Artboard-1.svg']);
    // UUID の SVG はリネームされないので兄弟ファイルは見ない
    expect(h.findExistingOutputs('/out/logo.svg', 'svg', 'uuid', abs)).toEqual([]);
  });

  it('batch は 1 枚でも失敗したら success: false / partial: true', () => {
    const h = loadHelpers(new Map());
    const partial = h.buildBatchResult(['/out/x_1-A.png'], [{ message: 'boom' }], 2, 'png');
    expect(partial.success).toBe(false);
    expect(partial.partial).toBe(true);
    expect(partial.failed_artboards).toHaveLength(1);
    expect(h.buildBatchResult(['/a', '/b'], [], 2, 'png')).toMatchObject({ success: true, count: 2 });
    expect(h.buildBatchResult([], [{ message: 'boom' }], 2, 'png').error).toBe(true);
  });
});

describe('export JSX (fake Illustrator)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setup() {
    const fs: FakeFs = new Map();
    const doc = new FakeDoc('design.ai', fs);
    const target = new FakeItem('target', [100, 500, 340, 340]);
    const other = new FakeItem('other', [0, 600, 800, 0]);
    doc.layers[0].items.push(target, other);
    return { fs, doc, target, other };
  }

  it.each(['svg', 'png', 'jpg'])('UUID + %s は対象だけを一時ドキュメントから書き出す', async (format) => {
    const code = await captureJsxCode();
    const { fs, doc, target } = setup();
    const selectionBefore = [doc.layers[0].items[1]];
    doc.selection = selectionBefore;

    const { result, app, tempDocs } = runExportJsx(code, {
      params: { target: 'uuid-1', format, output_path: `/out/t.${format}`, scale: 1 },
      doc, fs, uuidMap: { 'uuid-1': target },
    });

    expect(result.success).toBe(true);
    expect(result.item_count).toBe(1);
    expect(doc.exports).toHaveLength(0); // 元ドキュメントからは書き出さない
    expect(tempDocs).toHaveLength(1);
    const temp = tempDocs[0];
    expect(temp.exports).toHaveLength(1);
    expect(temp.layers[0].items.map((i) => i.label)).toEqual(['target']);
    expect(temp.artboards[0].artboardRect).toEqual([0, 160, 240, 0]);
    // SVG はリネームを避けるためアートボード書き出しにしない
    if (format === 'svg') expect(temp.exports[0].opts.saveMultipleArtboards).toBeUndefined();
    expect(temp.closed).toBe(true);
    expect(app.activeDocument).toBe(doc);
    expect(doc.selection).toBe(selectionBefore); // 選択状態を変えない
  });

  it('selection は選択中の複数オブジェクトを相対位置を保って書き出す', async () => {
    const code = await captureJsxCode();
    const { fs, doc } = setup();
    const a = new FakeItem('a', [100, 500, 200, 400]);
    const b = new FakeItem('b', [300, 450, 350, 300]);
    const locked = new FakeItem('c', [150, 520, 160, 510]);
    locked.locked = true;
    doc.layers[0].items.push(a, b, locked);
    doc.selection = [a, b, locked];

    const { result, tempDocs } = runExportJsx(code, {
      params: { target: 'selection', format: 'png', output_path: '/out/sel.png', scale: 1 },
      doc, fs,
    });

    expect(result.success).toBe(true);
    expect(doc.exports).toHaveLength(0);
    const temp = tempDocs[0];
    expect(temp.layers[0].items.map((i) => i.label)).toEqual(['a', 'b', 'c']);
    // 選択範囲 [100,520,350,300] → 幅250・高さ220 のアートボードにフィット
    expect(temp.artboards[0].artboardRect).toEqual([0, 220, 250, 0]);
    expect(temp.layers[0].items[1].visibleBounds).toEqual([200, 150, 250, 0]);
  });

  it('テキスト編集中の selection はエラー', async () => {
    const code = await captureJsxCode();
    const { fs, doc } = setup();
    doc.selection = { typename: 'TextRange', length: 3 };
    const { result, tempDocs } = runExportJsx(code, {
      params: { target: 'selection', format: 'png', output_path: '/out/sel.png' },
      doc, fs,
    });
    expect(result.error).toBe(true);
    expect(tempDocs).toHaveLength(0);
  });

  it('明示パスの既存ファイルは overwrite: true がない限り上書きしない', async () => {
    const code = await captureJsxCode();
    const { fs, doc } = setup();
    fs.set('/out/ab.png', 0);

    const denied = runExportJsx(code, {
      params: { target: 'artboard:0', format: 'png', output_path: '/out/ab.png' },
      doc, fs,
    });
    expect(denied.result.error).toBe(true);
    expect(denied.result.existing_files).toEqual(['/out/ab.png']);
    expect(doc.exports).toHaveLength(0);

    const allowed = runExportJsx(code, {
      params: { target: 'artboard:0', format: 'png', output_path: '/out/ab.png', overwrite: true },
      doc, fs,
    });
    expect(allowed.result.success).toBe(true);
    expect(doc.exports).toHaveLength(1);
  });

  it('自動生成パスは batch の派生ファイルとも衝突しない名前を選ぶ', async () => {
    const code = await captureJsxCode();
    const fs: FakeFs = new Map([['/Users/test/Desktop/design_1-Artboard-1.png', 0]]);
    const doc = new FakeDoc('design.ai', fs);
    const { result } = runExportJsx(code, {
      params: { target: 'artboard:all', format: 'png' },
      doc, fs,
    });
    expect(result.success).toBe(true);
    expect(result.files).toEqual(['/Users/test/Desktop/design_2_1-Artboard-1.png']);
  });

  it('アクティブアートボードを元に戻す', async () => {
    const code = await captureJsxCode();
    const fs: FakeFs = new Map();
    const doc = new FakeDoc('design.ai', fs, ['A', 'B', 'C']);
    doc.artboards.setActiveArtboardIndex(2);
    runExportJsx(code, { params: { target: 'artboard:0', format: 'png', output_path: '/out/x.png' }, doc, fs });
    expect(doc.artboards.getActiveArtboardIndex()).toBe(2);
  });
});
