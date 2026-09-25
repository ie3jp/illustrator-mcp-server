import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const text = result.content[0].text ?? '';

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
