/**
 * transport.test.ts
 *
 * Windows / CEP トランスポートのモックテスト。
 * 実際の Illustrator・PowerShell・CEP Extension は不要。
 */
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExecFileException } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writePowerShellScript } from '../../src/executor/file-transport.js';
import { buildJsxForCep, postToCep } from '../../src/executor/cep-transport.js';
import { getExecFailureMessage, resolveTransport } from '../../src/executor/jsx-runner.js';

// ─── resolveTransport ────────────────────────────────────────────────────────

describe('resolveTransport', () => {
  it('darwin → osascript', () => {
    expect(resolveTransport('darwin', undefined)).toBe('osascript');
  });

  it('win32 → powershell', () => {
    expect(resolveTransport('win32', undefined)).toBe('powershell');
  });

  it('linux (unknown) → cep', () => {
    expect(resolveTransport('linux', undefined)).toBe('cep');
  });

  it('ILLUSTRATOR_MCP_TRANSPORT=cep は darwin でも cep を返す', () => {
    expect(resolveTransport('darwin', 'cep')).toBe('cep');
  });

  it('ILLUSTRATOR_MCP_TRANSPORT=osascript は win32 でも osascript を返す', () => {
    expect(resolveTransport('win32', 'osascript')).toBe('osascript');
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
});

// ─── buildJsxForCep ──────────────────────────────────────────────────────────

describe('buildJsxForCep', () => {
  it('params を JSX に直接埋め込む', async () => {
    const jsx = await buildJsxForCep('/* tool code */', { width: 100, label: 'test' });
    expect(jsx).toContain('"width":100');
    expect(jsx).toContain('"label":"test"');
  });

  it('readParamsFile をオーバーライドして埋め込み params を返す', async () => {
    const jsx = await buildJsxForCep('/* tool */', { x: 1 });
    expect(jsx).toContain('readParamsFile = function');
    expect(jsx).toContain('return __cepParams');
  });

  it('writeResultFile をオーバーライドして __cepResult にキャプチャ', async () => {
    const jsx = await buildJsxForCep('/* tool */', {});
    expect(jsx).toContain('writeResultFile = function');
    expect(jsx).toContain('__cepResult = jsonStringify(result)');
  });

  it('IIFE として __cepResult を return する', async () => {
    const jsx = await buildJsxForCep('/* tool */', {});
    // 末尾の return ステートメントが存在する
    expect(jsx).toContain('return __cepResult');
    // セミコロンなし IIFE — "(function(){...})()" で終わること
    // (evalScript が戻り値を取得できるよう末尾に ; を付けない)
    expect(jsx.trimEnd()).toMatch(/\}\)\(\)$/);
  });

  it('ツールコードを含む', async () => {
    const toolCode = 'writeResultFile(RESULT_PATH, {ok: true});';
    const jsx = await buildJsxForCep(toolCode, {});
    expect(jsx).toContain(toolCode);
  });

  it('共通ヘルパー (jsonStringify など) を含む', async () => {
    const jsx = await buildJsxForCep('/* tool */', {});
    expect(jsx).toContain('function jsonStringify');
    expect(jsx).toContain('function readParamsFile');
  });
});

// ─── postToCep ───────────────────────────────────────────────────────────────

describe('postToCep', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
          if (req.method !== 'POST' || req.url !== '/eval') {
            res.writeHead(404);
            res.end(JSON.stringify({ ok: false, error: 'not found' }));
            return;
          }
          const { jsxCode } = JSON.parse(body) as { jsxCode: string };
          // モック: jsxCode に "FAIL" が含まれていたらエラーを返す
          if (jsxCode.includes('FAIL')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'ExtendScript runtime error' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result: '{"success":true}' }));
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('JSX を POST して evalScript の結果を返す', async () => {
    const result = await postToCep('var x = 1;', 5000, port);
    expect(result).toBe('{"success":true}');
  });

  it('CEP サーバーが ok:false を返したときエラーをスロー', async () => {
    await expect(postToCep('FAIL', 5000, port))
      .rejects.toThrow('ExtendScript runtime error');
  });

  it('接続拒否 (ECONNREFUSED) で分かりやすいエラーメッセージ', async () => {
    // 存在しないポートに接続
    await expect(postToCep('var x = 1;', 5000, 19999))
      .rejects.toThrow('Cannot connect to Illustrator MCP Bridge extension');
  });

  it('タイムアウト時にエラーをスロー', async () => {
    // レスポンスを遅延させるサーバー
    const slowServer = await new Promise<{ server: http.Server; port: number }>((resolve) => {
      const s = http.createServer((_req, _res) => {
        // 意図的に応答しない（タイムアウトを待つ）
      });
      s.listen(0, '127.0.0.1', () => {
        resolve({ server: s, port: (s.address() as { port: number }).port });
      });
    });

    try {
      await expect(postToCep('var x = 1;', 100, slowServer.port))
        .rejects.toThrow('timed out after 100ms');
    } finally {
      await new Promise<void>((resolve) => slowServer.server.close(() => resolve()));
    }
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
