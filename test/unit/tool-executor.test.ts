import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn(),
  executeJsxHeavy: vi.fn(),
}));

vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return {
    ...actual,
    resolveCoordinateSystem: vi.fn(),
  };
});

import { executeToolJsx, formatToolResult } from '../../src/tools/tool-executor.js';
import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import { resolveCoordinateSystem } from '../../src/tools/session.js';

const mockExecuteJsx = vi.mocked(executeJsx);
const mockExecuteJsxHeavy = vi.mocked(executeJsxHeavy);
const mockResolveCoordinate = vi.mocked(resolveCoordinateSystem);

describe('formatToolResult', () => {
  it('オブジェクトを JSON.stringify して MCP レスポンス形式で返す', () => {
    const result = formatToolResult({ foo: 'bar', num: 42 });
    expect(result).toEqual({
      content: [{ type: 'text', text: '{\n  "foo": "bar",\n  "num": 42\n}' }],
    });
  });

  it('null を処理できる', () => {
    const result = formatToolResult(null);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'null' }],
    });
  });

  it('配列を処理できる', () => {
    const result = formatToolResult([1, 2, 3]);
    expect(result).toEqual({
      content: [{ type: 'text', text: '[\n  1,\n  2,\n  3\n]' }],
    });
  });

  it('error プロパティを含むオブジェクトもそのまま返す', () => {
    const result = formatToolResult({ error: true, message: 'something failed' });
    expect(result.content[0].text).toContain('"error": true');
    expect(result.content[0].text).toContain('"message": "something failed"');
  });
});

describe('executeToolJsx', () => {
  beforeEach(() => {
    mockExecuteJsx.mockReset();
    mockExecuteJsxHeavy.mockReset();
    mockResolveCoordinate.mockReset();
  });

  it('デフォルトでは executeJsx を activate: false で呼ぶ', async () => {
    mockExecuteJsx.mockResolvedValue({ success: true });

    const result = await executeToolJsx('var x = 1;', { name: 'test' });

    expect(mockExecuteJsx).toHaveBeenCalledWith(
      'var x = 1;',
      { name: 'test' },
      { activate: false },
    );
    expect(result.content[0].text).toContain('"success": true');
  });

  it('activate: true を渡すと executeJsx に伝播する', async () => {
    mockExecuteJsx.mockResolvedValue({ ok: true });

    await executeToolJsx('code;', {}, { activate: true });

    expect(mockExecuteJsx).toHaveBeenCalledWith(
      'code;',
      {},
      { activate: true },
    );
  });

  it('heavy: true の場合は executeJsxHeavy を使う', async () => {
    mockExecuteJsxHeavy.mockResolvedValue({ heavy: 'result' });

    const result = await executeToolJsx('heavy code;', { a: 1 }, { heavy: true });

    expect(mockExecuteJsxHeavy).toHaveBeenCalledWith('heavy code;', { a: 1 });
    expect(mockExecuteJsx).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('"heavy": "result"');
  });

  it('resolveCoordinate: true の場合は座標系を解決する', async () => {
    mockResolveCoordinate.mockResolvedValue('document');
    mockExecuteJsx.mockResolvedValue({ coord: 'resolved' });

    await executeToolJsx('code;', { coordinate_system: undefined, x: 10 }, { resolveCoordinate: true });

    expect(mockResolveCoordinate).toHaveBeenCalledWith(undefined);
    expect(mockExecuteJsx).toHaveBeenCalledWith(
      'code;',
      { coordinate_system: 'document', x: 10 },
      { activate: false },
    );
  });

  it('resolveCoordinate: true + 明示的な coordinate_system はそのまま resolveCoordinateSystem に渡す', async () => {
    mockResolveCoordinate.mockResolvedValue('artboard-web');
    mockExecuteJsx.mockResolvedValue({});

    await executeToolJsx('code;', { coordinate_system: 'artboard-web' }, { resolveCoordinate: true });

    expect(mockResolveCoordinate).toHaveBeenCalledWith('artboard-web');
  });

  it('resolveCoordinate なしの場合は resolveCoordinateSystem を呼ばない', async () => {
    mockExecuteJsx.mockResolvedValue({});

    await executeToolJsx('code;', { coordinate_system: 'document' });

    expect(mockResolveCoordinate).not.toHaveBeenCalled();
    expect(mockExecuteJsx).toHaveBeenCalledWith(
      'code;',
      { coordinate_system: 'document' },
      { activate: false },
    );
  });

  it('heavy + resolveCoordinate を同時に使える', async () => {
    mockResolveCoordinate.mockResolvedValue('document');
    mockExecuteJsxHeavy.mockResolvedValue({ combined: true });

    const result = await executeToolJsx('code;', { x: 1 }, { heavy: true, resolveCoordinate: true });

    expect(mockResolveCoordinate).toHaveBeenCalled();
    expect(mockExecuteJsxHeavy).toHaveBeenCalledWith('code;', { x: 1, coordinate_system: 'document' });
    expect(result.content[0].text).toContain('"combined": true');
  });

  it('params が null の場合は空オブジェクトとして扱う', async () => {
    mockExecuteJsx.mockResolvedValue({});

    await executeToolJsx('code;', null);

    expect(mockExecuteJsx).toHaveBeenCalledWith(
      'code;',
      {},
      { activate: false },
    );
  });

  it('params が配列の場合は空オブジェクトとして扱う', async () => {
    mockExecuteJsx.mockResolvedValue({});

    await executeToolJsx('code;', [1, 2, 3]);

    expect(mockExecuteJsx).toHaveBeenCalledWith(
      'code;',
      {},
      { activate: false },
    );
  });

  it('params が undefined の場合は空オブジェクトとして扱う', async () => {
    mockExecuteJsx.mockResolvedValue({});

    await executeToolJsx('code;', undefined);

    expect(mockExecuteJsx).toHaveBeenCalledWith(
      'code;',
      {},
      { activate: false },
    );
  });
});
