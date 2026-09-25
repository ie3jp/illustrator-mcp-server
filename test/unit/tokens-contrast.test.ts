import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn(),
  executeJsxHeavy: vi.fn(),
}));

import { executeJsx } from '../../src/executor/jsx-runner.js';
import { register as registerCheckContrast } from '../../src/tools/read/check-contrast.js';
import { register as registerExtractDesignTokens } from '../../src/tools/read/extract-design-tokens.js';
import { captureInputSchema } from './helpers/tool-schema.js';

type ToolResponse = { isError?: boolean; content: Array<{ type: string; text?: string }> };
type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResponse>;

function captureTool(register: (server: McpServer) => void) {
  let handler: ToolHandler | undefined;
  let config: { annotations?: Record<string, boolean> } | undefined;
  const server = {
    registerTool: vi.fn((_name: string, cfg: typeof config, h: ToolHandler) => {
      config = cfg;
      handler = h;
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler || !config) throw new Error('Tool was not registered');
  return { handler, config };
}

const mockExecuteJsx = vi.mocked(executeJsx);
const contrast = captureTool(registerCheckContrast).handler;
const tokensTool = captureTool(registerExtractDesignTokens);
const tokens = tokensTool.handler;

const parse = (r: ToolResponse) => JSON.parse(r.content[0].text ?? '') as Record<string, unknown>;
const textOf = (r: ToolResponse) => r.content.map((c) => c.text ?? '').join('\n\n');

const emptyTokens = { fillColors: [], strokeColors: [], fontEntries: [], objectBounds: [] };

describe('extract_design_tokens', () => {
  const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tokens-test-'));
  afterAll(() => fsSync.rmSync(tmpDir, { recursive: true, force: true }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ファイルを書き込むツールなので readOnlyHint を立てない', () => {
    expect(tokensTool.config.annotations?.readOnlyHint).toBe(false);
  });

  it('overwrite は既定で false', () => {
    const schema = captureInputSchema(registerExtractDesignTokens);
    expect(schema.parse({}).overwrite).toBe(false);
    expect(schema.parse({ overwrite: 'false' }).overwrite).toBe(false);
  });

  it('既存ファイルは overwrite なしでは上書きしない', async () => {
    mockExecuteJsx.mockResolvedValue(emptyTokens);
    const file = path.join(tmpDir, 'existing.css');
    fsSync.writeFileSync(file, 'ORIGINAL');

    const res = await tokens({ format: 'css', output_path: file });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('already exists');
    expect(fsSync.readFileSync(file, 'utf-8')).toBe('ORIGINAL');

    const res2 = await tokens({ format: 'css', output_path: file, overwrite: true });
    expect(res2.isError).toBeUndefined();
    expect(fsSync.readFileSync(file, 'utf-8')).toContain(':root {');
  });

  it('新規ファイルは書き込み、相対パスは拒否する', async () => {
    mockExecuteJsx.mockResolvedValue(emptyTokens);
    const file = path.join(tmpDir, 'new.json');
    const res = await tokens({ format: 'json', output_path: file });
    expect(textOf(res)).toContain(`Saved to: ${file}`);
    expect(fsSync.existsSync(file)).toBe(true);

    const rel = await tokens({ format: 'json', output_path: 'relative/tokens.json' });
    expect(rel.isError).toBe(true);
    expect(textOf(rel)).toContain('absolute path');
  });

  it('特色は元の色と濃度から hex にし、変換できない色は CSS に出さない', async () => {
    mockExecuteJsx.mockResolvedValue({
      ...emptyTokens,
      fillColors: [
        { type: 'spot', name: 'PANTONE 185 C', tint: 100, color: { type: 'cmyk', c: 0, m: 100, y: 100, k: 0 } },
        { type: 'spot', name: 'PANTONE 185 C', tint: 100, color: { type: 'cmyk', c: 0, m: 100, y: 100, k: 0 } },
        { type: 'lab', l: 50, a: 20, b: 10 },
      ],
    });
    const text = textOf(await tokens({ format: 'css' }));
    expect(text).toContain('--color-primary: #FF0000;');
    expect(text).not.toMatch(/--color-[\w-]+: (spot|lab)\(/);
    expect(text).toContain('Skipped colors with no sRGB equivalent: lab(50,20,10)');
  });

  it('spacing は pageItems の列挙順に依存しない', async () => {
    // 同じ行に 10pt 間隔で並んだ 3 つの矩形（Illustrator 座標: top > bottom）
    const row = [
      { left: 0, top: 100, right: 50, bottom: 50 },
      { left: 60, top: 100, right: 110, bottom: 50 },
      { left: 120, top: 100, right: 170, bottom: 50 },
    ];
    mockExecuteJsx.mockResolvedValueOnce({ ...emptyTokens, objectBounds: row });
    const forward = textOf(await tokens({ format: 'css' }));
    mockExecuteJsx.mockResolvedValueOnce({ ...emptyTokens, objectBounds: [...row].reverse() });
    const reversed = textOf(await tokens({ format: 'css' }));

    expect(forward).toBe(reversed);
    expect(forward).toContain('--spacing-10: 10pt;');
    // 縦方向は重なっているので隙間ではない
    expect(forward).not.toContain('--spacing-50');
  });
});

describe('check_contrast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CMYK を含む比較は近似扱いにして AA/AAA を断定しない', async () => {
    const res = parse(await contrast({
      color1: { type: 'cmyk', c: 0, m: 0, y: 0, k: 100 },
      color2: { type: 'rgb', r: 255, g: 255, b: 255 },
    }));
    expect(res).toMatchObject({ contrastRatio: 21, approximate: true, wcagAA_normal: null, wcagAAA: null });
    expect(res.approximationNote).toBeDefined();
  });

  it('RGB 同士なら WCAG 判定を返す', async () => {
    const res = parse(await contrast({
      color1: { type: 'rgb', r: 0, g: 0, b: 0 },
      color2: { type: 'rgb', r: 255, g: 255, b: 255 },
    }));
    expect(res).toMatchObject({ contrastRatio: 21, approximate: false, wcagAA_normal: true, wcagAAA: true });
  });

  it('成分が欠けた色は NaN ではなくエラーを返す', async () => {
    const res = parse(await contrast({
      color1: { type: 'rgb', r: 0 },
      color2: { type: 'rgb', r: 255, g: 255, b: 255 },
    }));
    expect(res).toMatchObject({ error: true });
    expect(String(res.message)).toContain('r, g, b');
  });

  it('引数なし・片方だけ・手動と自動の併用はエラー', async () => {
    expect(parse(await contrast({ auto_detect: false }))).toMatchObject({ error: true });
    expect(parse(await contrast({ color1: { type: 'rgb', r: 0, g: 0, b: 0 } }))).toMatchObject({ error: true });
    expect(parse(await contrast({
      color1: { type: 'rgb', r: 0, g: 0, b: 0 },
      color2: { type: 'rgb', r: 255, g: 255, b: 255 },
      auto_detect: true,
    }))).toMatchObject({ error: true });
    expect(mockExecuteJsx).not.toHaveBeenCalled();
  });

  it('自動検出: 画像・グラデーション背景は unevaluatedPairs に載せ、特色は近似で評価する', async () => {
    const text = (uuid: string) => ({
      uuid, name: uuid, type: 'text',
      bounds: { left: 10, top: 20, right: 20, bottom: 10 },
      fillColor: { type: 'rgb', r: 0, g: 0, b: 0 }, strokeColor: null,
    });
    const bg = (uuid: string, fillColor: Record<string, unknown>, type = 'path') => ({
      uuid, name: uuid, type,
      bounds: { left: 0, top: 100, right: 100, bottom: 0 },
      fillColor, strokeColor: null,
    });
    mockExecuteJsx.mockResolvedValue({
      colorItems: [
        text('t1'),
        bg('img', { type: 'image' }, 'image'),
        bg('spotBg', { type: 'spot', name: 'S', tint: 50, color: { type: 'cmyk', c: 0, m: 0, y: 0, k: 0 } }),
      ],
      skippedHidden: 2,
    });
    const res = parse(await contrast({ auto_detect: true }));
    expect(res.pairCount).toBe(1);
    expect((res.pairs as Array<Record<string, unknown>>)[0]).toMatchObject({
      approximate: true, wcagAA_normal: null,
    });
    expect(res.unevaluatedPairCount).toBe(1);
    expect((res.unevaluatedPairs as Array<Record<string, unknown>>)[0].reason).toContain('image');
    expect(res.skippedHiddenCount).toBe(2);
    expect(res.limitations).toBeDefined();
  });
});
