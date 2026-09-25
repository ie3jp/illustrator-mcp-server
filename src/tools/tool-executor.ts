import { executeJsx, executeJsxHeavy } from '../executor/jsx-runner.js';
import { resolveCoordinateSystem } from './session.js';

type ToolParams = Record<string, unknown>;

function ensureToolParams(params: unknown): ToolParams {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    return params as ToolParams;
  }
  return {};
}

export type ToolTextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** 結果オブジェクトが失敗を表すか（error: true、または部分失敗を含む success: false） */
export function isFailureResult(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const r = result as Record<string, unknown>;
  return r.error === true || r.success === false;
}

/**
 * 結果オブジェクトを MCP の応答にする。失敗は JSON を全部残したまま isError を付ける
 * （クライアントは JSON 内の success を読まないため、isError がないと成功扱いになる）
 */
export function formatToolResult(result: unknown): ToolTextResult {
  const out: ToolTextResult = { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  if (isFailureResult(result)) out.isError = true;
  return out;
}

export async function executeToolJsx(
  jsxCode: string,
  params: unknown,
  options?: { activate?: boolean; heavy?: boolean; resolveCoordinate?: boolean },
): Promise<ToolTextResult> {
  const baseParams = ensureToolParams(params);
  const resolvedParams = options?.resolveCoordinate
    ? { ...baseParams, coordinate_system: await resolveCoordinateSystem(baseParams.coordinate_system as 'artboard-web' | 'document' | undefined) }
    : baseParams;

  const activate = options?.activate ?? false;
  const result = options?.heavy
    ? await executeJsxHeavy(jsxCode, resolvedParams, { activate })
    : await executeJsx(jsxCode, resolvedParams, { activate });

  return formatToolResult(result);
}
