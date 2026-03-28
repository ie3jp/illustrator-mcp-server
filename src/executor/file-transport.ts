import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const TMP_DIR = path.join(os.tmpdir(), 'illustrator-mcp');
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
  await fs.mkdir(TMP_DIR, { recursive: true });
}

export function createTempFiles(): TempFiles {
  const id = randomUUID();
  const ext = process.platform === 'win32' ? 'ps1' : 'scpt';
  return {
    id,
    paramsPath: path.join(TMP_DIR, `params-${id}.json`),
    scriptPath: path.join(TMP_DIR, `script-${id}.jsx`),
    runnerPath: path.join(TMP_DIR, `run-${id}.${ext}`),
    resultPath: path.join(TMP_DIR, `result-${id}.json`),
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
  const lines = ['tell application "Adobe Illustrator"'];
  if (options?.activate) {
    lines.push('  activate');
  }
  const escaped = scriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  lines.push(`  do javascript of file "${escaped}"`);
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
    '  $ai = New-Object -ComObject "Illustrator.Application" -ErrorAction Stop',
    `  $ai.DoJavaScript("$.evalFile(new File('${jsxPathEscaped}'))")`,
    '} catch {',
    '  Write-Error "Illustrator COM automation failed: $_"',
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
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (e) {
    console.warn('Failed to clean up temp directory:', TMP_DIR, e);
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
