/**
 * transport.test.ts
 *
 * Windows トランスポートのモックテスト。
 * 実際の InDesign・PowerShell は不要。
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExecFileException } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writePowerShellScript } from '../../src/executor/file-transport.js';
import { getExecFailureMessage, resolveTransport } from '../../src/executor/jsx-runner.js';

// ─── resolveTransport ────────────────────────────────────────────────────────

describe('resolveTransport', () => {
  it('darwin → osascript', () => {
    expect(resolveTransport('darwin', undefined)).toBe('osascript');
  });

  it('win32 → powershell', () => {
    expect(resolveTransport('win32', undefined)).toBe('powershell');
  });

  it('未対応プラットフォームはエラーをスロー', () => {
    expect(() => resolveTransport('linux', undefined)).toThrow('Unsupported platform');
  });

  it('INDESIGN_MCP_TRANSPORT=osascript は win32 でも osascript を返す', () => {
    expect(resolveTransport('win32', 'osascript')).toBe('osascript');
  });

  it('INDESIGN_MCP_TRANSPORT=powershell は darwin でも powershell を返す', () => {
    expect(resolveTransport('darwin', 'powershell')).toBe('powershell');
  });
});

// ─── writePowerShellScript ────────────────────────────────────────────────────

describe('writePowerShellScript', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-ps-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('COM オートメーションのスクリプトを生成する', async () => {
    const ps1 = path.join(tmpDir, 'run.ps1');
    await writePowerShellScript(ps1, '/tmp/script.jsx');
    const content = await fs.readFile(ps1, 'utf-8');

    expect(content).toContain('New-Object -ComObject "InDesign.Application"');
    expect(content).toContain('DoScript');
    expect(content).toContain('1246973031');
    // エラー時に exit 1 する
    expect(content).toContain('exit 1');
  });

  it('Windows パスのバックスラッシュをスラッシュに変換する', async () => {
    const ps1 = path.join(tmpDir, 'run.ps1');
    await writePowerShellScript(ps1, 'C:\\Users\\test\\script.jsx');
    const content = await fs.readFile(ps1, 'utf-8');

    expect(content).toContain('C:/Users/test/script.jsx');
    expect(content).not.toMatch(/C:\\Users/);
  });

  it('既にスラッシュのパスはそのまま', async () => {
    const ps1 = path.join(tmpDir, 'run.ps1');
    await writePowerShellScript(ps1, '/tmp/indesign-mcp/script.jsx');
    const content = await fs.readFile(ps1, 'utf-8');

    expect(content).toContain('/tmp/indesign-mcp/script.jsx');
  });
});

// ─── getExecFailureMessage (powershell) ─────────────────────────────────────

describe('getExecFailureMessage powershell transport', () => {
  const makeError = (overrides: Partial<ExecFileException>): ExecFileException =>
    Object.assign(new Error('failed'), overrides) as ExecFileException;

  it('COM コンポーネント生成失敗を InDesign 未起動エラーに変換する', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 1 }),
      'Cannot create ActiveX component',
      30_000,
      'powershell',
    );
    expect(msg).toContain('not running');
    expect(msg).toContain('Adobe InDesign');
  });

  it('CLSID エラー (80040154) を InDesign 未起動エラーに変換する', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 1 }),
      'Error 80040154',
      30_000,
      'powershell',
    );
    expect(msg).toContain('not running');
  });

  it('タイムアウトは powershell でも同じメッセージ', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 'ETIMEDOUT', killed: true }),
      '',
      30_000,
      'powershell',
    );
    expect(msg).toBe('Script execution timed out after 30000ms');
  });

  it('シグナルによる強制終了メッセージ', () => {
    const msg = getExecFailureMessage(
      makeError({ killed: true, signal: 'SIGTERM' }),
      '',
      30_000,
      'powershell',
    );
    expect(msg).toContain('SIGTERM');
  });
});

// ─── getExecFailureMessage (osascript) ──────────────────────────────────────

describe('getExecFailureMessage osascript transport', () => {
  const makeError = (overrides: Partial<ExecFileException>): ExecFileException =>
    Object.assign(new Error('failed'), overrides) as ExecFileException;

  it('Connection is invalid → InDesign 未起動メッセージ', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 1 }),
      'Connection is invalid',
      30_000,
      'osascript',
    );
    expect(msg).toBe('InDesign is not running. Please launch Adobe InDesign.');
  });

  it('not allowed to send keystrokes → Automation permission denied', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 1 }),
      'not allowed to send keystrokes',
      30_000,
      'osascript',
    );
    expect(msg).toContain('Automation permission denied');
    expect(msg).toContain('System Settings');
  });

  it('not allowed assistive access → Automation permission denied', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 1 }),
      'not allowed assistive access',
      30_000,
      'osascript',
    );
    expect(msg).toContain('Automation permission denied');
  });

  it('その他の osascript エラーは stderr をそのまま返す', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 1 }),
      'some unknown osascript error',
      30_000,
      'osascript',
    );
    expect(msg).toBe('some unknown osascript error');
  });
});
