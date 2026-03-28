import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTempFiles } from '../../src/executor/file-transport.ts';

let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  vi.restoreAllMocks();
});

describe('cleanupTempFiles', () => {
  it('ignores missing files but warns for real cleanup failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await cleanupTempFiles({
      id: 'missing',
      paramsPath: '/tmp/does-not-exist-a',
      scriptPath: '/tmp/does-not-exist-b',
      runnerPath: '/tmp/does-not-exist-c',
      resultPath: '/tmp/does-not-exist-d',
    });

    expect(warn).not.toHaveBeenCalled();

    tempRoot = mkdtempSync(path.join(tmpdir(), 'illustrator-mcp-test-'));
    const failingPaths = ['params', 'script', 'runner', 'result'].map((name) => {
      const dirPath = path.join(tempRoot!, name);
      mkdirSync(dirPath);
      return dirPath;
    });

    await cleanupTempFiles({
      id: 'dirs',
      paramsPath: failingPaths[0],
      scriptPath: failingPaths[1],
      runnerPath: failingPaths[2],
      resultPath: failingPaths[3],
    });

    expect(warn).toHaveBeenCalledTimes(4);
  });
});
