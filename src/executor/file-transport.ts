import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string | null = null;

const BOM = '\uFEFF';

export interface TempFiles {
  id: string;
  paramsPath: string;
  scriptPath: string;
  /** macOS: AppleScript (.scpt) / Windows: PowerShell (.ps1) */
  runnerPath: string;
  resultPath: string;
}

export async function ensureTmpDir(): Promise<void> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indesign-mcp-'));
}

export function createTempFiles(): TempFiles {
  if (!tmpDir) throw new Error('Temp directory not initialized. Call ensureTmpDir() first.');
  const id = randomUUID();
  const ext = process.platform === 'win32' ? 'ps1' : 'scpt';
  return {
    id,
    paramsPath: path.join(tmpDir, `params-${id}.json`),
    scriptPath: path.join(tmpDir, `script-${id}.jsx`),
    runnerPath: path.join(tmpDir, `run-${id}.${ext}`),
    resultPath: path.join(tmpDir, `result-${id}.json`),
  };
}

export async function writeParams(paramsPath: string, params: unknown): Promise<void> {
  await fs.writeFile(paramsPath, JSON.stringify(params ?? {}), 'utf-8');
}

export async function writeJsx(scriptPath: string, jsxCode: string): Promise<void> {
  await fs.writeFile(scriptPath, BOM + jsxCode, 'utf-8');
}

/** macOS 用 AppleScript 生成 */
export async function writeAppleScript(
  scptPath: string,
  scriptPath: string,
  options?: { activate?: boolean },
): Promise<void> {
  const lines = ['tell application "Adobe InDesign"'];
  if (options?.activate) {
    lines.push('  activate');
  }
  // InDesign uses "do script" with "language javascript" instead of Illustrator's "do javascript"
  const escaped = scriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  lines.push(`  do script POSIX file "${escaped}" language javascript`);
  lines.push('end tell');
  await fs.writeFile(scptPath, lines.join('\n'), 'utf-8');
}

/** Windows 用 PowerShell スクリプト生成 */
export async function writePowerShellScript(
  ps1Path: string,
  scriptPath: string,
): Promise<void> {
  // ExtendScript の File() はスラッシュ区切りを要求
  const jsxPathForward = scriptPath.replace(/\\/g, '/');
  const jsxPathEscaped = jsxPathForward.replace(/'/g, "\\'");
  const lines = [
    'try {',
    '  $id = New-Object -ComObject "InDesign.Application" -ErrorAction Stop',
    // 1246973031 = ScriptLanguage.JAVASCRIPT enum value for InDesign COM
    `  $scriptContent = [System.IO.File]::ReadAllText('${jsxPathEscaped}', [System.Text.Encoding]::UTF8)`,
    '  $id.DoScript($scriptContent, 1246973031)',
    '} catch {',
    '  Write-Error "InDesign COM automation failed: $_"',
    '  exit 1',
    '}',
  ];
  await fs.writeFile(ps1Path, lines.join('\n'), 'utf-8');
}

export async function readResult(resultPath: string): Promise<unknown> {
  const raw = await fs.readFile(resultPath, 'utf-8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

export async function cleanupTempFiles(files: TempFiles): Promise<void> {
  const paths = [
    files.paramsPath,
    files.scriptPath,
    files.runnerPath,
    files.resultPath,
  ];
  const results = await Promise.allSettled(paths.map((p) => fs.unlink(p)));
  results.forEach((result, index) => {
    if (result.status === 'rejected' && !isIgnorableCleanupError(result.reason)) {
      console.warn('Failed to clean up temp file:', paths[index], result.reason);
    }
  });
}

export function cleanupTmpDirSync(): void {
  if (!tmpDir) return;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {
    console.warn('Failed to clean up temp directory:', tmpDir, e);
  }
}

function isIgnorableCleanupError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}
