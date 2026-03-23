import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { rmSync } from 'fs';
import * as path from 'path';

export const TMP_DIR = '/tmp/illustrator-mcp';
const BOM = '\uFEFF';

export interface TempFiles {
  id: string;
  paramsPath: string;
  scriptPath: string;
  scptPath: string;
  resultPath: string;
}

export async function ensureTmpDir(): Promise<void> {
  await fs.mkdir(TMP_DIR, { recursive: true });
}

export function createTempFiles(): TempFiles {
  const id = randomUUID();
  return {
    id,
    paramsPath: path.join(TMP_DIR, `params-${id}.json`),
    scriptPath: path.join(TMP_DIR, `script-${id}.jsx`),
    scptPath: path.join(TMP_DIR, `run-${id}.scpt`),
    resultPath: path.join(TMP_DIR, `result-${id}.json`),
  };
}

export async function writeParams(paramsPath: string, params: unknown): Promise<void> {
  await fs.writeFile(paramsPath, JSON.stringify(params ?? {}), 'utf-8');
}

export async function writeJsx(scriptPath: string, jsxCode: string): Promise<void> {
  await fs.writeFile(scriptPath, BOM + jsxCode, 'utf-8');
}

export async function writeAppleScript(
  scptPath: string,
  scriptPath: string,
  options?: { activate?: boolean },
): Promise<void> {
  const lines = ['tell application "Adobe Illustrator"'];
  if (options?.activate) {
    lines.push('  activate');
  }
  lines.push(`  do javascript of file "${scriptPath}"`);
  lines.push('end tell');
  await fs.writeFile(scptPath, lines.join('\n'), 'utf-8');
}

export async function readResult(resultPath: string): Promise<unknown> {
  const raw = await fs.readFile(resultPath, 'utf-8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

export async function cleanupTempFiles(files: TempFiles): Promise<void> {
  await Promise.allSettled([
    fs.unlink(files.paramsPath),
    fs.unlink(files.scriptPath),
    fs.unlink(files.scptPath),
    fs.unlink(files.resultPath),
  ]);
}

export function cleanupTmpDirSync(): void {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // 終了時のクリーンアップ失敗は無視
  }
}
