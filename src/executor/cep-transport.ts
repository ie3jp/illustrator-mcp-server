import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

export const CEP_PORT: number = process.env['ILLUSTRATOR_MCP_CEP_PORT']
  ? parseInt(process.env['ILLUSTRATOR_MCP_CEP_PORT'], 10)
  : 49374;

const JSX_HELPERS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../jsx/helpers/common.jsx',
);

/**
 * CEP Extension 用 JSX を構築する
 * - params を直接埋め込み（ファイル I/O 不要）
 * - writeResultFile をオーバーライドして evalScript 戻り値としてキャプチャ
 */
export async function buildJsxForCep(
  toolScript: string,
  params: unknown,
): Promise<string> {
  const helpers = await fs.readFile(JSX_HELPERS_PATH, 'utf-8');
  const paramsJson = JSON.stringify(params ?? {});
  // Note: 末尾に ; を付けない — IIFE の戻り値を evalScript が受け取るため
  return `(function() {
${helpers}
var __cepParams = ${paramsJson};
var __cepResult = null;
readParamsFile = function() { return __cepParams; };
writeResultFile = function(filePath, result) { __cepResult = jsonStringify(result); };
var PARAMS_PATH = "__cep__";
var RESULT_PATH = "__cep__";
${toolScript}
return __cepResult;
})()`;
}

/**
 * CEP Extension の HTTP サーバーに JSX を送信し、evalScript の戻り値 (JSON 文字列) を返す
 * @param port テスト時にモックサーバーのポートを渡せるよう省略可能
 */
export function postToCep(jsxCode: string, timeout: number, port: number = CEP_PORT): Promise<string> {
  const body = JSON.stringify({ jsxCode });

  return new Promise<string>((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path: '/eval',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error(`CEP request timed out after ${timeout}ms`));
    }, timeout);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (res.statusCode !== 200) {
          reject(new Error(`CEP server error (HTTP ${res.statusCode}): ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data) as { ok: boolean; result?: string; error?: string };
          if (!parsed.ok) {
            reject(new Error(parsed.error ?? 'CEP execution failed'));
          } else {
            resolve(parsed.result ?? '{}');
          }
        } catch {
          reject(new Error(`Invalid response from CEP server: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (e: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (e.code === 'ECONNREFUSED') {
        reject(new Error(
          `Cannot connect to Illustrator MCP Bridge extension on port ${CEP_PORT}. ` +
          'Please ensure Adobe Illustrator is running and the "Illustrator MCP Bridge" ' +
          'extension panel is open (Window > Extensions > Illustrator MCP Bridge).',
        ));
      } else {
        reject(e);
      }
    });

    req.write(body);
    req.end();
  });
}
