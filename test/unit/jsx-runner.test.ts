import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanupTempFiles: vi.fn(),
  createTempFiles: vi.fn(() => ({
    id: 'test',
    paramsPath: '/tmp/params.json',
    scriptPath: '/tmp/script.jsx',
    runnerPath: '/tmp/run.scpt',
    resultPath: '/tmp/result.json',
  })),
  execFile: vi.fn(),
  readResult: vi.fn(),
  writeAppleScript: vi.fn(),
  writeJsx: vi.fn(),
  writeParams: vi.fn(),
  writePowerShellScript: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('../../src/executor/file-transport.js', () => ({
  cleanupTempFiles: mocks.cleanupTempFiles,
  createTempFiles: mocks.createTempFiles,
  readResult: mocks.readResult,
  writeAppleScript: mocks.writeAppleScript,
  writeJsx: mocks.writeJsx,
  writeParams: mocks.writeParams,
  writePowerShellScript: mocks.writePowerShellScript,
}));

import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';

describe('JSX runner result validation and heavy options', () => {
  beforeEach(() => {
    process.env['ILLUSTRATOR_MCP_TRANSPORT'] = 'osascript';
    vi.clearAllMocks();
    mocks.execFile.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
        callback(null, '', '');
      },
    );
    mocks.readResult.mockResolvedValue({ success: true });
  });

  it('エラー結果のメッセージに全 warnings を含める', async () => {
    mocks.readResult.mockResolvedValue({
      error: true,
      message: 'Export failed',
      line: 42,
      warnings: ['first warning', 'second warning'],
    });

    await expect(executeJsx('var x = 1;', {})).rejects.toThrow(
      'Export failed (JSX line 42) Warnings: first warning | second warning',
    );
  });

  it('executeJsxHeavy は60秒タイムアウトと activate を実トランスポートへ渡す', async () => {
    await executeJsxHeavy('var x = 1;', { value: 1 }, { activate: true });

    expect(mocks.writeAppleScript).toHaveBeenCalledWith(
      '/tmp/run.scpt',
      '/tmp/script.jsx',
      { activate: true, appPath: undefined },
    );
    expect(mocks.execFile).toHaveBeenCalledWith(
      'osascript',
      ['/tmp/run.scpt'],
      { timeout: 60_000 },
      expect.any(Function),
    );
  });
});
