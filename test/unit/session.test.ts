import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  resolveCoordinateSystem,
  setSession,
  clearSession,
  invalidateAutoDetectCache,
  getSessionCoordinateSystem,
  getSessionWorkflow,
  detectWorkflow,
  DETECT_SIGNALS_JSX,
} from '../../src/tools/session.js';

// Mock executeJsx for auto-detection tests
vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn(),
}));

import { executeJsx } from '../../src/executor/jsx-runner.js';
const mockExecuteJsx = vi.mocked(executeJsx);

describe('session state', () => {
  beforeEach(() => {
    clearSession();
    mockExecuteJsx.mockReset();
  });

  it('resolveCoordinateSystem auto-detects document for CMYK print documents', async () => {
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/print-doc.ai',
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: 'Japan Color 2001 Coated',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('document');
  });

  it('resolveCoordinateSystem auto-detects artboard-web for RGB document', async () => {
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/web-doc.ai',
      colorMode: 'RGB',
      rulerUnits: 'px',
      rasterEffectResolution: 72,
      colorProfile: 'sRGB IEC61966-2.1',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('artboard-web');
  });

  it('resolveCoordinateSystem returns session default when explicitly set', async () => {
    setSession('print', 'document');
    expect(await resolveCoordinateSystem(undefined)).toBe('document');
    // Should not call JSX when session is explicitly set
    expect(mockExecuteJsx).not.toHaveBeenCalled();
  });

  it('explicit value overrides session default', async () => {
    setSession('print', 'document');
    expect(await resolveCoordinateSystem('artboard-web')).toBe('artboard-web');
  });

  it('clearSession resets to null', () => {
    setSession('web', 'artboard-web');
    clearSession();
    expect(getSessionWorkflow()).toBeNull();
    expect(getSessionCoordinateSystem()).toBeNull();
  });

  it('cache persists when same document, re-detects on document switch', async () => {
    // First call: CMYK document — auto-detects document coords
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/print-doc.ai',
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: '',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('document');

    // Second call: cache validation returns same documentKey — cache hit
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/print-doc.ai',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('document'); // cached

    // Third call: cache validation returns different documentKey — re-detects as web
    mockExecuteJsx.mockResolvedValueOnce({
      documentKey: '/path/to/web-doc.ai',
    }).mockResolvedValueOnce({
      documentKey: '/path/to/web-doc.ai',
      colorMode: 'RGB',
      rulerUnits: 'px',
      rasterEffectResolution: 72,
      colorProfile: 'sRGB',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('artboard-web');

    // After invalidation, also re-detects
    invalidateAutoDetectCache();
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/web-doc.ai',
      colorMode: 'RGB',
      rulerUnits: 'px',
      rasterEffectResolution: 72,
      colorProfile: 'sRGB',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('artboard-web');
  });

  it('cache hit validates documentKey via lightweight JSX', async () => {
    // First call: full detection (1 JSX call) — CMYK → document
    mockExecuteJsx.mockResolvedValueOnce({
      documentKey: '/path/to/print-doc.ai',
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: '',
    });

    const first = await resolveCoordinateSystem(undefined); // populates cache
    expect(mockExecuteJsx).toHaveBeenCalledTimes(1);

    // Second call: cache validation (1 JSX call for documentKey check)
    mockExecuteJsx.mockResolvedValueOnce({
      documentKey: '/path/to/print-doc.ai',
    });
    const second = await resolveCoordinateSystem(undefined);

    // 1 (initial detection) + 1 (cache key validation) = 2 calls
    expect(mockExecuteJsx).toHaveBeenCalledTimes(2);
    expect(first).toBe('document');
    expect(second).toBe('document');
  });

  it('invalidateAutoDetectCache forces re-detection on next call', async () => {
    // First: CMYK doc → document
    mockExecuteJsx.mockResolvedValueOnce({
      documentKey: '/path/to/print-doc.ai',
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: '',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('document');
    expect(mockExecuteJsx).toHaveBeenCalledTimes(1);

    // Invalidate cache (simulates create_document / close_document)
    invalidateAutoDetectCache();

    // Now return RGB doc → artboard-web
    mockExecuteJsx.mockResolvedValueOnce({
      documentKey: '/path/to/web-doc.ai',
      colorMode: 'RGB',
      rulerUnits: 'px',
      rasterEffectResolution: 72,
      colorProfile: 'sRGB',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('artboard-web');
    expect(mockExecuteJsx).toHaveBeenCalledTimes(2);
  });

  it('uses artboard-web without caching when no document is open', async () => {
    mockExecuteJsx.mockResolvedValueOnce({ noDocument: true });
    expect(await resolveCoordinateSystem(undefined)).toBe('artboard-web');

    // キャッシュされていないので、次の呼び出しは検証用 JSX ではなく検出をやり直す
    mockExecuteJsx.mockResolvedValueOnce({
      documentKey: '/path/to/print-doc.ai',
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: '',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('document');
    expect(mockExecuteJsx).toHaveBeenCalledTimes(2);
  });

  // 失敗を artboard-web に黙って落とすと、印刷ドキュメントで座標を取り違えたまま成功してしまう
  it('fails closed when detection JSX fails, with guidance to set coordinate_system', async () => {
    mockExecuteJsx.mockRejectedValue(new Error('connection failed'));
    await expect(resolveCoordinateSystem(undefined)).rejects.toThrow(/connection failed/);
    await expect(resolveCoordinateSystem(undefined)).rejects.toThrow(/coordinate_system|set_workflow/);
  });

  it('does not fail when coordinate_system is given explicitly even if Illustrator is unreachable', async () => {
    mockExecuteJsx.mockRejectedValue(new Error('connection failed'));
    expect(await resolveCoordinateSystem('artboard-web')).toBe('artboard-web');
    expect(mockExecuteJsx).not.toHaveBeenCalled();
  });

  it('re-detects (and fails closed) when cache validation fails and detection also fails', async () => {
    mockExecuteJsx.mockResolvedValueOnce({
      documentKey: '/path/to/print-doc.ai',
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: '',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('document');

    mockExecuteJsx.mockRejectedValue(new Error('Script execution timed out after 30000ms'));
    await expect(resolveCoordinateSystem(undefined)).rejects.toThrow(/timed out/);
  });

});

// --- DETECT_SIGNALS_JSX を偽の Illustrator オブジェクトで評価する ---

const FAKE_RULER_UNITS = {
  Pixels: 1, Points: 2, Millimeters: 3, Centimeters: 4, Inches: 5, Picas: 6, Qs: 7,
};

function runDetectSignalsJsx(app: unknown): Record<string, unknown> | undefined {
  let written: Record<string, unknown> | undefined;
  const fn = new Function(
    'app', 'DocumentColorSpace', 'RulerUnits', 'preflightChecks', 'writeResultFile', 'RESULT_PATH',
    DETECT_SIGNALS_JSX,
  );
  fn(
    app,
    { CMYK: 'CMYK', RGB: 'RGB' },
    FAKE_RULER_UNITS,
    () => null,
    (_path: string, result: Record<string, unknown>) => { written = result; },
    '/tmp/result.json',
  );
  return written;
}

describe('DETECT_SIGNALS_JSX', () => {
  it('maps RulerUnits.Qs to "Q"', () => {
    const result = runDetectSignalsJsx({
      documents: { length: 1 },
      activeDocument: {
        name: 'q.ai',
        fullName: { fsName: '/path/q.ai' },
        documentColorSpace: 'CMYK',
        colorProfileName: 'Japan Color 2001 Coated',
        rulerUnits: FAKE_RULER_UNITS.Qs,
        rasterEffectSettings: { resolution: 300 },
      },
    });
    expect(result?.rulerUnits).toBe('Q');
    expect(result?.documentKey).toBe('/path/q.ai');
  });

  it('reports noDocument (not an error) when no document is open', () => {
    const result = runDetectSignalsJsx({ documents: { length: 0 } });
    expect(result).toEqual({ noDocument: true });
  });
});

describe('detectWorkflow', () => {
  it('detects web: RGB + px + 72dpi + sRGB', () => {
    const hint = detectWorkflow({
      colorMode: 'RGB',
      rulerUnits: 'px',
      rasterEffectResolution: 72,
      colorProfile: 'sRGB IEC61966-2.1',
    });
    expect(hint.detectedWorkflow).toBe('web');
    expect(hint.recommendedCoordinateSystem).toBe('artboard-web');
  });

  it('detects print: CMYK + mm + 300dpi + Japan Color → document coords', () => {
    const hint = detectWorkflow({
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: 'Japan Color 2001 Coated',
    });
    expect(hint.detectedWorkflow).toBe('print');
    expect(hint.recommendedCoordinateSystem).toBe('document');
  });

  it('treats Q (級) as a print unit', () => {
    const hint = detectWorkflow({
      colorMode: 'RGB',
      rulerUnits: 'Q',
      rasterEffectResolution: 300,
      colorProfile: '',
    });
    expect(hint.detectedWorkflow).toBe('print');
    expect(hint.reasoning).toContain('Q units');
  });

  it('detects video: RGB + px + 150dpi', () => {
    const hint = detectWorkflow({
      colorMode: 'RGB',
      rulerUnits: 'px',
      rasterEffectResolution: 150,
      colorProfile: '',
    });
    expect(hint.detectedWorkflow).toBe('video');
    expect(hint.recommendedCoordinateSystem).toBe('artboard-web');
  });

  it('returns unknown when no signals', () => {
    const hint = detectWorkflow({
      colorMode: 'unknown',
      rulerUnits: 'unknown',
      rasterEffectResolution: 0,
      colorProfile: '',
    });
    expect(hint.detectedWorkflow).toBe('unknown');
  });

  it('CMYK alone strongly suggests print', () => {
    const hint = detectWorkflow({
      colorMode: 'CMYK',
      rulerUnits: 'pt',
      rasterEffectResolution: 72,
      colorProfile: '',
    });
    expect(hint.detectedWorkflow).toBe('print');
  });

  it('RGB + inches suggests print over web', () => {
    const hint = detectWorkflow({
      colorMode: 'RGB',
      rulerUnits: 'in',
      rasterEffectResolution: 300,
      colorProfile: '',
    });
    expect(hint.detectedWorkflow).toBe('print');
  });

  it('signals are included in result', () => {
    const signals = {
      colorMode: 'RGB',
      rulerUnits: 'px',
      rasterEffectResolution: 72,
      colorProfile: 'sRGB',
    };
    const hint = detectWorkflow(signals);
    expect(hint.signals).toEqual(signals);
  });

  it('reasoning is non-empty for detected workflows', () => {
    const hint = detectWorkflow({
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: 'Japan Color 2001 Coated',
    });
    expect(hint.reasoning.length).toBeGreaterThan(0);
  });
});
