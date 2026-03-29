import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  resolveCoordinateSystem,
  setSession,
  clearSession,
  invalidateAutoDetectCache,
  getSessionCoordinateSystem,
  getSessionWorkflow,
  detectWorkflow,
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

  it('resolveCoordinateSystem auto-detects from document when no session set', async () => {
    // Simulate a CMYK print document
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
    // First call: CMYK document — full detection
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

    // Third call: cache validation returns different documentKey — re-detects
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
    // First call: full detection (1 JSX call)
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
    // First: CMYK doc (1 JSX call for full detection)
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

    // Now return RGB doc (1 JSX call for full detection, no cache to validate)
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

  it('falls back to artboard-web on JSX error', async () => {
    mockExecuteJsx.mockResolvedValue({ error: true, message: 'No document' });
    expect(await resolveCoordinateSystem(undefined)).toBe('artboard-web');
  });

  it('falls back to artboard-web on JSX rejection', async () => {
    mockExecuteJsx.mockRejectedValue(new Error('connection failed'));
    expect(await resolveCoordinateSystem(undefined)).toBe('artboard-web');
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

  it('detects print: CMYK + mm + 300dpi + Japan Color', () => {
    const hint = detectWorkflow({
      colorMode: 'CMYK',
      rulerUnits: 'mm',
      rasterEffectResolution: 300,
      colorProfile: 'Japan Color 2001 Coated',
    });
    expect(hint.detectedWorkflow).toBe('print');
    expect(hint.recommendedCoordinateSystem).toBe('document');
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
