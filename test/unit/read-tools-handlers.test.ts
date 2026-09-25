/**
 * 読み取り系ツール（修正計画 T9）の Node 側後処理を、JSX 実行をモックして検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../../src/executor/jsx-runner.js', () => ({ executeJsx: vi.fn() }));
vi.mock('../../src/utils/image-header.js', () => ({ readImageDimensions: vi.fn() }));

import { executeJsx } from '../../src/executor/jsx-runner.js';
import { readImageDimensions } from '../../src/utils/image-header.js';
import { register as registerTextFrameDetail } from '../../src/tools/read/get-text-frame-detail.js';
import { register as registerGetImages } from '../../src/tools/read/get-images.js';

type Handler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function captureHandler(register: (server: McpServer) => void): Handler {
  let handler: Handler | undefined;
  const server = {
    registerTool: vi.fn((_name: string, _config: unknown, h: Handler) => {
      handler = h;
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('handler not registered');
  return handler;
}

function run(overrides: Record<string, unknown>) {
  return {
    text: 'あいう',
    fontFamily: 'Hiragino', fontStyle: 'W3', fontSize: 10, color: { type: 'none' },
    tracking: 0, kerningMethod: 'auto', akiLeft: -1, akiRight: -1, tsume: 0,
    proportionalMetrics: false, baselineShift: 0, horizontalScale: 100, verticalScale: 100, rotation: 0,
    ...overrides,
  };
}

function detailResult(runs: unknown[], extra: Record<string, unknown> = {}) {
  return {
    uuid: 'u', contents: 'あいう', x: 0, y: 0, width: 10, height: 10, textKind: 'point',
    orientation: 'horizontal', characterRuns: runs, kerningPairs: [],
    paragraphAttributes: [{ justification: 'left', leading: 0, autoLeading: false, autoLeadingAmount: null }],
    ...extra,
  };
}

describe('get_text_frame_detail post-processing', () => {
  const handler = captureHandler(registerTextFrameDetail);
  beforeEach(() => vi.mocked(executeJsx).mockReset());

  it('does not map tsume to "palt" (tsume is not proportional metrics)', async () => {
    vi.mocked(executeJsx).mockResolvedValue(detailResult([run({ tsume: 50 })]));
    const res = await handler({ uuid: 'u', coordinate_system: 'artboard-web' });
    const json = JSON.parse(res.content[1].text);
    expect(json.characterRuns[0].cssHints?.['font-feature-settings']).toBeUndefined();
    expect(res.content[0].text).not.toContain('font-feature-settings');
    expect(res.content[0].text).toContain('ツメ');
  });

  it('maps proportionalMetrics to "palt"', async () => {
    vi.mocked(executeJsx).mockResolvedValue(detailResult([run({ proportionalMetrics: true })]));
    const res = await handler({ uuid: 'u', coordinate_system: 'artboard-web' });
    const json = JSON.parse(res.content[1].text);
    expect(json.characterRuns[0].cssHints['font-feature-settings']).toBe('"palt"');
    expect(res.content[0].text).toContain('font-feature-settings: "palt"');
  });

  it('uses auto leading amount and vertical writing mode in CSS hints', async () => {
    vi.mocked(executeJsx).mockResolvedValue(detailResult([run({})], {
      orientation: 'vertical',
      paragraphAttributes: [{ justification: 'left', leading: 12, autoLeading: true, autoLeadingAmount: 175 }],
    }));
    const res = await handler({ uuid: 'u', coordinate_system: 'artboard-web' });
    expect(res.content[0].text).toContain('line-height: 1.75');
    expect(res.content[0].text).toContain('writing-mode: vertical-rl');
  });
});

describe('get_images post-processing (linked images)', () => {
  const handler = captureHandler(registerGetImages);
  beforeEach(() => {
    vi.mocked(executeJsx).mockReset();
    vi.mocked(readImageDimensions).mockReset();
  });

  it('reports per-axis resolution instead of the misleading scaleFactor', async () => {
    // 1px = 0.24pt（300ppi）で等倍配置
    vi.mocked(executeJsx).mockResolvedValue({
      imageCount: 1, coordinateSystem: 'artboard-web',
      images: [{
        type: 'linked', filePath: '/img.png', linkBroken: false, pixelWidth: null, pixelHeight: null,
        resolution: null, matrixScaleX: 0.24, matrixScaleY: 0.48, widthPt: 240, heightPt: 240,
      }],
    });
    vi.mocked(readImageDimensions).mockReturnValue({ width: 1000, height: 500 } as never);
    const res = await handler({ coordinate_system: 'artboard-web', include_print_info: true });
    const img = JSON.parse(res.content[0].text).images[0];
    expect(img.scaleFactor).toBeUndefined();
    expect(img.resolutionH).toBe(300);
    expect(img.resolutionV).toBe(150);
    expect(img.resolution).toBe(150);
    expect(img.matrixScaleX).toBeUndefined();
  });

  it('does not read a broken link', async () => {
    vi.mocked(executeJsx).mockResolvedValue({
      imageCount: 1, coordinateSystem: 'artboard-web',
      images: [{ type: 'linked', filePath: '/gone.png', linkBroken: true, pixelWidth: null, pixelHeight: null, resolution: null }],
    });
    await handler({ coordinate_system: 'artboard-web' });
    expect(readImageDimensions).not.toHaveBeenCalled();
  });
});
