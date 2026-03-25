import { describe, expect, it, beforeEach } from 'vitest';
import {
  resolveCoordinateSystem,
  setSession,
  clearSession,
  getSessionCoordinateSystem,
  getSessionWorkflow,
  detectWorkflow,
} from '../../src/tools/session.js';

describe('session state', () => {
  beforeEach(() => {
    clearSession();
  });

  it('resolveCoordinateSystem returns artboard-web when no session set', () => {
    expect(resolveCoordinateSystem(undefined)).toBe('artboard-web');
  });

  it('resolveCoordinateSystem returns session default when set', () => {
    setSession('print', 'document');
    expect(resolveCoordinateSystem(undefined)).toBe('document');
  });

  it('explicit value overrides session default', () => {
    setSession('print', 'document');
    expect(resolveCoordinateSystem('artboard-web')).toBe('artboard-web');
  });

  it('clearSession resets to null', () => {
    setSession('web', 'artboard-web');
    clearSession();
    expect(getSessionWorkflow()).toBeNull();
    expect(getSessionCoordinateSystem()).toBeNull();
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
