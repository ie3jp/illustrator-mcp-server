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
    // Simulate a print document
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/print-doc.indd',
      intent: 'print',
      pageWidth: 595,
      pageHeight: 842,
      facingPages: true,
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('page-relative');
  });

  it('resolveCoordinateSystem auto-detects for digital document', async () => {
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/web-doc.indd',
      intent: 'digital',
      pageWidth: 1024,
      pageHeight: 768,
      facingPages: false,
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('page-relative');
  });

  it('resolveCoordinateSystem returns session default when explicitly set', async () => {
    setSession('print', 'page-relative');
    expect(await resolveCoordinateSystem(undefined)).toBe('page-relative');
    // Should not call JSX when session is explicitly set
    expect(mockExecuteJsx).not.toHaveBeenCalled();
  });

  it('explicit value overrides session default', async () => {
    setSession('print', 'page-relative');
    expect(await resolveCoordinateSystem('spread')).toBe('spread');
  });

  it('clearSession resets to null', () => {
    setSession('digital', 'page-relative');
    clearSession();
    expect(getSessionWorkflow()).toBeNull();
    expect(getSessionCoordinateSystem()).toBeNull();
  });

  it('cache persists when same document, re-detects on document switch', async () => {
    // First call: print document — full detection
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/print-doc.indd',
      intent: 'print',
      pageWidth: 595,
      pageHeight: 842,
      facingPages: true,
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('page-relative');

    // Second call: cache validation returns same documentKey — cache hit
    mockExecuteJsx.mockResolvedValue({
      documentKey: '/path/to/print-doc.indd',
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('page-relative'); // cached

    // Third call: cache validation returns different documentKey — re-detects
    mockExecuteJsx.mockResolvedValueOnce({
      documentKey: '/path/to/web-doc.indd',
    }).mockResolvedValueOnce({
      documentKey: '/path/to/web-doc.indd',
      intent: 'digital',
      pageWidth: 1024,
      pageHeight: 768,
      facingPages: false,
    });
    expect(await resolveCoordinateSystem(undefined)).toBe('page-relative');
  });

  it('falls back to page-relative on JSX error', async () => {
    mockExecuteJsx.mockResolvedValue({ error: true, message: 'No document' });
    expect(await resolveCoordinateSystem(undefined)).toBe('page-relative');
  });

  it('falls back to page-relative on JSX rejection', async () => {
    mockExecuteJsx.mockRejectedValue(new Error('connection failed'));
    expect(await resolveCoordinateSystem(undefined)).toBe('page-relative');
  });
});

describe('detectWorkflow', () => {
  it('detects print from intent', () => {
    const hint = detectWorkflow({
      intent: 'print',
      pageWidth: 595,
      pageHeight: 842,
      facingPages: true,
    });
    expect(hint.detectedWorkflow).toBe('print');
    expect(hint.recommendedCoordinateSystem).toBe('page-relative');
  });

  it('detects digital from intent', () => {
    const hint = detectWorkflow({
      intent: 'digital',
      pageWidth: 1024,
      pageHeight: 768,
      facingPages: false,
    });
    expect(hint.detectedWorkflow).toBe('digital');
    expect(hint.recommendedCoordinateSystem).toBe('page-relative');
  });

  it('infers print from facing pages', () => {
    const hint = detectWorkflow({
      intent: 'unknown',
      pageWidth: 595,
      pageHeight: 842,
      facingPages: true,
    });
    expect(hint.detectedWorkflow).toBe('print');
  });

  it('infers digital from wide landscape format', () => {
    const hint = detectWorkflow({
      intent: 'unknown',
      pageWidth: 1920,
      pageHeight: 1080,
      facingPages: false,
    });
    expect(hint.detectedWorkflow).toBe('digital');
  });

  it('returns unknown when no signals', () => {
    const hint = detectWorkflow({
      intent: 'unknown',
      pageWidth: 0,
      pageHeight: 0,
      facingPages: false,
    });
    expect(hint.detectedWorkflow).toBe('unknown');
  });

  it('signals are included in result', () => {
    const signals = {
      intent: 'print',
      pageWidth: 595,
      pageHeight: 842,
      facingPages: true,
    };
    const hint = detectWorkflow(signals);
    expect(hint.signals).toEqual(signals);
  });

  it('reasoning is non-empty for detected workflows', () => {
    const hint = detectWorkflow({
      intent: 'print',
      pageWidth: 595,
      pageHeight: 842,
      facingPages: true,
    });
    expect(hint.reasoning.length).toBeGreaterThan(0);
  });
});
