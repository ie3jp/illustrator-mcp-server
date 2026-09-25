import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({ execFile: vi.fn() }));
vi.mock('../../src/executor/file-transport.js', () => ({
  createTempFiles: vi.fn(() => ({
    paramsPath: 'C:/temp/params.json', scriptPath: 'C:/temp/script.jsx',
    runnerPath: 'C:/temp/run.ps1', resultPath: 'C:/temp/result.json',
  })),
  writeParams: vi.fn(), writeJsx: vi.fn(), writeAppleScript: vi.fn(),
  writePowerShellScript: vi.fn(), readResult: vi.fn(async () => ({ success: true })),
  cleanupTempFiles: vi.fn(),
}));

import { execFile } from 'child_process';
import { cleanupTempFiles, writePowerShellScript } from '../../src/executor/file-transport.js';

describe('PowerShell child process launch', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Select the Windows transport even when CI runs on macOS or Linux.
    vi.stubEnv('ILLUSTRATOR_MCP_TRANSPORT', 'powershell');
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, callback: Function) => {
      callback(null, '', '');
      return {};
    }) as typeof execFile);
  });

  it.each([false, true])('hides the console and skips profiles (activate=%s)', async (activate) => {
    const { executeJsx } = await import('../../src/executor/jsx-runner.js');
    await expect(executeJsx('/* test */', {}, { activate })).resolves.toEqual({ success: true });
    expect(execFile).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', 'C:/temp/run.ps1'],
      { timeout: 30_000, windowsHide: true },
      expect.any(Function),
    );
    // Hiding the helper console does not change Illustrator's activation policy.
    expect(writePowerShellScript).toHaveBeenCalledWith('C:/temp/run.ps1', 'C:/temp/script.jsx', { activate, appPath: undefined });
    expect(cleanupTempFiles).toHaveBeenCalledOnce();
  });

  it('preserves custom timeouts and reports process failures', async () => {
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, callback: Function) => {
      callback(new Error('launch failed'), '', 'PowerShell failed');
      return {};
    }) as typeof execFile);
    const { executeJsx } = await import('../../src/executor/jsx-runner.js');
    await expect(executeJsx('/* test */', {}, { timeout: 1234 })).rejects.toThrow('PowerShell failed');
    expect(execFile).toHaveBeenCalledWith('powershell.exe', expect.any(Array), { timeout: 1234, windowsHide: true }, expect.any(Function));
    expect(cleanupTempFiles).toHaveBeenCalledOnce();
  });
});
