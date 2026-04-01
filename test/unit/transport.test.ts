/**
 * transport.test.ts
 *
 * Windows トランスポートのモックテスト。
 * 実際の Illustrator・PowerShell は不要。
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExecFileException } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeAppleScript, writePowerShellScript } from '../../src/executor/file-transport.js';
import { getExecFailureMessage, getAppPath, resolveTransport } from '../../src/executor/jsx-runner.js';

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

  it('ILLUSTRATOR_MCP_TRANSPORT=osascript は win32 でも osascript を返す', () => {
    expect(resolveTransport('win32', 'osascript')).toBe('osascript');
  });

  it('ILLUSTRATOR_MCP_TRANSPORT=powershell は darwin でも powershell を返す', () => {
    expect(resolveTransport('darwin', 'powershell')).toBe('powershell');
  });
});

// ─── getAppPath ─────────────────────────────────────────────────────────────

describe('getAppPath', () => {
  const originalEnv = process.env['ILLUSTRATOR_APP_PATH'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['ILLUSTRATOR_APP_PATH'];
    } else {
      process.env['ILLUSTRATOR_APP_PATH'] = originalEnv;
    }
  });

  it('未設定の場合は undefined を返す', () => {
    delete process.env['ILLUSTRATOR_APP_PATH'];
    expect(getAppPath()).toBeUndefined();
  });

  it('空文字列の場合は undefined を返す', () => {
    process.env['ILLUSTRATOR_APP_PATH'] = '';
    expect(getAppPath()).toBeUndefined();
  });

  it('設定されている場合はパスを返す', () => {
    process.env['ILLUSTRATOR_APP_PATH'] = '/Applications/Adobe Illustrator 2024/Adobe Illustrator.app';
    expect(getAppPath()).toBe('/Applications/Adobe Illustrator 2024/Adobe Illustrator.app');
  });
});

// ─── writeAppleScript ────────────────────────────────────────────────────────

describe('writeAppleScript', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-as-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('デフォルトでは "Adobe Illustrator" を対象にする', async () => {
    const scpt = path.join(tmpDir, 'run.scpt');
    await writeAppleScript(scpt, '/tmp/script.jsx');
    const content = await fs.readFile(scpt, 'utf-8');
    expect(content).toContain('tell application "Adobe Illustrator"');
  });

  it('appPath 指定時はフルパスで tell application する', async () => {
    const scpt = path.join(tmpDir, 'run.scpt');
    await writeAppleScript(scpt, '/tmp/script.jsx', {
      appPath: '/Applications/Adobe Illustrator 2024/Adobe Illustrator.app',
    });
    const content = await fs.readFile(scpt, 'utf-8');
    expect(content).toContain('tell application "/Applications/Adobe Illustrator 2024/Adobe Illustrator.app"');
    expect(content).not.toContain('tell application "Adobe Illustrator"');
  });

  it('activate オプションが反映される', async () => {
    const scpt = path.join(tmpDir, 'run.scpt');
    await writeAppleScript(scpt, '/tmp/script.jsx', { activate: true });
    const content = await fs.readFile(scpt, 'utf-8');
    expect(content).toContain('activate');
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

    expect(content).toContain('New-Object -ComObject "Illustrator.Application"');
    expect(content).toContain('DoJavaScript');
    expect(content).toContain('$.evalFile');
    // エラー時に exit 1 する
    expect(content).toContain('exit 1');
  });

  it('activate=true の場合は Illustrator を可視化するコードを含む', async () => {
    const ps1 = path.join(tmpDir, 'run-visible.ps1');
    await writePowerShellScript(ps1, '/tmp/script.jsx', { activate: true });
    const content = await fs.readFile(ps1, 'utf-8');
    expect(content).toContain('$ai.Visible = $true');
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
    await writePowerShellScript(ps1, '/tmp/illustrator-mcp/script.jsx');
    const content = await fs.readFile(ps1, 'utf-8');

    expect(content).toContain('/tmp/illustrator-mcp/script.jsx');
  });

  it('appPath 指定時は Start-Process でアプリを起動するコードを含む', async () => {
    const ps1 = path.join(tmpDir, 'run.ps1');
    await writePowerShellScript(ps1, '/tmp/script.jsx', {
      appPath: 'C:\\Program Files\\Adobe\\Adobe Illustrator 2025\\Support Files\\Contents\\Windows\\Illustrator.exe',
    });
    const content = await fs.readFile(ps1, 'utf-8');

    expect(content).toContain('Start-Process');
    expect(content).toContain('Illustrator.exe');
    // COM 接続も含む
    expect(content).toContain('New-Object -ComObject "Illustrator.Application"');
  });

  it('appPath 未指定時は Start-Process を含まない', async () => {
    const ps1 = path.join(tmpDir, 'run.ps1');
    await writePowerShellScript(ps1, '/tmp/script.jsx');
    const content = await fs.readFile(ps1, 'utf-8');

    expect(content).not.toContain('Start-Process');
  });
});

// ─── getExecFailureMessage (powershell) ─────────────────────────────────────

describe('getExecFailureMessage powershell transport', () => {
  const makeError = (overrides: Partial<ExecFileException>): ExecFileException =>
    Object.assign(new Error('failed'), overrides) as ExecFileException;

  it('COM コンポーネント生成失敗を Illustrator 未起動エラーに変換する', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 1 }),
      'Cannot create ActiveX component',
      30_000,
      'powershell',
    );
    expect(msg).toContain('not running');
    expect(msg).toContain('Adobe Illustrator');
  });

  it('CLSID エラー (80040154) を Illustrator 未起動エラーに変換する', () => {
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

  it('Connection is invalid → Illustrator 未起動メッセージ', () => {
    const msg = getExecFailureMessage(
      makeError({ code: 1 }),
      'Connection is invalid',
      30_000,
      'osascript',
    );
    expect(msg).toBe('Illustrator is not running. Please launch Adobe Illustrator.');
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
