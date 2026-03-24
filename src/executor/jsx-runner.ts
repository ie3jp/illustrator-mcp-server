import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import pLimit from 'p-limit';
import {
  createTempFiles,
  writeParams,
  writeJsx,
  writeAppleScript,
  readResult,
  cleanupTempFiles,
} from './file-transport.js';

// Illustrator はシングルスレッド — JSX 実行を直列化
const jsxLimit = pLimit(1);

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
 * JSX コードを組み立てる（共通ヘルパー + ツール固有コード）
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

/**
 * osascript エラーメッセージを解析して分かりやすいエラーに変換する
 */
function parseOsascriptError(stderr: string): string {
  if (stderr.includes('Connection is invalid')) {
    return 'Illustrator is not running. Please launch Adobe Illustrator.';
  }
  if (stderr.includes('not allowed to send keystrokes') || stderr.includes('not allowed assistive access')) {
    return 'Automation permission denied. Please allow access in System Settings > Privacy & Security > Automation.';
  }
  return stderr;
}

/**
 * JSX を実行する（排他制御なし — 内部用）
 */
async function executeJsxRaw(
  jsxCode: string,
  params?: unknown,
  timeout: number = TIMEOUT_NORMAL,
  activate: boolean = false,
): Promise<JsxResult> {
  const files = createTempFiles();

  try {
    // 1. パラメータをJSONファイルに書き出し
    await writeParams(files.paramsPath, params);

    // 2. 共通ヘルパー + ツール固有コードを結合し、BOM付きUTF-8で保存
    const fullJsx = await buildJsx(jsxCode, files.paramsPath, files.resultPath);
    await writeJsx(files.scriptPath, fullJsx);

    // 3. AppleScriptをファイルに保存（activate: 書き出し等でIllustratorをフォアグラウンドにする）
    await writeAppleScript(files.scptPath, files.scriptPath, { activate });

    // 4. osascript を非同期実行
    await new Promise<void>((resolve, reject) => {
      execFile('osascript', [files.scptPath], { timeout }, (error, _stdout, stderr) => {
        if (error) {
          // タイムアウト時は明確なメッセージを返す
          if ('killed' in error && error.killed) {
            reject(new Error(`Script execution timed out after ${timeout}ms`));
          } else {
            const message = parseOsascriptError(stderr || error.message);
            reject(new Error(message));
          }
        } else {
          resolve();
        }
      });
    });

    // 5. 結果ファイルを読み取り
    let result: JsxResult;
    try {
      result = await readResult(files.resultPath) as JsxResult;
    } catch (readError) {
      // osascript は成功したが結果ファイルが生成されなかった場合
      // JSX の異常終了（try/catch 外でのクラッシュ等）が原因
      throw new Error(
        'JSX terminated without producing a result file. An uncaught exception may have occurred within the JSX script.',
      );
    }

    // JSX 内でエラーが発生した場合
    if (result.error) {
      throw new Error(result.message || 'An unknown error occurred during JSX execution');
    }

    return result;
  } finally {
    // 6. クリーンアップ
    await cleanupTempFiles(files);
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
