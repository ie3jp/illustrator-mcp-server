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
import { getExecFailureMessage, getAppPath, setAppVersion, getAppVersion, resolveVersionToPath, resolveTransport } from '../../src/executor/jsx-runner.js';

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

// ─── resolveVersionToPath ───────────────────────────────────────────────────

describe('resolveVersionToPath', () => {
  it('macOS: バージョン番号からアプリパスを生成する', () => {
    expect(resolveVersionToPath('2025', 'darwin')).toBe(
      '/Applications/Adobe Illustrator 2025/Adobe Illustrator.app',
    );
  });

  it('Windows: バージョン番号から exe パスを生成する', () => {
    expect(resolveVersionToPath('2025', 'win32')).toBe(
      'C:\\Program Files\\Adobe\\Adobe Illustrator 2025\\Support Files\\Contents\\Windows\\Illustrator.exe',
    );
  });

  it('未対応プラットフォームはエラーをスロー', () => {
    expect(() => resolveVersionToPath('2025', 'linux')).toThrow('Unsupported platform');
  });
});

// ─── setAppVersion / getAppPath / getAppVersion ────────────────────────────

describe('setAppVersion / getAppPath / getAppVersion', () => {
  afterEach(() => {
    setAppVersion(undefined);
  });

  it('初期状態では undefined', () => {
    expect(getAppPath()).toBeUndefined();
    expect(getAppVersion()).toBeUndefined();
  });

  it('バージョン設定で macOS パスが返る', () => {
    setAppVersion('2025', 'darwin');
    expect(getAppPath()).toBe(
      '/Applications/Adobe Illustrator 2025/Adobe Illustrator.app',
    );
    expect(getAppVersion()).toBe('2025');
  });

  it('バージョン設定で Windows パスが返る', () => {
    setAppVersion('2025', 'win32');
    expect(getAppPath()).toBe(
      'C:\\Program Files\\Adobe\\Adobe Illustrator 2025\\Support Files\\Contents\\Windows\\Illustrator.exe',
    );
    expect(getAppVersion()).toBe('2025');
  });

  it('undefined で解除', () => {
    setAppVersion('2024', 'darwin');
    expect(getAppPath()).toBeDefined();
    setAppVersion(undefined);
    expect(getAppPath()).toBeUndefined();
    expect(getAppVersion()).toBeUndefined();
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
    expect(content).not.toContain('System Events');
  });

  it('appPath 指定時はフルパスで特定バージョンに接続する', async () => {
    const scpt = path.join(tmpDir, 'run.scpt');
    await writeAppleScript(scpt, '/tmp/script.jsx', {
      appPath: '/Applications/Adobe Illustrator 2024/Adobe Illustrator.app',
    });
    const content = await fs.readFile(scpt, 'utf-8');
    // フルパスで tell して特定バージョンに接続
    expect(content).toContain('tell application "/Applications/Adobe Illustrator 2024/Adobe Illustrator.app"');
    // 起動チェックは不要（フルパス指定で直接接続）
    expect(content).not.toContain('System Events');
    expect(content).not.toContain('isRunning');
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

  it('appPath 指定時は起動済みチェック + 未起動時のみ Start-Process', async () => {
    const ps1 = path.join(tmpDir, 'run.ps1');
    await writePowerShellScript(ps1, '/tmp/script.jsx', {
      appPath: 'C:\\Program Files\\Adobe\\Adobe Illustrator 2025\\Support Files\\Contents\\Windows\\Illustrator.exe',
    });
    const content = await fs.readFile(ps1, 'utf-8');

    // 起動済みチェック
    expect(content).toContain('Get-Process -Name "Illustrator"');
    // 未起動時のみ起動
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
