import { execFile } from 'child_process';
import type { ExecFileException } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
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

// Illustrator はシングルスレッド — JSX 実行を直列化
const jsxLimit = pLimit(1);

// 実行中の JSX を追跡（グレースフルシャットダウン用）
let pendingCount = 0;
let pendingResolvers: Array<() => void> = [];

// ─── トランスポート選択 ───────────────────────────────────────────────────────
//
//  ILLUSTRATOR_MCP_TRANSPORT=osascript → macOS AppleScript (macOS 強制)
//  未設定:
//    darwin  → osascript
//    win32   → PowerShell COM
//
export type Transport = 'osascript' | 'powershell';

export function resolveTransport(
  platform: string = process.platform,
  envVar: string | undefined = process.env['ILLUSTRATOR_MCP_TRANSPORT'],
): Transport {
  if (envVar === 'osascript') return 'osascript';
  if (envVar === 'powershell') return 'powershell';
  if (platform === 'darwin') return 'osascript';
  if (platform === 'win32') return 'powershell';
  throw new Error(`Unsupported platform: ${platform}. Only macOS and Windows are supported.`);
}

// 遅延初期化: テスト環境 (Linux CI) ではモジュール読み込み時に throw しないようにする
let _transport: Transport | null = null;
function getTransport(): Transport {
  if (!_transport) _transport = resolveTransport();
  return _transport;
}

// ─── アプリパス解決 ─────────────────────────────────────────────────────────
//
//  優先順位:
//    1. ILLUSTRATOR_APP_PATH (フルパス指定)
//    2. ILLUSTRATOR_VERSION  (バージョン番号 → パス自動解決)
//    3. 未指定 → undefined (デフォルトの "Adobe Illustrator" に接続)
//

/**
 * バージョン番号（例: "2025"）からアプリのフルパスを解決する。
 */
export function resolveVersionToPath(
  version: string,
  platform: string = process.platform,
): string {
  if (platform === 'darwin') {
    return `/Applications/Adobe Illustrator ${version}/Adobe Illustrator.app`;
  }
  if (platform === 'win32') {
    return `C:\\Program Files\\Adobe\\Adobe Illustrator ${version}\\Support Files\\Contents\\Windows\\Illustrator.exe`;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * 環境変数からアプリパスを取得する。
 *
 * - ILLUSTRATOR_APP_PATH: フルパス指定（最優先）
 * - ILLUSTRATOR_VERSION: バージョン番号（例: "2025"）→ パス自動解決
 */
export function getAppPath(
  platform: string = process.platform,
  appPathEnv: string | undefined = process.env['ILLUSTRATOR_APP_PATH'],
  versionEnv: string | undefined = process.env['ILLUSTRATOR_VERSION'],
): string | undefined {
  if (appPathEnv) return appPathEnv;
  if (versionEnv) return resolveVersionToPath(versionEnv, platform);
  return undefined;
}

/**
 * 実行中の JSX がすべて完了するまで待機する（シャットダウン用）
 */
export function waitForPendingExecutions(): Promise<void> {
  if (pendingCount === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    pendingResolvers.push(resolve);
  });
}

// ESM (dist/executor/jsx-runner.js) → ../jsx/helpers/common.jsx
// CJS bundle (dist/bundle.cjs)     → ./jsx/helpers/common.jsx
const __dir = path.dirname(fileURLToPath(import.meta.url));
const _esmCandidate = path.resolve(__dir, '../jsx/helpers/common.jsx');
const _cjsCandidate = path.resolve(__dir, 'jsx/helpers/common.jsx');
const JSX_HELPERS_PATH = existsSync(_esmCandidate) ? _esmCandidate : _cjsCandidate;

// helpers ファイルをメモリにキャッシュ（毎回のディスク読み込みを排除）
let _helpersCache: string | null = null;
async function getHelpers(): Promise<string> {
  if (!_helpersCache) {
    _helpersCache = await fs.readFile(JSX_HELPERS_PATH, 'utf-8');
  }
  return _helpersCache;
}

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
  const helpers = await getHelpers();
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
    await writeAppleScript(files.runnerPath, files.scriptPath, { activate, appPath: getAppPath() });

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
  activate: boolean,
): Promise<JsxResult> {
  const files = createTempFiles();
  try {
    await writeParams(files.paramsPath, params);
    const fullJsx = await buildJsx(jsxCode, files.paramsPath, files.resultPath);
    await writeJsx(files.scriptPath, fullJsx);
    await writePowerShellScript(files.runnerPath, files.scriptPath, { activate, appPath: getAppPath() });

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
    const parts: string[] = [];
    if (result.message) parts.push(result.message as string);
    if (result.line != null) parts.push(`(JSX line ${result.line})`);
    throw new Error(parts.length > 0 ? parts.join(' ') : 'An unknown error occurred during JSX execution');
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
  const transport = getTransport();
  switch (transport) {
    case 'osascript':
      return await executeViaOsascript(jsxCode, params, timeout, activate);
    case 'powershell':
      return await executeViaPowerShell(jsxCode, params, timeout, activate);
    default: {
      const _: never = transport;
      throw new Error(`Unknown transport: ${_ as string}`);
    }
  }
}

/**
 * JSX を実行する（排他制御付き — 公開 API）
 * pendingCount は jsxLimit の外側で管理し、キュー待ちのタスクも追跡する
 */
export async function executeJsx(
  jsxCode: string,
  params?: unknown,
  options?: { timeout?: number; activate?: boolean },
): Promise<JsxResult> {
  pendingCount++;
  try {
    return await jsxLimit(() => executeJsxRaw(
      jsxCode,
      params,
      options?.timeout ?? TIMEOUT_NORMAL,
      options?.activate ?? false,
    ));
  } finally {
    pendingCount--;
    if (pendingCount === 0 && pendingResolvers.length > 0) {
      pendingResolvers.splice(0).forEach((r) => r());
    }
  }
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
export { getTransport as TRANSPORT };
