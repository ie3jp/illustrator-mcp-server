/**
 * file-transport.test.ts
 *
 * file-transport モジュールのユニットテスト。
 * ensureTmpDir / createTempFiles / writeParams / writeJsx / readResult / cleanupTmpDirSync
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupTmpDirSync,
  createTempFiles,
  ensureTmpDir,
  readResult,
  writeJsx,
  writeParams,
} from '../../src/executor/file-transport.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Collect temp dirs created by ensureTmpDir so we can clean up after tests. */
const createdDirs: string[] = [];

afterEach(() => {
  // Always call cleanupTmpDirSync to reset module state
  cleanupTmpDirSync();
  // Also remove any dirs we tracked manually
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* already gone */ }
  }
  createdDirs.length = 0;
  vi.restoreAllMocks();
});

// ─── ensureTmpDir + createTempFiles ─────────────────────────────────────────

describe('ensureTmpDir + createTempFiles', () => {
  it('createTempFiles throws when ensureTmpDir has not been called', () => {
    // Module state starts as null (or was reset by cleanupTmpDirSync in afterEach)
    expect(() => createTempFiles()).toThrow('Temp directory not initialized');
  });

  it('ensureTmpDir creates a temp dir and createTempFiles returns valid paths', async () => {
    await ensureTmpDir();

    const files = createTempFiles();

    expect(files.id).toBeTruthy();
    expect(files.paramsPath).toContain(`params-${files.id}.json`);
    expect(files.scriptPath).toContain(`script-${files.id}.jsx`);
    expect(files.resultPath).toContain(`result-${files.id}.json`);

    // All paths share the same parent directory
    const dirs = [files.paramsPath, files.scriptPath, files.runnerPath, files.resultPath]
      .map((p) => path.dirname(p));
    expect(new Set(dirs).size).toBe(1);

    // Track for cleanup
    createdDirs.push(dirs[0]);
  });

  it('createTempFiles uses platform-appropriate runner extension', async () => {
    await ensureTmpDir();

    const files = createTempFiles();
    createdDirs.push(path.dirname(files.paramsPath));

    const ext = process.platform === 'win32' ? '.ps1' : '.scpt';
    expect(files.runnerPath).toMatch(new RegExp(`run-${files.id}\\${ext}$`));
  });

  it('each call to createTempFiles returns a unique id', async () => {
    await ensureTmpDir();

    const a = createTempFiles();
    const b = createTempFiles();
    createdDirs.push(path.dirname(a.paramsPath));

    expect(a.id).not.toBe(b.id);
  });
});

// ─── writeParams ────────────────────────────────────────────────────────────

describe('writeParams', () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes an object as JSON', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'params.json');

    await writeParams(p, { foo: 'bar', num: 42 });

    const raw = readFileSync(p, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ foo: 'bar', num: 42 });
  });

  it('writes empty object when params is null', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'params.json');

    await writeParams(p, null);

    const raw = readFileSync(p, 'utf-8');
    expect(JSON.parse(raw)).toEqual({});
  });

  it('writes empty object when params is undefined', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'params.json');

    await writeParams(p, undefined);

    const raw = readFileSync(p, 'utf-8');
    expect(JSON.parse(raw)).toEqual({});
  });

  it('writes empty object for {}', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'params.json');

    await writeParams(p, {});

    const raw = readFileSync(p, 'utf-8');
    expect(JSON.parse(raw)).toEqual({});
  });
});

// ─── writeJsx ───────────────────────────────────────────────────────────────

describe('writeJsx', () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes BOM + jsxCode to file', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'script.jsx');
    const code = 'alert("hello");';

    await writeJsx(p, code);

    const raw = readFileSync(p, 'utf-8');
    expect(raw.charCodeAt(0)).toBe(0xFEFF); // BOM
    expect(raw.slice(1)).toBe(code);
  });

  it('BOM is present even for empty code', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'script.jsx');

    await writeJsx(p, '');

    const raw = readFileSync(p, 'utf-8');
    expect(raw).toBe('\uFEFF');
  });
});

// ─── readResult ─────────────────────────────────────────────────────────────

describe('readResult', () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads JSON from file without BOM', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'result.json');
    writeFileSync(p, JSON.stringify({ ok: true }), 'utf-8');

    const result = await readResult(p);

    expect(result).toEqual({ ok: true });
  });

  it('reads JSON from file with BOM prefix', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'result.json');
    writeFileSync(p, '\uFEFF' + JSON.stringify({ data: [1, 2, 3] }), 'utf-8');

    const result = await readResult(p);

    expect(result).toEqual({ data: [1, 2, 3] });
  });

  it('handles string JSON values', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ft-test-'));
    const p = path.join(dir, 'result.json');
    writeFileSync(p, '"hello"', 'utf-8');

    const result = await readResult(p);

    expect(result).toBe('hello');
  });
});

// ─── cleanupTmpDirSync ─────────────────────────────────────────────────────

describe('cleanupTmpDirSync', () => {
  it('removes the temp directory created by ensureTmpDir', async () => {
    await ensureTmpDir();
    const files = createTempFiles();
    const dir = path.dirname(files.paramsPath);

    expect(existsSync(dir)).toBe(true);

    cleanupTmpDirSync();

    expect(existsSync(dir)).toBe(false);
  });

  it('is a no-op when tmpDir is null (does not throw)', () => {
    // After afterEach calls cleanupTmpDirSync, tmpDir is already null.
    // Calling again should not throw.
    expect(() => cleanupTmpDirSync()).not.toThrow();
  });

  it('after cleanup, the temp dir no longer exists on disk', async () => {
    await ensureTmpDir();
    const files = createTempFiles();
    const dir = path.dirname(files.paramsPath);

    cleanupTmpDirSync();

    // The directory is removed from disk
    expect(existsSync(dir)).toBe(false);
    // Note: cleanupTmpDirSync does not reset the internal tmpDir variable,
    // so createTempFiles still returns paths (pointing to a deleted dir).
    // This is by design — cleanupTmpDirSync is called at process exit.
    const files2 = createTempFiles();
    expect(files2.id).toBeTruthy();
  });
});
