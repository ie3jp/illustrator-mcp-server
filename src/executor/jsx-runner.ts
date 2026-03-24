import { execFile } from 'child_process';
import type { ExecFileException } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import pLimit from 'p-limit';
import {
  createTempFiles,
  writeParams,
  writeJsx,
  writeAppleScript,
  writePowerShellScript,
  readResult,
  cleanupTempFiles,
} from './file-transport.js';
import { buildJsxForCep, postToCep, CEP_PORT } from './cep-transport.js';

// Illustrator はシングルスレッド — JSX 実行を直列化
const jsxLimit = pLimit(1);

// 実行中の JSX を追跡（グレースフルシャットダウン用）
let pendingCount = 0;
let pendingResolve: (() => void) | null = null;

// ─── トランスポート選択 ───────────────────────────────────────────────────────
//
//  ILLUSTRATOR_MCP_TRANSPORT=cep       → CEP Extension HTTP (任意プラットフォーム)
//  ILLUSTRATOR_MCP_TRANSPORT=osascript → macOS AppleScript (macOS 強制)
//  未設定:
//    darwin  → osascript
//    win32   → PowerShell COM
//    その他  → CEP (フォールバック)
//
export type Transport = 'osascript' | 'powershell' | 'cep';

export function resolveTransport(
  platform: string = process.platform,
  envVar: string | undefined = process.env['ILLUSTRATOR_MCP_TRANSPORT'],
): Transport {
  if (envVar === 'cep') return 'cep';
  if (envVar === 'osascript') return 'osascript';
  if (platform === 'darwin') return 'osascript';
  if (platform === 'win32') return 'powershell';
  return 'cep';
}

const TRANSPORT: Transport = resolveTransport();

/**
 * 実行中の JSX がすべて完了するまで待機する（シャットダウン用）
 */
export function waitForPendingExecutions(): Promise<void> {
  if (pendingCount === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    pendingResolve = resolve;
  });
}

const JSX_HELPERS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../jsx/helpers/common.jsx',
);

// タイムアウト設定（ms）
const TIMEOUT_NORMAL = 30_000;
const TIMEOUT_HEAVY = 60_000;

export interface JsxResult {
  error?: boolean;
  message?: string;
  line?: number;
  [key: string]: unknown;
}

/**
 * osascript / PowerShell COM 用 JSX ビルダー（ファイルベース I/O）
 */
async function buildJsx(
  toolScript: string,
  paramsPath: string,
  resultPath: string,
): Promise<string> {
  const helpers = await fs.readFile(JSX_HELPERS_PATH, 'utf-8');
  return `(function() {
${helpers}
var PARAMS_PATH = ${JSON.stringify(paramsPath)};
var RESULT_PATH = ${JSON.stringify(resultPath)};
${toolScript}
})();`;
}

// ─── エラーメッセージ変換 ────────────────────────────────────────────────────

function parseOsascriptError(stderr: string): string {
  if (stderr.includes('Connection is invalid')) {
    return 'Illustrator is not running. Please launch Adobe Illustrator.';
  }
  if (stderr.includes('not allowed to send keystrokes') || stderr.includes('not allowed assistive access')) {
    return 'Automation permission denied. Please allow access in System Settings > Privacy & Security > Automation.';
  }
  return stderr;
}

function parsePowerShellError(stderr: string): string {
  if (stderr.includes('Cannot create ActiveX component') || stderr.includes('80080005') || stderr.includes('80040154')) {
    return 'Illustrator is not running or is not installed. Please launch Adobe Illustrator.';
  }
  return stderr;
}

export function getExecFailureMessage(
  error: ExecFileException,
  stderr: string,
  timeout: number,
  transport: Transport = 'osascript',
): string {
  if (error.code === 'ETIMEDOUT') {
    return `Script execution timed out after ${timeout}ms`;
  }
  if (error.killed) {
    return `Script execution was terminated${error.signal ? ` by signal ${error.signal}` : ''}`;
  }
  if (transport === 'powershell') return parsePowerShellError(stderr || error.message);
  return parseOsascriptError(stderr || error.message);
}

// ─── 各トランスポートの実行ロジック ─────────────────────────────────────────

async function executeViaOsascript(
  jsxCode: string,
  params: unknown,
  timeout: number,
  activate: boolean,
): Promise<JsxResult> {
  const files = createTempFiles();
  try {
    await writeParams(files.paramsPath, params);
    const fullJsx = await buildJsx(jsxCode, files.paramsPath, files.resultPath);
    await writeJsx(files.scriptPath, fullJsx);
    await writeAppleScript(files.runnerPath, files.scriptPath, { activate });

    await new Promise<void>((resolve, reject) => {
      execFile('osascript', [files.runnerPath], { timeout }, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(getExecFailureMessage(error, stderr, timeout, 'osascript')));
        } else {
          resolve();
        }
      });
    });

    return await readAndValidateResult(files.resultPath);
  } finally {
    await cleanupTempFiles(files);
  }
}

async function executeViaPowerShell(
  jsxCode: string,
  params: unknown,
  timeout: number,
): Promise<JsxResult> {
  const files = createTempFiles();
  try {
    await writeParams(files.paramsPath, params);
    const fullJsx = await buildJsx(jsxCode, files.paramsPath, files.resultPath);
    await writeJsx(files.scriptPath, fullJsx);
    await writePowerShellScript(files.runnerPath, files.scriptPath);

    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', files.runnerPath],
        { timeout },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(getExecFailureMessage(error, stderr, timeout, 'powershell')));
          } else {
            resolve();
          }
        },
      );
    });

    return await readAndValidateResult(files.resultPath);
  } finally {
    await cleanupTempFiles(files);
  }
}

async function executeViaCep(
  jsxCode: string,
  params: unknown,
  timeout: number,
): Promise<JsxResult> {
  const fullJsx = await buildJsxForCep(jsxCode, params);
  const resultJson = await postToCep(fullJsx, timeout);

  let result: JsxResult;
  try {
    result = JSON.parse(resultJson) as JsxResult;
  } catch {
    throw new Error(`Failed to parse result from CEP extension: ${resultJson.slice(0, 200)}`);
  }

  if (result.error) {
    throw new Error(result.message || 'An unknown error occurred during JSX execution');
  }

  return result;
}

async function readAndValidateResult(resultPath: string): Promise<JsxResult> {
  let result: JsxResult;
  try {
    result = await readResult(resultPath) as JsxResult;
  } catch {
    throw new Error(
      'JSX terminated without producing a result file. An uncaught exception may have occurred within the JSX script.',
    );
  }
  if (result.error) {
    throw new Error(result.message || 'An unknown error occurred during JSX execution');
  }
  return result;
}

// ─── 公開 API ────────────────────────────────────────────────────────────────

/**
 * JSX を実行する（排他制御なし — 内部用）
 */
async function executeJsxRaw(
  jsxCode: string,
  params?: unknown,
  timeout: number = TIMEOUT_NORMAL,
  activate: boolean = false,
): Promise<JsxResult> {
  pendingCount++;
  try {
    switch (TRANSPORT) {
      case 'osascript':
        return await executeViaOsascript(jsxCode, params, timeout, activate);
      case 'powershell':
        return await executeViaPowerShell(jsxCode, params, timeout);
      case 'cep':
        return await executeViaCep(jsxCode, params, timeout);
      default:
        throw new Error(`Unknown transport: ${TRANSPORT as string}`);
    }
  } finally {
    pendingCount--;
    if (pendingCount === 0 && pendingResolve) {
      pendingResolve();
      pendingResolve = null;
    }
  }
}

/**
 * JSX を実行する（排他制御付き — 公開 API）
 */
export async function executeJsx(
  jsxCode: string,
  params?: unknown,
  options?: { timeout?: number; activate?: boolean },
): Promise<JsxResult> {
  return jsxLimit(() => executeJsxRaw(
    jsxCode,
    params,
    options?.timeout ?? TIMEOUT_NORMAL,
    options?.activate ?? false,
  ));
}

/**
 * 重い処理用の JSX 実行（タイムアウト延長 + Illustrator をフォアグラウンドに）
 */
export async function executeJsxHeavy(
  jsxCode: string,
  params?: unknown,
): Promise<JsxResult> {
  return executeJsx(jsxCode, params, { timeout: TIMEOUT_HEAVY, activate: true });
}

// ─── デバッグ用エクスポート ──────────────────────────────────────────────────
export { TRANSPORT, CEP_PORT };
