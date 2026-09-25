/**
 * 出力パスの検証・実パス解決（export / export_pdf / save_document 共用）のテスト
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn().mockResolvedValue({ success: true }),
  executeJsxHeavy: vi.fn().mockResolvedValue({ success: true }),
}));

import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import { register as registerExportPdf } from '../../src/tools/export/export-pdf.js';
import { register as registerSaveDocument } from '../../src/tools/modify/save-document.js';
import { checkAbsoluteOutputPath, resolveOutputPath } from '../../src/utils/output-path.js';

type Handler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function capture(register: (server: McpServer) => void) {
  let handler: Handler | undefined;
  let shape: Record<string, z.ZodTypeAny> = {};
  const server = {
    registerTool: vi.fn((_n: string, cfg: { inputSchema: Record<string, z.ZodTypeAny> }, h: Handler) => {
      handler = h;
      shape = cfg.inputSchema;
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('not registered');
  const h = handler;
  return (raw: Record<string, unknown>) => h(z.object(shape).parse(raw) as Record<string, unknown>);
}

// シンボリックリンク経由のディレクトリを用意する（macOS の /tmp → /private/tmp と同じ状況）
const base = mkdtempSync(join(tmpdir(), 'output-path-test-'));
const realDir = join(base, 'real');
const linkDir = join(base, 'link');
mkdirSync(realDir);
symlinkSync(realDir, linkDir);
const realDirResolved = realpathSync(realDir);

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkAbsoluteOutputPath', () => {
  it('rejects relative paths with the parameter name', () => {
    expect(checkAbsoluteOutputPath('out.pdf', 'output_path')).toBe('output_path must be an absolute path: out.pdf');
    expect(checkAbsoluteOutputPath('/abs/out.pdf', 'output_path')).toBeNull();
  });
});

describe('resolveOutputPath', () => {
  it('resolves a symlinked parent directory to its real path', () => {
    expect(resolveOutputPath(join(linkDir, 'a.pdf'))).toBe(join(realDirResolved, 'a.pdf'));
  });

  it('returns the path unchanged when the directory does not exist', () => {
    expect(resolveOutputPath('/no-such-dir-for-test/a.pdf')).toBe('/no-such-dir-for-test/a.pdf');
  });
});

describe('export_pdf output_path', () => {
  it('rejects a relative output_path without calling Illustrator', async () => {
    const res = await capture(registerExportPdf)({ output_path: 'out.pdf' });
    expect(res.content[0].text).toContain('output_path must be an absolute path');
    expect(executeJsxHeavy).not.toHaveBeenCalled();
  });

  it('appends .pdf when the extension is missing and rejects another extension', async () => {
    await capture(registerExportPdf)({ output_path: '/no-such-dir-for-test/print' });
    const sent = vi.mocked(executeJsxHeavy).mock.calls[0][1] as { output_path: string };
    expect(sent.output_path).toBe('/no-such-dir-for-test/print.pdf');
    vi.mocked(executeJsxHeavy).mockClear();
    const res = await capture(registerExportPdf)({ output_path: '/no-such-dir-for-test/print.ai' });
    expect(res.content[0].text).toContain('.pdf');
    expect(executeJsxHeavy).not.toHaveBeenCalled();
  });

  it('passes the real path of a symlinked directory to Illustrator', async () => {
    await capture(registerExportPdf)({ output_path: join(linkDir, 'print.pdf') });
    const sent = vi.mocked(executeJsxHeavy).mock.calls[0][1] as { output_path: string };
    expect(sent.output_path).toBe(join(realDirResolved, 'print.pdf'));
  });
});

describe('save_document path', () => {
  it('passes the real path of a symlinked directory for save_as', async () => {
    await capture(registerSaveDocument)({ mode: 'save_as', path: join(linkDir, 'doc.ai') });
    const sent = vi.mocked(executeJsx).mock.calls[0][1] as { path: string };
    expect(sent.path).toBe(join(realDirResolved, 'doc.ai'));
  });

  it('does not touch path handling for plain save', async () => {
    await capture(registerSaveDocument)({ mode: 'save' });
    expect(executeJsx).toHaveBeenCalled();
  });
});
