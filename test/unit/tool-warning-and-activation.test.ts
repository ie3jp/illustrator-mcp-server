import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn(),
  executeJsxHeavy: vi.fn(),
}));

vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return {
    ...actual,
    resolveCoordinateSystem: vi.fn().mockResolvedValue('artboard-web'),
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(),
  };
});

import { writeFile } from 'fs/promises';
import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import { register as registerExportPdf } from '../../src/tools/export/export-pdf.js';
import { register as registerExport } from '../../src/tools/export/export.js';
import { register as registerCheckContrast } from '../../src/tools/read/check-contrast.js';
import { register as registerExtractDesignTokens } from '../../src/tools/read/extract-design-tokens.js';
import { register as registerCheckTextConsistency } from '../../src/tools/utility/check-text-consistency.js';
import { register as registerCreateRectangle } from '../../src/tools/modify/create-rectangle.js';
import { register as registerCreateTextFrame } from '../../src/tools/modify/create-text-frame.js';
import { register as registerModifyObject } from '../../src/tools/modify/modify-object.js';
import { register as registerCreateDocument } from '../../src/tools/modify/create-document.js';
import { register as registerPlaceImage } from '../../src/tools/modify/place-image.js';
import { register as registerCreateCropMarks } from '../../src/tools/modify/create-crop-marks.js';
import { register as registerCreatePathText } from '../../src/tools/modify/create-path-text.js';
import { register as registerPlaceColorChips } from '../../src/tools/modify/place-color-chips.js';
import { register as registerPlaceStyleGuide } from '../../src/tools/modify/place-style-guide.js';
import { register as registerManageDatasets } from '../../src/tools/modify/manage-datasets.js';

type ToolResponse = { content: Array<{ type: string; text?: string }> };
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

const mockExecuteJsx = vi.mocked(executeJsx);
const mockExecuteJsxHeavy = vi.mocked(executeJsxHeavy);
const mockWriteFile = vi.mocked(writeFile);

const checkTextConsistency = captureToolHandler(registerCheckTextConsistency);
const checkContrast = captureToolHandler(registerCheckContrast);
const extractDesignTokens = captureToolHandler(registerExtractDesignTokens);
const exportTool = captureToolHandler(registerExport);
const exportPdf = captureToolHandler(registerExportPdf);

function parseTextResult(response: ToolResponse): Record<string, unknown> {
  return JSON.parse(response.content[0].text ?? '') as Record<string, unknown>;
}

describe('post-processed tool warning propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('check_text_consistency の再構成後も warnings を保持する', async () => {
    mockExecuteJsx.mockResolvedValue({
      totalFrames: 0,
      frames: [],
      warnings: ['unverified version'],
    });

    const result = parseTextResult(await checkTextConsistency({}));

    expect(result.warnings).toEqual(['unverified version']);
  });

  it('check_text_consistency は警告がないとき warnings キーを追加しない', async () => {
    mockExecuteJsx.mockResolvedValue({ totalFrames: 0, frames: [] });

    const result = parseTextResult(await checkTextConsistency({}));

    expect(result).not.toHaveProperty('warnings');
  });

  it('check_contrast の自動検出結果に warnings を保持する', async () => {
    mockExecuteJsx.mockResolvedValue({
      colorItems: [],
      warnings: ['unverified version'],
    });

    const result = parseTextResult(await checkContrast({ auto_detect: true }));

    expect(result).toMatchObject({ pairCount: 0, warnings: ['unverified version'] });
  });

  it('extract_design_tokens の文字列出力に全 warnings を含める', async () => {
    mockExecuteJsx.mockResolvedValue({
      fillColors: [],
      strokeColors: [],
      fontEntries: [],
      objectBounds: [],
      warnings: ['first warning', 'second warning'],
    });

    const result = await extractDesignTokens({ format: 'css' });
    const text = result.content.map((c) => c.text ?? '').join('\n\n');

    expect(text).toContain('Warnings:\n- first warning\n- second warning');
  });

  it('extract_design_tokens のファイル書き込み失敗時も warnings を含める', async () => {
    mockExecuteJsx.mockResolvedValue({
      fillColors: [],
      strokeColors: [],
      fontEntries: [],
      objectBounds: [],
      warnings: ['unverified version'],
    });
    mockWriteFile.mockRejectedValue(new Error('disk full'));

    const result = await extractDesignTokens({
      format: 'css',
      output_path: '/tmp/tokens.css',
    });
    const text = result.content[0].text ?? '';

    expect(text).toContain('Failed to write file: disk full');
    expect(text).toContain('Warnings:\n- unverified version');
  });
});

describe('export tool activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteJsxHeavy.mockResolvedValue({ success: false });
  });

  // UUID / selection は duplicate() で一時ドキュメントへ複製する（copy/paste メニューコマンド不使用）
  // ため、どの対象・形式でも前面化しない
  it.each([
    [{ target: '00000000-0000-0000-0000-000000000000', format: 'png' }],
    [{ target: '00000000-0000-0000-0000-000000000000', format: 'jpg' }],
    [{ target: '00000000-0000-0000-0000-000000000000', format: 'svg' }],
    [{ target: 'selection', format: 'png' }],
    [{ target: 'artboard:0', format: 'png' }],
    [{ target: 'artboard:all', format: 'jpg' }],
  ])('export は %o で Illustrator を前面化しない', async (params) => {
    await exportTool(params);

    expect(mockExecuteJsxHeavy).toHaveBeenCalledTimes(1);
    const [code, passed, options] = mockExecuteJsxHeavy.mock.calls[0];
    expect(typeof code).toBe('string');
    expect(passed).toEqual(params);
    expect((options as { activate?: boolean } | undefined)?.activate ?? false).toBe(false);
  });

  it.each([
    [{ options: { marks_style: 'japanese', trim_marks: true } }, true],
    [{ options: { marks_style: 'japanese', trim_marks: false } }, false],
    [{ options: { marks_style: 'roman', trim_marks: true } }, false],
    [{}, false],
  ])('export_pdf はトンボ設定 %o に応じて activate=%s を渡す', async (params, activate) => {
    await exportPdf(params);

    expect(mockExecuteJsxHeavy).toHaveBeenCalledWith(
      expect.any(String),
      params,
      { activate },
    );
  });
});

describe('DOM tool activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteJsx.mockResolvedValue({ success: true });
    mockExecuteJsxHeavy.mockResolvedValue({ success: true });
  });

  // 背面でも 0.3〜4 秒で終わるツールは前面化しない（実測）
  it.each([
    [registerCreateRectangle, { x: 10, y: 20, width: 30, height: 40 }],
    [registerCreateDocument, {}],
    [registerPlaceImage, { file_path: '/tmp/test.png' }],
  ])('DOM handler %s does not request activation', async (register, params) => {
    await captureToolHandler(register)(params);
    const calls = [...mockExecuteJsx.mock.calls, ...mockExecuteJsxHeavy.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0][2]?.activate ?? false).toBe(false);
  });

  // テキスト作成は背面だと 1 API あたり 240 秒待たされる（実測 2026-11:
  // 背面 480014 / 480040 / 480009 ms、前面 0〜2 ms）。前面化は速度のために必要
  it('create_text_frame は前面化を要求する（背面だと 480 秒かかる）', async () => {
    await captureToolHandler(registerCreateTextFrame)({ x: 10, y: 20, contents: 'Test' });
    const calls = [...mockExecuteJsx.mock.calls, ...mockExecuteJsxHeavy.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0][2]?.activate).toBe(true);
  });

  // modify_object は contents を書くときだけ前面化する（位置や色の変更では奪わない）
  it('modify_object は contents 指定時だけ前面化する', async () => {
    const handler = captureToolHandler(registerModifyObject);
    await handler({ uuid: 'test', properties: { position: { x: 10, y: 20 } } });
    let calls = [...mockExecuteJsx.mock.calls, ...mockExecuteJsxHeavy.mock.calls];
    expect(calls[0][2]?.activate).toBe(false);

    vi.clearAllMocks();
    mockExecuteJsx.mockResolvedValue({ success: true });
    mockExecuteJsxHeavy.mockResolvedValue({ success: true });
    await handler({ uuid: 'test', properties: { contents: 'new text' } });
    calls = [...mockExecuteJsx.mock.calls, ...mockExecuteJsxHeavy.mock.calls];
    expect(calls[0][2]?.activate).toBe(true);
  });

  // allowlist（単語の有無）では activate: false への書き換えを検出できない。
  // 前面化が必要なツールは、ハンドラが実際に activate: true を渡すことを 1 本ずつ検証する
  it.each([
    ['create_text_frame', registerCreateTextFrame, { x: 10, y: 20, contents: 'T' }],
    ['create_path_text', registerCreatePathText, { uuid: 'u', contents: 'T' }],
    ['place_color_chips', registerPlaceColorChips, {}],
    ['place_style_guide', registerPlaceStyleGuide, {}],
  ])('%s は前面化を要求する（背面だとテキスト API が 240 秒待つ）', async (_name, register, params) => {
    await captureToolHandler(register)(params as Record<string, unknown>);
    const calls = [...mockExecuteJsx.mock.calls, ...mockExecuteJsxHeavy.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0][2]?.activate).toBe(true);
  });

  // 条件付きのものは、対象 action と非対象 action の両方を押さえる
  it.each([
    ['import_csv', true],
    ['apply_dataset', true],
    ['list_variables', false],
    ['export', false],
  ])('manage_datasets は action=%s のとき activate=%s', async (action, expected) => {
    await captureToolHandler(registerManageDatasets)({ action, file_path: '/tmp/x.csv', dataset_name: 'd' });
    const calls = [...mockExecuteJsx.mock.calls, ...mockExecuteJsxHeavy.mock.calls];
    expect(calls[0][2]?.activate ?? false).toBe(expected);
  });

  it('crop marks still request activation', async () => {
    await captureToolHandler(registerCreateCropMarks)({ style: 'japanese' });
    expect(mockExecuteJsx).toHaveBeenCalledWith(expect.any(String), expect.any(Object), {
      activate: true,
    });
  });
});

/**
 * activate: true は executeMenuCommand を使うツールだけが指定する（前面でないと失敗するため）。
 * 上のハンドラテストは代表例しか押さえられないので、src/tools 全体を走査して
 * 前面化の再混入を検出する。
 */
describe('activation is confined to menu-command tools', () => {
  const SRC_TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/tools');

  function collectTsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return collectTsFiles(full);
      return entry.endsWith('.ts') ? [full] : [];
    });
  }

  /** Windows の path.relative は \\ 区切りを返すので、比較できるよう / に正規化する */
  function toolPath(file: string): string {
    return relative(SRC_TOOLS_DIR, file).split(sep).join('/');
  }

  // activate: true のリテラルだけを見ると activate: cond や { ...opts, activate } をすり抜ける。
  // 「activate という語が出るファイル」の allowlist にして、式・変数・短縮形も拾う
  it('only the menu-command tools mention activate at all', () => {
    const offenders = collectTsFiles(SRC_TOOLS_DIR)
      .filter((file) => /\bactivate\b/.test(readFileSync(file, 'utf8')))
      .map(toolPath)
      .sort();
    // 前面化するのは (1) executeMenuCommand を使うツール (2) テキストフレームを作る、
    // または contents を代入するツール。後者は背面だと 1 API あたり 240 秒待たされる（実測）
    expect(offenders).toEqual([
      'export/export-pdf.ts',
      'modify/create-crop-marks.ts',
      'modify/create-path-text.ts',
      'modify/create-text-frame.ts',
      'modify/manage-datasets.ts',
      'modify/modify-object.ts',
      'modify/place-color-chips.ts',
      'modify/place-style-guide.ts',
      'tool-executor.ts',
    ]);
  });

  it('export_pdf activates only when it needs the trim-mark menu command', () => {
    const src = readFileSync(join(SRC_TOOLS_DIR, 'export/export-pdf.ts'), 'utf8');
    expect(src).toContain('activate: requiresMenuCommandActivation(params)');
  });

  it('前面化する旧文面が残っていない（前面化するツールは新しい文面で説明する）', () => {
    const offenders = collectTsFiles(SRC_TOOLS_DIR)
      .filter((file) => /Illustrator will be activated/.test(readFileSync(file, 'utf8')))
      .map(toolPath)
      .sort();
    expect(offenders).toEqual(['export/export-pdf.ts', 'modify/create-crop-marks.ts']);
  });

  // 前面化するツールは、なぜ前面化するのかを説明文に書く（利用者が驚かないため）
  it('テキスト作成ツールは前面化することを説明文に書いている', () => {
    for (const f of ['modify/create-text-frame.ts', 'modify/create-path-text.ts']) {
      const src = readFileSync(join(SRC_TOOLS_DIR, f), 'utf8');
      expect(src).toContain('brought to the foreground');
    }
  });
});
